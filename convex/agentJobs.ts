import { ConvexError, v } from "convex/values"

import type { Doc } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { requirePrincipal } from "./lib/authorization"
import { enqueueNotification } from "./lib/notificationOutbox"

const jobValidator = v.object({
  jobId: v.id("agentJobs"),
  requestHumanId: v.string(),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("retry_wait"),
    v.literal("failed"),
    v.literal("completed"),
    v.literal("cancelled")
  ),
  attempts: v.number(),
  maxAttempts: v.number(),
  leaseGeneration: v.number(),
  leaseToken: v.union(v.string(), v.null()),
  leaseExpiresAt: v.union(v.number(), v.null()),
  sourceSnapshotId: v.union(v.id("sourceSnapshots"), v.null()),
  founderVersionId: v.id("founderInputVersions"),
  resultVersionId: v.union(v.id("deliverableVersions"), v.null()),
  lastErrorCode: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

const jobInputValidator = v.object({
  job: jobValidator,
  source: v.union(
    v.object({
      question: v.union(v.string(), v.null()),
      body: v.union(v.string(), v.null()),
      url: v.union(v.string(), v.null()),
      name: v.union(v.string(), v.null()),
      channel: v.union(v.string(), v.null()),
    }),
    v.null()
  ),
  founderInput: v.object({
    versionId: v.id("founderInputVersions"),
    text: v.string(),
    heads: v.array(v.string()),
    revision: v.number(),
    occurredAt: v.number(),
  }),
  context: v.array(
    v.object({
      kind: v.string(),
      title: v.string(),
      bulletPoints: v.array(v.string()),
      citations: v.array(
        v.object({ label: v.string(), url: v.string(), supports: v.string() })
      ),
    })
  ),
  request: v.object({ humanId: v.string(), title: v.string() }),
})

async function requestByHumanId(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  humanId: string
) {
  const request = await ctx.db
    .query("contentRequests")
    .withIndex("by_organization_human_id", (index) =>
      index
        .eq("organizationId", organizationId)
        .eq("humanId", humanId.trim().toUpperCase())
    )
    .unique()
  if (!request) throw new ConvexError({ code: "NOT_FOUND" })
  return request
}

async function publicJob(ctx: QueryCtx | MutationCtx, job: Doc<"agentJobs">) {
  const request = await ctx.db.get(job.requestId)
  if (!request) throw new ConvexError({ code: "NOT_FOUND" })
  return {
    jobId: job._id,
    requestHumanId: request.humanId,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    leaseGeneration: job.leaseGeneration,
    leaseToken: null,
    leaseExpiresAt: job.leaseExpiresAt ?? null,
    sourceSnapshotId: job.sourceSnapshotId ?? null,
    founderVersionId: job.founderVersionId,
    resultVersionId: job.resultVersionId ?? null,
    lastErrorCode: job.lastErrorCode ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

async function requiredJob(
  ctx: QueryCtx | MutationCtx,
  jobId: Doc<"agentJobs">["_id"]
) {
  const job = await ctx.db.get(jobId)
  if (!job) throw new ConvexError({ code: "NOT_FOUND" })
  return job
}

function assertAgent(principal: { role: string }) {
  if (!["agent_editor", "administrator"].includes(principal.role)) {
    throw new ConvexError({ code: "ROLE_ACCESS_DENIED" })
  }
}

function requiredNonEmpty(value: string) {
  const normalized = value.trim()
  if (!normalized || normalized.length > 200)
    throw new ConvexError({ code: "VALIDATION_FAILED" })
  return normalized
}

async function notifyOperators(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  type: "response_ready" | "drafting_failed",
  now: number
) {
  const [operators, administrators] = await Promise.all([
    ctx.db
      .query("principals")
      .withIndex("by_organization_role", (q) =>
        q
          .eq("organizationId", request.organizationId)
          .eq("role", "operator_editor")
      )
      .collect(),
    ctx.db
      .query("principals")
      .withIndex("by_organization_role", (q) =>
        q
          .eq("organizationId", request.organizationId)
          .eq("role", "administrator")
      )
      .collect(),
  ])
  for (const recipient of [...operators, ...administrators])
    await enqueueNotification(ctx, request, recipient, type, now)
}

async function auditJobEvent(
  ctx: MutationCtx,
  job: Doc<"agentJobs">,
  principal: {
    _id: Doc<"principals">["_id"]
    credentialId: string
    organizationId: string
  },
  operation: string,
  correlationId: string,
  now: number
) {
  const request = await ctx.db.get(job.requestId)
  if (!request) throw new ConvexError({ code: "NOT_FOUND" })
  await ctx.db.insert("auditEvents", {
    organizationId: principal.organizationId,
    requestId: request._id,
    requestHumanId: request.humanId,
    actorPrincipalId: principal._id,
    credentialId: principal.credentialId,
    operation,
    correlationId,
    occurredAt: now,
    afterVersion: request.aggregateVersion,
  })
  return request
}

export const submitFounderInput = mutation({
  args: {
    humanId: v.string(),
    heads: v.array(v.string()),
    correlationId: v.string(),
  },
  returns: jobValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    if (principal.role !== "founder")
      throw new ConvexError({ code: "ROLE_ACCESS_DENIED" })
    const request = await requestByHumanId(
      ctx,
      principal.organizationId,
      args.humanId
    )
    if (
      (request.assigneePrincipalId ?? request.createdByPrincipalId) !==
      principal._id
    ) {
      throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED" })
    }
    const document = await ctx.db
      .query("founderInputDocuments")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .unique()
    if (!document?.hasMeaningfulDraft)
      throw new ConvexError({ code: "FOUNDER_INPUT_REQUIRED" })
    if (document.founderPrincipalId !== principal._id)
      throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
    const durableHeads = [...(document.durableHeads ?? [])].sort()
    const submittedHeads = [...new Set(args.heads)].sort()
    if (
      durableHeads.length !== submittedHeads.length ||
      durableHeads.some((head, index) => head !== submittedHeads[index])
    ) {
      throw new ConvexError({ code: "FOUNDER_INPUT_NOT_DURABLE" })
    }
    const existingSubmission = await ctx.db
      .query("founderSubmissions")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .unique()
    const existingJob = await ctx.db
      .query("agentJobs")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .unique()
    if (existingSubmission || existingJob) {
      if (existingSubmission && existingJob) return publicJob(ctx, existingJob)
      throw new ConvexError({ code: "INCONSISTENT_SUBMISSION" })
    }
    const voiceCaptures = await ctx.db
      .query("founderVoiceCaptures")
      .withIndex("by_document_created_at", (q) =>
        q.eq("documentId", document._id)
      )
      .collect()
    if (
      voiceCaptures.some(
        (capture) =>
          !capture.discardedAt &&
          (capture.status !== "transcribed" || !capture.transcriptMergedAt)
      )
    )
      throw new ConvexError({ code: "FOUNDER_VOICE_PENDING" })
    if (request.lifecycle !== "in_progress")
      throw new ConvexError({ code: "INVALID_TRANSITION" })
    const correlationId = args.correlationId.trim()
    if (!correlationId) throw new ConvexError({ code: "VALIDATION_FAILED" })
    let version = await ctx.db
      .query("founderInputVersions")
      .withIndex("by_request_occurred_at", (q) =>
        q.eq("requestId", request._id)
      )
      .order("desc")
      .first()
    if (
      !version ||
      version.documentId !== document._id ||
      version.text !== document.text
    )
      throw new ConvexError({ code: "FOUNDER_VERSION_NOT_DURABLE" })
    const versionHeads = [...version.heads].sort()
    if (
      version.revision !== document.revision ||
      versionHeads.length !== durableHeads.length ||
      versionHeads.some((head, index) => head !== durableHeads[index])
    ) {
      const versionId = await ctx.db.insert("founderInputVersions", {
        organizationId: principal.organizationId,
        requestId: request._id,
        documentId: document._id,
        text: document.text,
        heads: durableHeads,
        revision: document.revision,
        actorPrincipalId: principal._id,
        actorSubject: principal.subject,
        correlationId: `${correlationId}:submission-snapshot`,
        occurredAt: Date.now(),
      })
      version = await ctx.db.get(versionId)
      if (!version) throw new ConvexError({ code: "WRITE_FAILED" })
    }
    const now = Date.now()
    const contextItems = await ctx.db
      .query("contextItems")
      .withIndex("by_request_kind", (q) => q.eq("requestId", request._id))
      .collect()
    await ctx.db.insert("founderSubmissions", {
      organizationId: principal.organizationId,
      requestId: request._id,
      documentId: document._id,
      founderVersionId: version._id,
      founderPrincipalId: principal._id,
      correlationId,
      submittedAt: now,
    })
    const jobId = await ctx.db.insert("agentJobs", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestTitle: request.title,
      type: "primary_response",
      status: "queued",
      sourceSnapshotId: request.sourceSnapshotId,
      founderVersionId: version._id,
      contextSnapshot: contextItems.map((item) => ({
        kind: item.kind,
        title: item.title,
        bulletPoints: item.bulletPoints,
        citations: item.citations,
      })),
      attempts: 0,
      maxAttempts: 3,
      leaseGeneration: 0,
      createdAt: now,
      updatedAt: now,
    })
    const afterVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      lifecycle: "founder_complete",
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "founder_input.submitted",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion,
    })
    return publicJob(ctx, await requiredJob(ctx, jobId))
  },
})

export const claim = mutation({
  args: { leaseToken: v.string(), leaseMs: v.number() },
  returns: v.union(jobValidator, v.null()),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    assertAgent(principal)
    const leaseToken = requiredNonEmpty(args.leaseToken)
    const now = Date.now()
    const leaseMs = Math.min(15 * 60_000, Math.max(30_000, args.leaseMs))
    const candidates = (
      await Promise.all(
        (["queued", "retry_wait", "running"] as const).map((status) =>
          ctx.db
            .query("agentJobs")
            .withIndex("by_organization_status_created_at", (q) =>
              q
                .eq("organizationId", principal.organizationId)
                .eq("status", status)
            )
            .collect()
        )
      )
    ).flat()
    const activeTokenClaim = candidates.find(
      (candidate) =>
        candidate.status === "running" &&
        candidate.leaseToken === leaseToken &&
        (candidate.leaseExpiresAt ?? 0) > now
    )
    if (activeTokenClaim) {
      if (activeTokenClaim.claimedByPrincipalId !== principal._id)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return publicJob(ctx, activeTokenClaim)
    }
    for (const expired of candidates.filter(
      (candidate) =>
        candidate.status === "running" &&
        (candidate.leaseExpiresAt ?? 0) <= now &&
        candidate.attempts >= candidate.maxAttempts
    )) {
      await ctx.db.patch(expired._id, {
        status: "failed",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        lastErrorCode: "LEASE_EXPIRED",
        updatedAt: now,
      })
      await ctx.db.insert("agentJobLeaseEvents", {
        organizationId: principal.organizationId,
        jobId: expired._id,
        requestId: expired.requestId,
        actorPrincipalId: principal._id,
        event: "expired_failure",
        leaseGeneration: expired.leaseGeneration,
        occurredAt: now,
      })
      const request = await auditJobEvent(
        ctx,
        expired,
        principal,
        "agent_job.failed",
        `lease-expired:${expired._id}:${expired.leaseGeneration}`,
        now
      )
      await notifyOperators(ctx, request, "drafting_failed", now)
    }
    const job = candidates
      .filter(
        (candidate) =>
          candidate.status === "queued" ||
          (candidate.status === "retry_wait" &&
            (candidate.nextAttemptAt ?? 0) <= now) ||
          (candidate.status === "running" &&
            (candidate.leaseExpiresAt ?? 0) <= now &&
            candidate.attempts < candidate.maxAttempts)
      )
      .sort((a, b) => a.createdAt - b.createdAt)[0]
    if (!job) return null
    const reclaiming = job.status === "running"
    const leaseGeneration = job.leaseGeneration + 1
    const leaseExpiresAt = now + leaseMs
    await ctx.db.patch(job._id, {
      status: "running",
      leaseToken,
      leaseExpiresAt,
      heartbeatAt: now,
      claimedByPrincipalId: principal._id,
      attempts: job.attempts + 1,
      leaseGeneration,
      startedAt: job.startedAt ?? now,
      updatedAt: now,
    })
    await ctx.db.insert("agentJobLeaseEvents", {
      organizationId: principal.organizationId,
      jobId: job._id,
      requestId: job.requestId,
      actorPrincipalId: principal._id,
      event: reclaiming ? "reclaimed" : "claimed",
      leaseGeneration,
      leaseExpiresAt,
      occurredAt: now,
    })
    await auditJobEvent(
      ctx,
      job,
      principal,
      reclaiming ? "agent_job.reclaimed" : "agent_job.claimed",
      `lease:${job._id}:${leaseGeneration}`,
      now
    )
    return publicJob(ctx, await requiredJob(ctx, job._id))
  },
})

export const heartbeat = mutation({
  args: {
    jobId: v.id("agentJobs"),
    leaseToken: v.string(),
    leaseMs: v.number(),
    leaseGeneration: v.number(),
  },
  returns: jobValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    assertAgent(principal)
    const job = await ctx.db.get(args.jobId)
    const now = Date.now()
    if (!job || job.organizationId !== principal.organizationId)
      throw new ConvexError({ code: "NOT_FOUND" })
    if (
      job.status !== "running" ||
      job.leaseToken !== requiredNonEmpty(args.leaseToken) ||
      job.claimedByPrincipalId !== principal._id ||
      job.leaseGeneration !== args.leaseGeneration ||
      (job.leaseExpiresAt ?? 0) <= now
    )
      throw new ConvexError({ code: "LEASE_LOST" })
    const leaseExpiresAt =
      now + Math.min(15 * 60_000, Math.max(30_000, args.leaseMs))
    await ctx.db.patch(job._id, {
      heartbeatAt: now,
      leaseExpiresAt,
      updatedAt: now,
    })
    await ctx.db.insert("agentJobLeaseEvents", {
      organizationId: principal.organizationId,
      jobId: job._id,
      requestId: job.requestId,
      actorPrincipalId: principal._id,
      event: "heartbeat",
      leaseGeneration: job.leaseGeneration,
      leaseExpiresAt,
      occurredAt: now,
    })
    await auditJobEvent(
      ctx,
      job,
      principal,
      "agent_job.heartbeat",
      `heartbeat:${job._id}:${job.leaseGeneration}:${now}`,
      now
    )
    return publicJob(ctx, await requiredJob(ctx, job._id))
  },
})

export const complete = mutation({
  args: {
    jobId: v.id("agentJobs"),
    leaseToken: v.string(),
    body: v.string(),
    correlationId: v.string(),
    leaseGeneration: v.number(),
  },
  returns: jobValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    assertAgent(principal)
    const job = await ctx.db.get(args.jobId)
    const now = Date.now()
    if (!job || job.organizationId !== principal.organizationId)
      throw new ConvexError({ code: "NOT_FOUND" })
    if (job.status === "completed") return publicJob(ctx, job)
    if (
      job.status !== "running" ||
      job.leaseToken !== requiredNonEmpty(args.leaseToken) ||
      job.claimedByPrincipalId !== principal._id ||
      job.leaseGeneration !== args.leaseGeneration ||
      (job.leaseExpiresAt ?? 0) <= now
    )
      throw new ConvexError({ code: "LEASE_LOST" })
    const body = args.body.trim()
    if (!body) throw new ConvexError({ code: "VALIDATION_FAILED" })
    const correlationId = requiredNonEmpty(args.correlationId)
    const deliverables = await ctx.db
      .query("deliverables")
      .withIndex("by_request", (q) => q.eq("requestId", job.requestId))
      .collect()
    const deliverable = deliverables.find((candidate) => candidate.isPrimary)
    let deliverableId = deliverable?._id
    if (!deliverableId)
      deliverableId = await ctx.db.insert("deliverables", {
        organizationId: principal.organizationId,
        requestId: job.requestId,
        kind: "primary_response",
        name: "Primary response",
        isPrimary: true,
        createdAt: now,
        updatedAt: now,
      })
    const existing = await ctx.db
      .query("deliverableVersions")
      .withIndex("by_source_job", (q) => q.eq("sourceJobId", job._id))
      .unique()
    let versionId = existing?._id
    if (!versionId)
      versionId = await ctx.db.insert("deliverableVersions", {
        organizationId: principal.organizationId,
        requestId: job.requestId,
        deliverableId,
        body,
        ordinal: 1,
        createdByPrincipalId: principal._id,
        sourceJobId: job._id,
        createdAt: now,
      })
    await ctx.db.patch(deliverableId, {
      currentCandidateVersionId: versionId,
      promotedVersionId: versionId,
      updatedAt: now,
    })
    await ctx.db.patch(job._id, {
      status: "completed",
      resultVersionId: versionId,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      completedAt: now,
      updatedAt: now,
    })
    const request = await ctx.db.get(job.requestId)
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const afterVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      lifecycle: "ready_to_respond",
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "agent_job.completed",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion,
    })
    await notifyOperators(ctx, request, "response_ready", now)
    return publicJob(ctx, await requiredJob(ctx, job._id))
  },
})

export const fail = mutation({
  args: {
    jobId: v.id("agentJobs"),
    leaseToken: v.string(),
    errorCode: v.string(),
    transient: v.boolean(),
    correlationId: v.string(),
    leaseGeneration: v.number(),
  },
  returns: jobValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    assertAgent(principal)
    const job = await ctx.db.get(args.jobId)
    const now = Date.now()
    if (!job || job.organizationId !== principal.organizationId)
      throw new ConvexError({ code: "NOT_FOUND" })
    const correlationId = requiredNonEmpty(args.correlationId)
    const errorCode = requiredNonEmpty(args.errorCode).slice(0, 100)
    const inputFingerprint = `${job._id}:${args.leaseGeneration}:${errorCode}:${args.transient}`
    const prior = await ctx.db
      .query("agentJobFailureOperations")
      .withIndex("by_organization_actor_correlation", (q) =>
        q
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (prior) {
      if (
        prior.jobId !== job._id ||
        prior.inputFingerprint !== inputFingerprint
      )
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return publicJob(ctx, job)
    }
    if (
      job.status !== "running" ||
      job.leaseToken !== requiredNonEmpty(args.leaseToken) ||
      job.claimedByPrincipalId !== principal._id ||
      job.leaseGeneration !== args.leaseGeneration ||
      (job.leaseExpiresAt ?? 0) <= now
    )
      throw new ConvexError({ code: "LEASE_LOST" })
    const retry = args.transient && job.attempts < job.maxAttempts
    await ctx.db.patch(job._id, {
      status: retry ? "retry_wait" : "failed",
      nextAttemptAt: retry
        ? now + Math.min(15 * 60_000, 30_000 * 2 ** (job.attempts - 1))
        : undefined,
      lastErrorCode: errorCode,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    })
    await ctx.db.insert("agentJobFailureOperations", {
      organizationId: principal.organizationId,
      jobId: job._id,
      actorPrincipalId: principal._id,
      correlationId,
      inputFingerprint,
      resultStatus: retry ? "retry_wait" : "failed",
      createdAt: now,
    })
    const request = await ctx.db.get(job.requestId)
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: retry ? "agent_job.retry_scheduled" : "agent_job.failed",
      correlationId,
      occurredAt: now,
      afterVersion: request.aggregateVersion,
    })
    if (!retry) await notifyOperators(ctx, request, "drafting_failed", now)
    return publicJob(ctx, await requiredJob(ctx, job._id))
  },
})

export const list = query({
  args: {},
  returns: v.array(jobValidator),
  handler: async (ctx) => {
    const principal = await requirePrincipal(ctx)
    assertAgent(principal)
    const jobs = (
      await Promise.all(
        (
          [
            "queued",
            "running",
            "retry_wait",
            "failed",
            "completed",
            "cancelled",
          ] as const
        ).map((status) =>
          ctx.db
            .query("agentJobs")
            .withIndex("by_organization_status_created_at", (q) =>
              q
                .eq("organizationId", principal.organizationId)
                .eq("status", status)
            )
            .collect()
        )
      )
    )
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt)
    return Promise.all(jobs.map((job) => publicJob(ctx, job)))
  },
})

export const reapExpired = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now()
    const jobs = await ctx.db
      .query("agentJobs")
      .withIndex("by_status_created_at", (q) => q.eq("status", "running"))
      .collect()
    let reaped = 0
    for (const job of jobs) {
      if (
        (job.leaseExpiresAt ?? 0) > now ||
        job.attempts < job.maxAttempts ||
        !job.claimedByPrincipalId
      )
        continue
      const actor = await ctx.db.get(job.claimedByPrincipalId)
      const request = await ctx.db.get(job.requestId)
      if (!actor || !request) continue
      await ctx.db.patch(job._id, {
        status: "failed",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        lastErrorCode: "LEASE_EXPIRED",
        updatedAt: now,
      })
      await ctx.db.insert("agentJobLeaseEvents", {
        organizationId: job.organizationId,
        jobId: job._id,
        requestId: job.requestId,
        actorPrincipalId: actor._id,
        event: "expired_failure",
        leaseGeneration: job.leaseGeneration,
        occurredAt: now,
      })
      await ctx.db.insert("auditEvents", {
        organizationId: job.organizationId,
        requestId: request._id,
        requestHumanId: request.humanId,
        actorPrincipalId: actor._id,
        credentialId: "system:agent-job-reaper",
        operation: "agent_job.failed",
        correlationId: `lease-expired:${job._id}:${job.leaseGeneration}`,
        occurredAt: now,
        afterVersion: request.aggregateVersion,
      })
      await notifyOperators(ctx, request, "drafting_failed", now)
      reaped += 1
    }
    return reaped
  },
})

export const getInput = query({
  args: { jobId: v.id("agentJobs") },
  returns: jobInputValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    assertAgent(principal)
    const job = await ctx.db.get(args.jobId)
    if (!job || job.organizationId !== principal.organizationId)
      throw new ConvexError({ code: "NOT_FOUND" })
    const founderVersion = await ctx.db.get(job.founderVersionId)
    if (!founderVersion) throw new ConvexError({ code: "NOT_FOUND" })
    const request = await ctx.db.get(job.requestId)
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const source = job.sourceSnapshotId
      ? await ctx.db.get(job.sourceSnapshotId)
      : null
    return {
      job: await publicJob(ctx, job),
      source: source
        ? {
            question: source.question ?? null,
            body: source.body ?? null,
            url: source.url ?? null,
            name: source.name ?? null,
            channel: source.channel ?? null,
          }
        : null,
      founderInput: {
        versionId: founderVersion._id,
        text: founderVersion.text,
        heads: founderVersion.heads,
        revision: founderVersion.revision,
        occurredAt: founderVersion.occurredAt,
      },
      context: job.contextSnapshot,
      request: { humanId: request.humanId, title: job.requestTitle },
    }
  },
})
