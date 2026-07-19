// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const identity = (subject: string, role: string) => ({
  subject,
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role,
  jti: `${subject}-session`,
})

async function submittedWorkspace() {
  const workspace = convexTest(schema, modules)
  const operator = workspace.withIdentity(
    identity("operator", "operator-editor")
  )
  const founder = workspace.withIdentity(identity("founder", "founder"))
  const agent = workspace.withIdentity(identity("agent-one", "agent-editor"))
  const agentTwo = workspace.withIdentity(identity("agent-two", "agent-editor"))
  const operatorPrincipal = await operator.mutation(api.principals.syncCurrent)
  const founderPrincipal = await founder.mutation(api.principals.syncCurrent)
  await agent.mutation(api.principals.syncCurrent)
  await agentTwo.mutation(api.principals.syncCurrent)
  const request = await operator.mutation(api.contentRequests.createManual, {
    title: "Draft a founder response",
    origin: "manual",
    correlationId: "create-job-request",
  })
  await operator.mutation(internal.contentRequests.assign, {
    humanId: request.humanId,
    assigneePrincipalId: founderPrincipal.principalId,
    correlationId: "assign-job-founder",
  })
  const input = await founder.mutation(api.founderInputs.saveText, {
    humanId: request.humanId,
    text: "Use my experience helping Canadian borrowers.",
    correlationId: "save-job-input",
  })
  await workspace.run(async (ctx) => {
    await ctx.db.patch(input.documentId, { durableHeads: ["durable-head"] })
    const principal = await ctx.db.get(founderPrincipal.principalId)
    if (!principal) throw new Error("Founder principal missing")
    const requestDoc = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (q) =>
        q.eq("organizationId", "org_fairlend").eq("humanId", request.humanId)
      )
      .unique()
    if (!requestDoc) throw new Error("Request missing")
    const ingestionRunId = await ctx.db.insert("ingestionRuns", {
      organizationId: "org_fairlend",
      reportIdentity: "job-test-report",
      idempotencyKey: `job-test-${request.humanId}`,
      reportHash: "hash",
      rawMarkdown: "# Research",
      demandLedgerMarkdown: "# Ledger",
      parserVersion: "test",
      status: "applied",
      createdByPrincipalId: operatorPrincipal.principalId,
      createdAt: Date.now(),
      result: {
        created: 0,
        updated: 0,
        manualPreserved: 0,
        requestHumanIds: [request.humanId],
      },
    })
    await ctx.db.insert("contextItems", {
      organizationId: "org_fairlend",
      requestId: requestDoc._id,
      kind: "talking_points",
      title: "Talking points",
      bulletPoints: ["Explain the Canadian borrower impact."],
      citations: [
        {
          label: "Source",
          url: "https://example.com/research",
          supports: "Borrower impact",
        },
      ],
      ingestionRunId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await ctx.db.insert("founderInputVersions", {
      organizationId: "org_fairlend",
      requestId: requestDoc._id,
      documentId: input.documentId,
      text: input.text,
      heads: ["durable-head"],
      revision: input.revision,
      actorPrincipalId: principal._id,
      actorSubject: principal.subject,
      correlationId: "durable-job-input",
      occurredAt: Date.now(),
    })
  })
  const job = await founder.mutation(api.agentJobs.submitFounderInput, {
    humanId: request.humanId,
    heads: ["durable-head"],
    correlationId: "submit-founder-input",
  })
  return { workspace, founder, agent, agentTwo, request, job }
}

describe("founder submission and agent drafting jobs", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("submits once, reclaims an expired lease, and completes one promoted response", async () => {
    const { workspace, founder, agent, agentTwo, request, job } =
      await submittedWorkspace()
    await expect(
      founder.mutation(api.agentJobs.submitFounderInput, {
        humanId: request.humanId,
        heads: ["durable-head"],
        correlationId: "submit-founder-input-replay",
      })
    ).resolves.toMatchObject({ jobId: job.jobId, status: "queued" })
    const firstClaim = await agent.mutation(api.agentJobs.claim, {
      leaseToken: "lease-one",
      leaseMs: 30_000,
    })
    expect(firstClaim).toMatchObject({ jobId: job.jobId, status: "running" })
    await workspace.run((ctx) =>
      ctx.db.patch(job.jobId, { leaseExpiresAt: Date.now() - 1 })
    )
    const reclaimed = await agentTwo.mutation(api.agentJobs.claim, {
      leaseToken: "lease-two",
      leaseMs: 30_000,
    })
    expect(reclaimed).toMatchObject({ jobId: job.jobId, attempts: 2 })
    await expect(
      agent.mutation(api.agentJobs.complete, {
        jobId: job.jobId,
        leaseToken: "lease-one",
        leaseGeneration: firstClaim!.leaseGeneration,
        body: "Stale output",
        correlationId: "stale-completion",
      })
    ).rejects.toMatchObject({ data: { code: "LEASE_LOST" } })
    const completed = await agentTwo.mutation(api.agentJobs.complete, {
      jobId: job.jobId,
      leaseToken: "lease-two",
      leaseGeneration: reclaimed!.leaseGeneration,
      body: "A polished, ready-to-paste founder response.",
      correlationId: "complete-job",
    })
    expect(completed).toMatchObject({
      status: "completed",
      resultVersionId: expect.any(String),
    })
    await expect(
      agentTwo.mutation(api.agentJobs.complete, {
        jobId: job.jobId,
        leaseToken: "lease-two",
        leaseGeneration: reclaimed!.leaseGeneration,
        body: "A polished, ready-to-paste founder response.",
        correlationId: "complete-job-replay",
      })
    ).resolves.toMatchObject({ resultVersionId: completed.resultVersionId })
    const stored = await workspace.run(async (ctx) => ({
      versions: await ctx.db.query("deliverableVersions").collect(),
      request: await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (q) =>
          q.eq("organizationId", "org_fairlend").eq("humanId", request.humanId)
        )
        .unique(),
    }))
    expect(stored.versions).toHaveLength(1)
    expect(stored.request?.lifecycle).toBe("ready_to_respond")
  })

  it("exposes immutable job input and notifies operators after retries exhaust", async () => {
    const { workspace, agent, job } = await submittedWorkspace()
    const input = await agent.query(api.agentJobs.getInput, {
      jobId: job.jobId,
    })
    expect(input).toMatchObject({
      founderInput: {
        versionId: job.founderVersionId,
        text: "Use my experience helping Canadian borrowers.",
        heads: ["durable-head"],
      },
      context: [
        {
          kind: "talking_points",
          bulletPoints: ["Explain the Canadian borrower impact."],
        },
      ],
    })

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const leaseToken = `retry-lease-${attempt}`
      const claimed = await agent.mutation(api.agentJobs.claim, {
        leaseToken,
        leaseMs: 30_000,
      })
      expect(claimed?.attempts).toBe(attempt)
      if (attempt === 2)
        await expect(
          agent.mutation(api.agentJobs.fail, {
            jobId: job.jobId,
            leaseToken,
            leaseGeneration: claimed!.leaseGeneration,
            errorCode: "UPSTREAM_TIMEOUT",
            transient: true,
            correlationId: "fail-1",
          })
        ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })
      const failed = await agent.mutation(api.agentJobs.fail, {
        jobId: job.jobId,
        leaseToken,
        leaseGeneration: claimed!.leaseGeneration,
        errorCode: "UPSTREAM_TIMEOUT",
        transient: true,
        correlationId: `fail-${attempt}`,
      })
      expect(failed.status).toBe(attempt < 3 ? "retry_wait" : "failed")
      await expect(
        agent.mutation(api.agentJobs.fail, {
          jobId: job.jobId,
          leaseToken,
          leaseGeneration: claimed!.leaseGeneration,
          errorCode: "UPSTREAM_TIMEOUT",
          transient: true,
          correlationId: `fail-${attempt}`,
        })
      ).resolves.toMatchObject({ status: failed.status })
      if (attempt < 3)
        await workspace.run((ctx) =>
          ctx.db.patch(job.jobId, { nextAttemptAt: Date.now() - 1 })
        )
    }

    const evidence = await workspace.run(async (ctx) => {
      const storedJob = await ctx.db.get(job.jobId)
      if (!storedJob) throw new Error("Job missing")
      return {
        notifications: await ctx.db
          .query("notifications")
          .withIndex("by_request_created_at", (q) =>
            q.eq("requestId", storedJob.requestId)
          )
          .collect(),
        audit: await ctx.db.query("auditEvents").collect(),
      }
    })
    expect(
      evidence.notifications.filter(
        (notification) => notification.type === "drafting_failed"
      )
    ).toEqual([expect.objectContaining({ type: "drafting_failed" })])
    expect(
      evidence.audit.filter((event) => event.operation === "agent_job.failed")
    ).toHaveLength(1)
  })

  it("fences leases by claimant and makes an ambiguous claim retry idempotent", async () => {
    const { workspace, agent, agentTwo, job } = await submittedWorkspace()
    const first = await agent.mutation(api.agentJobs.claim, {
      leaseToken: "private-lease",
      leaseMs: 30_000,
    })
    const replay = await agent.mutation(api.agentJobs.claim, {
      leaseToken: "private-lease",
      leaseMs: 30_000,
    })
    expect(replay).toMatchObject({ jobId: first?.jobId, attempts: 1 })
    expect(
      (await agentTwo.query(api.agentJobs.list, {}))[0].leaseToken
    ).toBeNull()
    await expect(
      agentTwo.mutation(api.agentJobs.heartbeat, {
        jobId: job.jobId,
        leaseToken: "private-lease",
        leaseGeneration: first!.leaseGeneration,
        leaseMs: 30_000,
      })
    ).rejects.toMatchObject({ data: { code: "LEASE_LOST" } })
    await workspace.run((ctx) =>
      ctx.db.patch(job.jobId, { leaseExpiresAt: Date.now() - 1 })
    )
    const reclaimed = await agent.mutation(api.agentJobs.claim, {
      leaseToken: "private-lease",
      leaseMs: 30_000,
    })
    expect(reclaimed?.leaseGeneration).toBe(2)
    await expect(
      agent.mutation(api.agentJobs.heartbeat, {
        jobId: job.jobId,
        leaseToken: "private-lease",
        leaseGeneration: first!.leaseGeneration,
        leaseMs: 30_000,
      })
    ).rejects.toMatchObject({ data: { code: "LEASE_LOST" } })
    const leaseEvents = await workspace.run((ctx) =>
      ctx.db
        .query("agentJobLeaseEvents")
        .withIndex("by_job_occurred_at", (q) => q.eq("jobId", job.jobId))
        .collect()
    )
    expect(
      leaseEvents.filter((event) => event.event === "claimed")
    ).toHaveLength(1)
  })

  it("freezes founder input after submission and terminalizes abandoned leases", async () => {
    const { workspace, founder, agent, request, job } =
      await submittedWorkspace()
    await expect(
      founder.mutation(api.founderInputs.saveText, {
        humanId: request.humanId,
        text: "Attempted mutation after submit",
        correlationId: "late-founder-write",
      })
    ).rejects.toMatchObject({ data: { code: "FOUNDER_INPUT_SUBMITTED" } })
    await expect(
      founder.mutation(api.voiceCaptures.createUploadUrl, {
        humanId: request.humanId,
      })
    ).rejects.toMatchObject({ data: { code: "FOUNDER_INPUT_SUBMITTED" } })
    const replacement = workspace.withIdentity(
      identity("replacement-founder", "founder")
    )
    const replacementPrincipal = await replacement.mutation(
      api.principals.syncCurrent
    )
    await workspace.run(async (ctx) => {
      const requestDoc = await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (q) =>
          q.eq("organizationId", "org_fairlend").eq("humanId", request.humanId)
        )
        .unique()
      if (!requestDoc) throw new Error("Request missing")
      await ctx.db.patch(requestDoc._id, {
        assigneePrincipalId: replacementPrincipal.principalId,
      })
    })
    await expect(
      replacement.mutation(api.agentJobs.submitFounderInput, {
        humanId: request.humanId,
        heads: ["durable-head"],
        correlationId: "replacement-submit",
      })
    ).rejects.toMatchObject({
      data: { code: "FOUNDER_INPUT_HANDOFF_REQUIRED" },
    })
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimed = await agent.mutation(api.agentJobs.claim, {
        leaseToken: `abandoned-${attempt}`,
        leaseMs: 30_000,
      })
      expect(claimed?.attempts).toBe(attempt)
      await workspace.run((ctx) =>
        ctx.db.patch(job.jobId, { leaseExpiresAt: Date.now() - 1 })
      )
    }
    await expect(
      workspace.mutation(internal.agentJobs.reapExpired, {})
    ).resolves.toBe(1)
    const stored = await workspace.run((ctx) => ctx.db.get(job.jobId))
    expect(stored).toMatchObject({
      status: "failed",
      attempts: 3,
      lastErrorCode: "LEASE_EXPIRED",
    })
  })

  it("blocks submission for pending voice and snapshots exact heads plus the request title", async () => {
    const { workspace, founder, agent, request, job } =
      await submittedWorkspace()
    const captureId = await workspace.run(async (ctx) => {
      await ctx.db.delete(job.jobId)
      const requestDoc = await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (q) =>
          q.eq("organizationId", "org_fairlend").eq("humanId", request.humanId)
        )
        .unique()
      if (!requestDoc) throw new Error("Request missing")
      const submission = await ctx.db
        .query("founderSubmissions")
        .withIndex("by_request", (q) => q.eq("requestId", requestDoc._id))
        .unique()
      if (!submission) throw new Error("Submission missing")
      await ctx.db.delete(submission._id)
      await ctx.db.patch(requestDoc._id, { lifecycle: "in_progress" })
      const document = await ctx.db
        .query("founderInputDocuments")
        .withIndex("by_request", (q) => q.eq("requestId", requestDoc._id))
        .unique()
      if (!document) throw new Error("Founder document missing")
      await ctx.db.patch(document._id, {
        durableHeads: ["new-head"],
        revision: 2,
      })
      const storageId = await ctx.storage.store(
        new Blob(["voice"], { type: "audio/webm" })
      )
      return ctx.db.insert("founderVoiceCaptures", {
        organizationId: "org_fairlend",
        requestId: requestDoc._id,
        documentId: document._id,
        founderPrincipalId: document.founderPrincipalId,
        clientCaptureId: "pending-capture",
        storageId,
        mimeType: "audio/webm",
        sizeBytes: 5,
        durationMs: 1_000,
        status: "transcribing",
        attempts: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })
    await expect(
      founder.mutation(api.agentJobs.submitFounderInput, {
        humanId: request.humanId,
        heads: ["new-head"],
        correlationId: "pending-voice-submit",
      })
    ).rejects.toMatchObject({ data: { code: "FOUNDER_VOICE_PENDING" } })
    await workspace.run((ctx) =>
      ctx.db.patch(captureId, {
        status: "transcribed",
        transcript: "Merged voice",
        transcriptMergedAt: Date.now(),
      })
    )
    const submitted = await founder.mutation(api.agentJobs.submitFounderInput, {
      humanId: request.humanId,
      heads: ["new-head"],
      correlationId: "voice-finished-submit",
    })
    const input = await agent.query(api.agentJobs.getInput, {
      jobId: submitted.jobId,
    })
    expect(input).toMatchObject({
      request: { humanId: request.humanId, title: "Draft a founder response" },
      founderInput: { heads: ["new-head"], revision: 2 },
    })
  })
})
