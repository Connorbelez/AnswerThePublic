import { ConvexError, v } from "convex/values"

import { canonicalJson } from "../shared/canonical-json"
import type { Doc, Id } from "./_generated/dataModel"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  requireActiveRequest,
  requireEditor,
  requirePrincipal,
} from "./lib/authorization"
import {
  assertWithinRequestLimit,
  MAX_DELIVERABLES_PER_REQUEST,
} from "./lib/requestLimits"
import { completeAgentJobWithVersion } from "./lib/agentJobCompletion"
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"

const PROCESSING_SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000

type ProcessingSnapshotPayload = {
  version: 3
  snapshotId: Id<"expertSynthesisProcessingSnapshots">
  organizationId: string
  requestId: Id<"contentRequests">
  humanId: string
  payloadDigest: string
  issuedAt: number
  expiresAt: number
}

function snapshotSecret() {
  const secret =
    process.env.EXPERT_SYNTHESIS_SNAPSHOT_SECRET ??
    process.env.GUEST_ACCESS_TOKEN_SECRET
  if (!secret || new TextEncoder().encode(secret).byteLength < 32)
    throw new ConvexError({
      code: "EXPERT_SYNTHESIS_SNAPSHOT_SECRET_NOT_CONFIGURED",
    })
  return secret
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}

function hexToBytes(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0)
    throw new ConvexError({ code: "INVALID_EXPERT_SYNTHESIS_SNAPSHOT" })
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < value.length; index += 2)
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16)
  return bytes
}

async function signSnapshot(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(snapshotSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
    )
  )
}

function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

async function sha256(value: string) {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    )
  )
}

async function encodeProcessingSnapshot(payload: ProcessingSnapshotPayload) {
  const encoded = bytesToHex(new TextEncoder().encode(JSON.stringify(payload)))
  return `${encoded}.${await signSnapshot(encoded)}`
}

async function decodeProcessingSnapshot(tokenInput: string) {
  const token = tokenInput.trim()
  const [encoded, signature, extra] = token.split(".")
  if (!encoded || !signature || extra)
    throw new ConvexError({ code: "INVALID_EXPERT_SYNTHESIS_SNAPSHOT" })
  const expected = await signSnapshot(encoded)
  if (!secureEqual(signature, expected))
    throw new ConvexError({ code: "INVALID_EXPERT_SYNTHESIS_SNAPSHOT" })
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(hexToBytes(encoded))
    ) as ProcessingSnapshotPayload
    if (
      payload.version !== 3 ||
      !payload.snapshotId ||
      !payload.organizationId ||
      !payload.requestId ||
      !payload.humanId ||
      !/^[0-9a-f]{64}$/.test(payload.payloadDigest) ||
      !Number.isFinite(payload.issuedAt) ||
      !Number.isFinite(payload.expiresAt)
    )
      throw new Error("invalid payload")
    return payload
  } catch {
    throw new ConvexError({ code: "INVALID_EXPERT_SYNTHESIS_SNAPSHOT" })
  }
}

const inclusionValidator = v.object({
  state: v.union(
    v.literal("included"),
    v.literal("excluded"),
    v.literal("undecided")
  ),
  decidedBy: v.union(
    v.object({
      principalId: v.id("principals"),
      displayName: v.string(),
    }),
    v.null()
  ),
  decidedAt: v.union(v.number(), v.null()),
})

const submissionSummaryValidator = v.object({
  submissionId: v.string(),
  source: v.union(v.literal("guest"), v.literal("founder")),
  requestHumanId: v.string(),
  respondent: v.object({
    personId: v.string(),
    displayName: v.string(),
    email: v.string(),
  }),
  workspaceRevision: v.number(),
  progress: v.object({ completed: v.number(), total: v.number() }),
  sourceSummary: v.string(),
  inclusion: inclusionValidator,
  submittedAt: v.number(),
})

const deliverableVersionValidator = v.object({
  versionId: v.id("deliverableVersions"),
  body: v.string(),
  ordinal: v.number(),
  createdByPrincipalId: v.id("principals"),
  sourceJobId: v.union(v.id("agentJobs"), v.null()),
  changeSummary: v.union(v.string(), v.null()),
  createdAt: v.number(),
})

const deliverableValidator = v.object({
  deliverableId: v.id("deliverables"),
  requestHumanId: v.string(),
  kind: v.string(),
  name: v.string(),
  isPrimary: v.boolean(),
  currentCandidateVersionId: v.union(v.id("deliverableVersions"), v.null()),
  promotedVersionId: v.union(v.id("deliverableVersions"), v.null()),
  versions: v.array(deliverableVersionValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
})

async function deliverableProjection(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"contentRequests">,
  deliverable: Doc<"deliverables">
) {
  const versions = await ctx.db
    .query("deliverableVersions")
    .withIndex("by_deliverable_ordinal", (index) =>
      index.eq("deliverableId", deliverable._id)
    )
    .order("desc")
    .collect()
  return {
    deliverableId: deliverable._id,
    requestHumanId: request.humanId,
    kind: deliverable.kind,
    name: deliverable.name,
    isPrimary: deliverable.isPrimary,
    currentCandidateVersionId: deliverable.currentCandidateVersionId ?? null,
    promotedVersionId: deliverable.promotedVersionId ?? null,
    versions: versions.map((version) => ({
      versionId: version._id,
      body: version.body,
      ordinal: version.ordinal,
      createdByPrincipalId: version.createdByPrincipalId,
      sourceJobId: version.sourceJobId ?? null,
      changeSummary: version.changeSummary ?? null,
      createdAt: version.createdAt,
    })),
    createdAt: deliverable.createdAt,
    updatedAt: deliverable.updatedAt,
  }
}

async function requestForEditor(ctx: QueryCtx, humanIdInput: string) {
  const principal = await requirePrincipal(ctx)
  requireEditor(principal)
  const humanId = humanIdInput.trim().toUpperCase()
  if (!humanId)
    throw new ConvexError({ code: "VALIDATION_FAILED", field: "humanId" })
  const request = await ctx.db
    .query("contentRequests")
    .withIndex("by_organization_human_id", (index) =>
      index
        .eq("organizationId", principal.organizationId)
        .eq("humanId", humanId)
    )
    .unique()
  if (!request) throw new ConvexError({ code: "NOT_FOUND" })
  const interview = await ctx.db
    .query("expertInterviews")
    .withIndex("by_request", (index) => index.eq("requestId", request._id))
    .unique()
  if (!interview || (request.requestType ?? "standard") !== "expert_interview")
    throw new ConvexError({ code: "NOT_AN_EXPERT_INTERVIEW" })
  return { principal, request }
}

async function latestDecision(
  ctx: QueryCtx | MutationCtx,
  submissionId: string
) {
  return ctx.db
    .query("expertSynthesisSelectionDecisions")
    .withIndex("by_submission_decided_at", (index) =>
      index.eq("submissionId", submissionId)
    )
    .order("desc")
    .first()
}

function inclusionProjection(
  decision: Doc<"expertSynthesisSelectionDecisions"> | null
) {
  return decision
    ? {
        state: decision.included
          ? ("included" as const)
          : ("excluded" as const),
        decidedBy: {
          principalId: decision.actorPrincipalId,
          displayName: decision.actorDisplayName,
        },
        decidedAt: decision.decidedAt,
      }
    : {
        state: "undecided" as const,
        decidedBy: null,
        decidedAt: null,
      }
}

async function submissionProjection(
  ctx: QueryCtx | MutationCtx,
  submission: Doc<"responseSubmissions">
) {
  const [decision, assets] = await Promise.all([
    latestDecision(ctx, submission._id),
    Promise.all(
      (submission.assetSnapshots ?? []).map(async (snapshot) => {
        const asset = await ctx.db.get(snapshot.assetId)
        if (
          !asset ||
          asset.organizationId !== submission.organizationId ||
          asset.requestId !== submission.requestId ||
          asset.grantId !== submission.grantId ||
          asset.workspaceId !== submission.workspaceId ||
          asset.version !== snapshot.version ||
          asset.transcriptVersion !== snapshot.transcriptVersion
        )
          throw new ConvexError({
            code: "SUBMISSION_ASSET_SNAPSHOT_INVALID",
            submissionId: submission._id,
          })
        return {
          assetId: asset._id,
          kind: asset.kind,
          scope: asset.scope,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          transcript: asset.transcript ?? null,
          version: asset.version,
          transcriptVersion: asset.transcriptVersion,
        }
      })
    ),
  ])
  const completed =
    submission.answerMode === "batch"
      ? Number(Boolean(submission.batchText.trim()))
      : submission.questionAnswers.filter(({ text }) => text.trim()).length
  const total =
    submission.answerMode === "batch" ? 1 : submission.questions.length
  const transcriptCount = assets.filter(({ transcript }) => transcript).length
  const fileLabel = assets.length === 1 ? "supporting file" : "supporting files"
  const transcriptLabel =
    transcriptCount === 1 ? "attributed transcript" : "attributed transcripts"
  return {
    submissionId: submission._id,
    source: "guest" as const,
    requestHumanId: submission.requestHumanId,
    respondent: {
      personId: submission.assignedPersonId,
      displayName: submission.respondentDisplayName,
      email: submission.respondentEmail,
    },
    workspaceRevision: submission.workspaceRevision,
    answerMode: submission.selectedAnswerMode ?? submission.answerMode,
    selectedAnswerMode: submission.selectedAnswerMode ?? submission.answerMode,
    selectionMethod:
      submission.selectionMethod ?? ("legacy_workspace_mode" as const),
    batchText: submission.batchText,
    questionAnswers: submission.questionAnswers,
    questions: [...submission.questions].sort(
      (left, right) => left.position - right.position
    ),
    assets,
    progress: { completed, total },
    sourceSummary: `${completed} of ${total} ${total === 1 ? "answer" : "answers"} complete · ${assets.length} ${fileLabel} · ${transcriptCount} ${transcriptLabel}`,
    inclusion: inclusionProjection(decision),
    submittedAt: submission.submittedAt,
  }
}

function founderSubmissionId(
  submission: Doc<"founderExpertSubmissions">
): string {
  return submission.canonicalSubmissionId ?? `founder:${submission._id}`
}

async function founderSubmissionProjection(
  ctx: QueryCtx | MutationCtx,
  submission: Doc<"founderExpertSubmissions">
) {
  const submissionId = founderSubmissionId(submission)
  const decision = await latestDecision(ctx, submissionId)
  return {
    submissionId,
    source: "founder" as const,
    requestHumanId: submission.requestHumanId,
    respondent: {
      personId: submission.founderPrincipalId,
      displayName: submission.respondentDisplayName,
      email: submission.respondentEmail,
    },
    workspaceRevision: submission.workspaceRevision,
    answerMode: "batch" as const,
    batchText: submission.batchText,
    questionAnswers: [],
    questions: [...submission.questions].sort(
      (left, right) => left.position - right.position
    ),
    assets: [],
    progress: {
      completed: Number(Boolean(submission.batchText.trim())),
      total: 1,
    },
    sourceSummary: submission.questions.length
      ? "1 of 1 batch response complete · founder submission"
      : "1 of 1 batch response complete · founder submission · historical question provenance unavailable",
    inclusion: inclusionProjection(decision),
    submittedAt: submission.submittedAt,
  }
}

async function materializeLegacyFounderSubmissions(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  principal: Awaited<ReturnType<typeof requirePrincipal>>
) {
  const [legacySubmissions, existing, interview] = await Promise.all([
    ctx.db
      .query("founderSubmissions")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .collect(),
    ctx.db
      .query("founderExpertSubmissions")
      .withIndex("by_request_submitted_at", (index) =>
        index.eq("requestId", request._id)
      )
      .collect(),
    ctx.db
      .query("expertInterviews")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .unique(),
  ])
  if (!legacySubmissions.length) return
  if (!interview) throw new ConvexError({ code: "NOT_AN_EXPERT_INTERVIEW" })
  const existingVersions = new Set(
    existing.map(({ founderVersionId }) => founderVersionId)
  )
  for (const legacy of legacySubmissions) {
    if (existingVersions.has(legacy.founderVersionId)) continue
    const [version, founderPrincipal] = await Promise.all([
      ctx.db.get(legacy.founderVersionId),
      ctx.db.get(legacy.founderPrincipalId),
    ])
    if (!version || !founderPrincipal)
      throw new ConvexError({ code: "INCONSISTENT_SUBMISSION" })
    const correlationId = `legacy-expert-submission:${legacy._id}`
    await ctx.db.insert("founderExpertSubmissions", {
      organizationId: legacy.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      founderPrincipalId: legacy.founderPrincipalId,
      founderVersionId: legacy.founderVersionId,
      canonicalSubmissionId: `founder:${legacy._id}`,
      respondentDisplayName:
        founderPrincipal.displayName ??
        founderPrincipal.email ??
        founderPrincipal.subject,
      respondentEmail:
        founderPrincipal.email ?? `${founderPrincipal.subject}@local.invalid`,
      workspaceRevision: version.revision,
      batchText: version.text,
      questions: [],
      correlationId,
      submittedAt: legacy.submittedAt,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: request.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "expert_submission.legacy_materialized",
      correlationId,
      occurredAt: Date.now(),
      afterVersion: request.aggregateVersion,
      inputFingerprint: `${legacy._id}:${legacy.founderVersionId}`,
    })
  }
}

async function requestSubmissionSources(
  ctx: QueryCtx | MutationCtx,
  requestId: Id<"contentRequests">
) {
  const [guest, founder] = await Promise.all([
    ctx.db
      .query("responseSubmissions")
      .withIndex("by_request_submitted_at", (index) =>
        index.eq("requestId", requestId)
      )
      .order("asc")
      .collect(),
    ctx.db
      .query("founderExpertSubmissions")
      .withIndex("by_request_submitted_at", (index) =>
        index.eq("requestId", requestId)
      )
      .order("asc")
      .collect(),
  ])
  return [
    ...guest.map((submission) => ({
      submissionId: String(submission._id),
      submittedAt: submission.submittedAt,
      submission,
      source: "guest" as const,
    })),
    ...founder.map((submission) => ({
      submissionId: founderSubmissionId(submission),
      submittedAt: submission.submittedAt,
      submission,
      source: "founder" as const,
    })),
  ].sort(
    (left, right) =>
      left.submittedAt - right.submittedAt ||
      left.submissionId.localeCompare(right.submissionId)
  )
}

async function sourceProjection(
  ctx: QueryCtx | MutationCtx,
  source: Awaited<ReturnType<typeof requestSubmissionSources>>[number]
) {
  return source.source === "guest"
    ? submissionProjection(ctx, source.submission)
    : founderSubmissionProjection(ctx, source.submission)
}

async function sourceSummaryProjection(
  ctx: QueryCtx | MutationCtx,
  source: Awaited<ReturnType<typeof requestSubmissionSources>>[number]
) {
  const evidence = await sourceProjection(ctx, source)
  return {
    submissionId: evidence.submissionId,
    source: evidence.source,
    requestHumanId: evidence.requestHumanId,
    respondent: evidence.respondent,
    workspaceRevision: evidence.workspaceRevision,
    progress: evidence.progress,
    sourceSummary: evidence.sourceSummary,
    inclusion: evidence.inclusion,
    submittedAt: evidence.submittedAt,
  }
}

export const listSubmissions = mutation({
  args: { humanId: v.string() },
  returns: v.array(submissionSummaryValidator),
  handler: async (ctx, args) => {
    const { principal, request } = await requestForEditor(ctx, args.humanId)
    await materializeLegacyFounderSubmissions(ctx, request, principal)
    const sources = await requestSubmissionSources(ctx, request._id)
    return Promise.all(
      sources.map((source) => sourceSummaryProjection(ctx, source))
    )
  },
})

export const setSubmissionInclusion = mutation({
  args: {
    humanId: v.string(),
    submissionId: v.string(),
    included: v.boolean(),
    correlationId: v.string(),
  },
  returns: submissionSummaryValidator,
  handler: async (ctx, args) => {
    const { principal, request } = await requestForEditor(ctx, args.humanId)
    requireActiveRequest(request)
    await materializeLegacyFounderSubmissions(ctx, request, principal)
    const source = (await requestSubmissionSources(ctx, request._id)).find(
      ({ submissionId }) => submissionId === args.submissionId
    )
    if (!source)
      throw new ConvexError({ code: "EXPERT_INTERVIEW_SUBMISSION_NOT_FOUND" })
    const correlationId = args.correlationId.trim()
    if (!correlationId || correlationId.length > 200)
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "correlationId",
      })
    const inputFingerprint = JSON.stringify({
      requestId: request._id,
      submissionId: source.submissionId,
      included: args.included,
    })
    const prior = await ctx.db
      .query("expertSynthesisSelectionDecisions")
      .withIndex("by_organization_actor_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (prior) {
      if (prior.inputFingerprint !== inputFingerprint)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return sourceSummaryProjection(ctx, source)
    }
    const now = Date.now()
    await ctx.db.insert("expertSynthesisSelectionDecisions", {
      organizationId: principal.organizationId,
      requestId: request._id,
      submissionId: source.submissionId,
      included: args.included,
      actorPrincipalId: principal._id,
      actorDisplayName:
        principal.displayName ?? principal.email ?? principal.subject,
      credentialId: principal.credentialId,
      correlationId,
      inputFingerprint,
      decidedAt: now,
    })
    const nextVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      aggregateVersion: nextVersion,
      updatedAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: args.included
        ? "expert_synthesis.submission_included"
        : "expert_synthesis.submission_excluded",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: nextVersion,
      inputFingerprint,
    })
    return sourceSummaryProjection(ctx, source)
  },
})

async function latestExpertContextVersions(
  ctx: QueryCtx | MutationCtx,
  requestId: Id<"contentRequests">
) {
  const items = await ctx.db
    .query("contextItems")
    .withIndex("by_request_kind", (index) => index.eq("requestId", requestId))
    .collect()
  const processingItems = items.filter(
    ({ title }) =>
      title === "Expert interview brief" ||
      title === "Expert interview agent instructions" ||
      title.startsWith("Knowledge gap · ") ||
      title.startsWith("Interview question · ")
  )
  const latest = await Promise.all(
    processingItems.map(async (item) => {
      const version = await ctx.db
        .query("contextItemVersions")
        .withIndex("by_context_ordinal", (index) =>
          index.eq("contextItemId", item._id)
        )
        .order("desc")
        .first()
      return version ? { item, version } : null
    })
  )
  return latest
    .filter(
      (
        entry
      ): entry is {
        item: Doc<"contextItems">
        version: Doc<"contextItemVersions">
      } => Boolean(entry)
    )
    .sort(
      (left, right) =>
        left.version.title.localeCompare(right.version.title) ||
        left.version.ordinal - right.version.ordinal
    )
}

export const listContextVersionIds = query({
  args: { humanId: v.string() },
  returns: v.array(v.id("contextItemVersions")),
  handler: async (ctx, args) => {
    const { request } = await requestForEditor(ctx, args.humanId)
    return (await latestExpertContextVersions(ctx, request._id)).map(
      ({ version }) => version._id
    )
  },
})

const processingSnapshotValidator = v.object({
  snapshotId: v.id("expertSynthesisProcessingSnapshots"),
  processingToken: v.string(),
  submissionIds: v.array(v.string()),
  contextVersionIds: v.array(v.id("contextItemVersions")),
  payloadDigest: v.string(),
  canonicalBundle: v.string(),
  issuedAt: v.number(),
  expiresAt: v.number(),
})

async function allSubmissionDecisions(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"contentRequests">
) {
  const sources = await requestSubmissionSources(ctx, request._id)
  const decisions = await Promise.all(
    sources.map(async (source) => ({
      source,
      decision: await latestDecision(ctx, source.submissionId),
    }))
  )
  if (decisions.some(({ decision }) => !decision))
    throw new ConvexError({
      code: "EXPERT_INTERVIEW_SUBMISSION_DECISIONS_REQUIRED",
    })
  return decisions as Array<{
    source: Awaited<ReturnType<typeof requestSubmissionSources>>[number]
    decision: Doc<"expertSynthesisSelectionDecisions">
  }>
}

function requireExactIncludedSubmissionSet(
  decisions: Awaited<ReturnType<typeof allSubmissionDecisions>>,
  submissionIds: Array<string>
) {
  const includedIds = decisions
    .filter(({ decision }) => decision.included)
    .map(({ source }) => source.submissionId)
  const selectedIds = new Set(submissionIds)
  if (
    includedIds.length !== submissionIds.length ||
    includedIds.some((submissionId) => !selectedIds.has(submissionId))
  )
    throw new ConvexError({ code: "EXPERT_SYNTHESIS_SELECTION_MISMATCH" })
}

async function buildCurrentProcessingBundle(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"contentRequests">,
  submissionIds: Array<string>,
  synthesisInstructions: string | null
) {
  const [interview, contextEntries, decisions, requestDeliverables] =
    await Promise.all([
      ctx.db
        .query("expertInterviews")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .unique(),
      latestExpertContextVersions(ctx, request._id),
      allSubmissionDecisions(ctx, request),
      ctx.db
        .query("deliverables")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .collect(),
    ])
  if (!interview) throw new ConvexError({ code: "NOT_AN_EXPERT_INTERVIEW" })
  requireExactIncludedSubmissionSet(decisions, submissionIds)
  const selected = submissionIds.map((submissionId) => {
    const entry = decisions.find(
      ({ source }) => source.submissionId === submissionId
    )
    if (!entry)
      throw new ConvexError({
        code: "EXPERT_INTERVIEW_SUBMISSION_NOT_FOUND",
      })
    if (!entry.decision.included)
      throw new ConvexError({
        code: "EXPERT_INTERVIEW_SUBMISSION_NOT_INCLUDED",
      })
    return entry.source
  })
  const [selectedSubmissions, existingDeliverables] = await Promise.all([
    Promise.all(selected.map((source) => sourceProjection(ctx, source))),
    Promise.all(
      requestDeliverables
        .sort((left, right) => left.createdAt - right.createdAt)
        .map((deliverable) => deliverableProjection(ctx, request, deliverable))
    ),
  ])
  const contextVersions = contextEntries.map(({ item, version }) => ({
    contextId: item._id,
    contextVersionId: version._id,
    ordinal: version.ordinal,
    kind: version.kind,
    title: version.title,
    bulletPoints: version.bulletPoints,
    citations: version.citations,
    createdAt: version.createdAt,
  }))
  const canonicalBundle = canonicalJson({
    version: 1,
    request: {
      requestId: request._id,
      humanId: request.humanId,
      title: request.title,
      requestType: "expert_interview",
    },
    expertInterview: {
      expertInterviewId: interview._id,
      requestHumanId: request.humanId,
      brief: interview.brief,
      gaps: interview.gaps,
      questions: interview.questions,
      operatorInstructions: interview.operatorInstructions ?? null,
      createdAt: interview.createdAt,
      updatedAt: interview.updatedAt,
    },
    contextVersions,
    selectedSubmissions,
    selectionDecisions: decisions.map(({ source, decision }) => ({
      decisionId: decision._id,
      submissionId: source.submissionId,
      state: decision.included ? "included" : "excluded",
      decidedBy: {
        principalId: decision.actorPrincipalId,
        displayName: decision.actorDisplayName,
      },
      decidedAt: decision.decidedAt,
    })),
    existingDeliverables,
    priorityInstructions: [
      interview.operatorInstructions ?? null,
      synthesisInstructions,
    ].filter((instruction): instruction is string => Boolean(instruction)),
  })
  if (new TextEncoder().encode(canonicalBundle).byteLength > 850_000)
    throw new ConvexError({ code: "EXPERT_SYNTHESIS_BUNDLE_TOO_LARGE" })
  return { canonicalBundle, contextVersions, interview, decisions }
}

async function validateSnapshotResources(
  ctx: QueryCtx | MutationCtx,
  input: {
    request: Doc<"contentRequests">
    organizationId: string
    submissionIds: Array<string>
    contextVersionIds: Array<Id<"contextItemVersions">>
    canonicalBundle: string
    payloadDigest: string
    synthesisInstructions: string | null
  }
) {
  const [sources, contextVersions, decisions] = await Promise.all([
    requestSubmissionSources(ctx, input.request._id),
    Promise.all(input.contextVersionIds.map((id) => ctx.db.get(id))),
    allSubmissionDecisions(ctx, input.request),
  ])
  const sourcesById = new Map(
    sources.map((source) => [source.submissionId, source])
  )
  if (
    input.submissionIds.some((submissionId) => !sourcesById.has(submissionId))
  )
    throw new ConvexError({ code: "EXPERT_SYNTHESIS_SNAPSHOT_STALE" })
  const decisionsBySubmission = new Map(
    decisions.map(({ source, decision }) => [source.submissionId, decision])
  )
  if (
    input.submissionIds.some(
      (submissionId) => !decisionsBySubmission.get(submissionId)?.included
    )
  )
    throw new ConvexError({
      code: "EXPERT_SYNTHESIS_SNAPSHOT_STALE",
    })
  if (
    contextVersions.some(
      (contextVersion) =>
        !contextVersion ||
        contextVersion.organizationId !== input.organizationId ||
        contextVersion.requestId !== input.request._id
    )
  )
    throw new ConvexError({
      code: "EXPERT_SYNTHESIS_SNAPSHOT_STALE",
    })
  let current
  try {
    current = await buildCurrentProcessingBundle(
      ctx,
      input.request,
      input.submissionIds,
      input.synthesisInstructions
    )
  } catch {
    throw new ConvexError({ code: "EXPERT_SYNTHESIS_SNAPSHOT_STALE" })
  }
  if (
    current.canonicalBundle !== input.canonicalBundle ||
    (await sha256(current.canonicalBundle)) !== input.payloadDigest
  )
    throw new ConvexError({ code: "EXPERT_SYNTHESIS_SNAPSHOT_STALE" })
  return current
}

async function processingSnapshotProjection(
  snapshot: Doc<"expertSynthesisProcessingSnapshots">
) {
  const processingToken = await encodeProcessingSnapshot({
    version: 3,
    snapshotId: snapshot._id,
    organizationId: snapshot.organizationId,
    requestId: snapshot.requestId,
    humanId: snapshot.requestHumanId,
    payloadDigest: snapshot.payloadDigest,
    issuedAt: snapshot.issuedAt,
    expiresAt: snapshot.expiresAt,
  })
  return {
    snapshotId: snapshot._id,
    processingToken,
    submissionIds: snapshot.submissionIds,
    contextVersionIds: snapshot.contextVersionIds,
    payloadDigest: snapshot.payloadDigest,
    canonicalBundle: snapshot.canonicalBundle,
    issuedAt: snapshot.issuedAt,
    expiresAt: snapshot.expiresAt,
  }
}

export const createProcessingSnapshot = mutation({
  args: {
    humanId: v.string(),
    submissionIds: v.array(v.string()),
    synthesisInstructions: v.optional(v.string()),
    correlationId: v.string(),
  },
  returns: processingSnapshotValidator,
  handler: async (ctx, args) => {
    const { principal, request } = await requestForEditor(ctx, args.humanId)
    const submissionIds = uniqueIds(args.submissionIds, "submissionIds")
    const synthesisInstructions = args.synthesisInstructions?.trim() || null
    if (synthesisInstructions && synthesisInstructions.length > 10_000)
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "synthesisInstructions",
      })
    const correlationId = args.correlationId.trim()
    if (!correlationId || correlationId.length > 200)
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "correlationId",
      })
    const inputFingerprint = await sha256(
      canonicalJson({
        requestId: request._id,
        submissionIds,
        synthesisInstructions,
      })
    )
    const prior = await ctx.db
      .query("expertSynthesisProcessingSnapshots")
      .withIndex("by_organization_actor_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (prior) {
      const priorInputFingerprint = await sha256(
        canonicalJson({
          requestId: prior.requestId,
          submissionIds: prior.submissionIds,
          synthesisInstructions: prior.synthesisInstructions ?? null,
        })
      )
      if (priorInputFingerprint !== inputFingerprint)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return processingSnapshotProjection(prior)
    }
    requireActiveRequest(request)
    await materializeLegacyFounderSubmissions(ctx, request, principal)
    const { canonicalBundle, contextVersions, interview } =
      await buildCurrentProcessingBundle(
        ctx,
        request,
        submissionIds,
        synthesisInstructions
      )
    const payloadDigest = await sha256(canonicalBundle)
    const issuedAt = Date.now()
    const expiresAt = issuedAt + PROCESSING_SNAPSHOT_TTL_MS
    const snapshotId = await ctx.db.insert(
      "expertSynthesisProcessingSnapshots",
      {
        organizationId: principal.organizationId,
        requestId: request._id,
        requestHumanId: request.humanId,
        submissionIds,
        contextVersionIds: contextVersions.map(
          ({ contextVersionId }) => contextVersionId
        ),
        expertInterviewUpdatedAt: interview.updatedAt,
        synthesisInstructions: synthesisInstructions ?? undefined,
        canonicalBundle,
        payloadDigest,
        actorPrincipalId: principal._id,
        credentialId: principal.credentialId,
        correlationId,
        inputFingerprint,
        issuedAt,
        expiresAt,
      }
    )
    const snapshot = await ctx.db.get(snapshotId)
    if (!snapshot) throw new ConvexError({ code: "WRITE_FAILED" })
    return processingSnapshotProjection(snapshot)
  },
})

export const verifyProcessingSnapshot = query({
  args: {
    humanId: v.string(),
    processingToken: v.string(),
    submissionIds: v.array(v.string()),
  },
  returns: processingSnapshotValidator,
  handler: async (ctx, args) => {
    const { principal, request } = await requestForEditor(ctx, args.humanId)
    requireActiveRequest(request)
    const payload = await decodeProcessingSnapshot(args.processingToken)
    const snapshot = await ctx.db.get(payload.snapshotId)
    const suppliedSubmissionIds = uniqueIds(args.submissionIds, "submissionIds")
    if (
      !snapshot ||
      snapshot.organizationId !== principal.organizationId ||
      snapshot.requestId !== request._id ||
      snapshot.requestHumanId !== request.humanId ||
      payload.organizationId !== snapshot.organizationId ||
      payload.requestId !== snapshot.requestId ||
      payload.humanId !== snapshot.requestHumanId ||
      payload.payloadDigest !== snapshot.payloadDigest ||
      payload.issuedAt !== snapshot.issuedAt ||
      payload.expiresAt !== snapshot.expiresAt ||
      snapshot.expiresAt <= Date.now() ||
      JSON.stringify(snapshot.submissionIds) !==
        JSON.stringify(suppliedSubmissionIds)
    )
      throw new ConvexError({ code: "INVALID_EXPERT_SYNTHESIS_SNAPSHOT" })
    await validateSnapshotResources(ctx, {
      request,
      organizationId: principal.organizationId,
      submissionIds: snapshot.submissionIds,
      contextVersionIds: snapshot.contextVersionIds,
      canonicalBundle: snapshot.canonicalBundle,
      payloadDigest: snapshot.payloadDigest,
      synthesisInstructions: snapshot.synthesisInstructions ?? null,
    })
    return processingSnapshotProjection(snapshot)
  },
})

const provenanceValidator = v.object({
  provenanceId: v.id("expertSynthesisProvenance"),
  deliverableId: v.id("deliverables"),
  versionId: v.id("deliverableVersions"),
  processingSnapshotId: v.id("expertSynthesisProcessingSnapshots"),
  submissionIds: v.array(v.string()),
  contextVersionIds: v.array(v.id("contextItemVersions")),
  payloadDigest: v.string(),
  canonicalBundle: v.string(),
})

const completionValidator = v.object({
  deliverable: deliverableValidator,
  provenance: provenanceValidator,
})

export const completeProcessing = mutation({
  args: {
    humanId: v.string(),
    processingToken: v.string(),
    submissionIds: v.array(v.string()),
    payloadDigest: v.string(),
    body: v.string(),
    jobId: v.optional(v.id("agentJobs")),
    leaseToken: v.optional(v.string()),
    leaseGeneration: v.optional(v.number()),
    deliverableId: v.optional(v.id("deliverables")),
    name: v.optional(v.string()),
    changeSummary: v.optional(v.string()),
    correlationId: v.string(),
  },
  returns: completionValidator,
  handler: async (ctx, args) => {
    const { principal, request } = await requestForEditor(ctx, args.humanId)
    const payload = await decodeProcessingSnapshot(args.processingToken)
    const snapshot = await ctx.db.get(payload.snapshotId)
    const submissionIds = uniqueIds(args.submissionIds, "submissionIds")
    const suppliedPayloadDigest = requirePayloadDigest(args.payloadDigest)
    const body = args.body.trim()
    const name = args.name?.trim() || "Expert interview article draft"
    const changeSummary =
      args.changeSummary?.trim() ||
      "Processed selected Expert Interview Submissions"
    const correlationId = args.correlationId.trim()
    if (
      !body ||
      body.length > 100_000 ||
      !name ||
      name.length > 200 ||
      changeSummary.length > 500 ||
      !correlationId ||
      correlationId.length > 200
    )
      throw new ConvexError({ code: "VALIDATION_FAILED" })
    if (
      !snapshot ||
      snapshot.organizationId !== principal.organizationId ||
      snapshot.requestId !== request._id ||
      snapshot.requestHumanId !== request.humanId ||
      payload.organizationId !== snapshot.organizationId ||
      payload.requestId !== snapshot.requestId ||
      payload.humanId !== snapshot.requestHumanId ||
      payload.payloadDigest !== snapshot.payloadDigest ||
      payload.issuedAt !== snapshot.issuedAt ||
      payload.expiresAt !== snapshot.expiresAt ||
      suppliedPayloadDigest !== snapshot.payloadDigest ||
      JSON.stringify(snapshot.submissionIds) !== JSON.stringify(submissionIds)
    )
      throw new ConvexError({ code: "INVALID_EXPERT_SYNTHESIS_SNAPSHOT" })
    const inputFingerprint = await sha256(
      canonicalJson({
        requestId: request._id,
        processingSnapshotId: snapshot._id,
        submissionIds,
        contextVersionIds: snapshot.contextVersionIds,
        payloadDigest: snapshot.payloadDigest,
        bodyDigest: await sha256(body),
        name,
        changeSummary,
        deliverableId: args.deliverableId ?? null,
      })
    )
    const prior = await ctx.db
      .query("expertSynthesisProvenance")
      .withIndex("by_organization_actor_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (prior) {
      if (prior.inputFingerprint !== inputFingerprint)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return completionProjection(ctx, prior)
    }
    requireActiveRequest(request)
    if (
      payload.organizationId !== principal.organizationId ||
      snapshot.expiresAt <= Date.now() ||
      JSON.stringify(snapshot.submissionIds) !== JSON.stringify(submissionIds)
    )
      throw new ConvexError({ code: "INVALID_EXPERT_SYNTHESIS_SNAPSHOT" })
    await validateSnapshotResources(ctx, {
      request,
      organizationId: principal.organizationId,
      submissionIds: snapshot.submissionIds,
      contextVersionIds: snapshot.contextVersionIds,
      canonicalBundle: snapshot.canonicalBundle,
      payloadDigest: snapshot.payloadDigest,
      synthesisInstructions: snapshot.synthesisInstructions ?? null,
    })
    const legacyFounderJob = await ctx.db
      .query("agentJobs")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .unique()
    const suppliedLeaseTuple = [
      args.jobId,
      args.leaseToken,
      args.leaseGeneration,
    ]
    const hasAnyJobLeaseArgument = suppliedLeaseTuple.some(
      (value) => value !== undefined
    )
    const hasCompleteJobLease = suppliedLeaseTuple.every(
      (value) => value !== undefined
    )
    if (hasAnyJobLeaseArgument && !hasCompleteJobLease)
      throw new ConvexError({
        code: "EXPERT_INTERVIEW_AGENT_JOB_LEASE_REQUIRED",
      })
    if (!legacyFounderJob) {
      if (hasCompleteJobLease)
        throw new ConvexError({
          code: "EXPERT_INTERVIEW_AGENT_JOB_NOT_FOUND",
        })
    } else if (legacyFounderJob.status === "completed") {
      if (hasCompleteJobLease)
        throw new ConvexError({
          code: "EXPERT_INTERVIEW_AGENT_JOB_ALREADY_COMPLETED",
        })
    } else {
      if (!hasCompleteJobLease)
        throw new ConvexError({
          code: "EXPERT_INTERVIEW_AGENT_JOB_LEASE_REQUIRED",
        })
      if (args.jobId !== legacyFounderJob._id)
        throw new ConvexError({
          code: "EXPERT_INTERVIEW_AGENT_JOB_NOT_FOUND",
        })
    }
    const leaseBackedFounderJob =
      legacyFounderJob &&
      legacyFounderJob.status !== "completed" &&
      hasCompleteJobLease
        ? legacyFounderJob
        : null
    const requestDeliverables = await ctx.db
      .query("deliverables")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .collect()
    let deliverable = args.deliverableId
      ? requestDeliverables.find(
          (candidate) => candidate._id === args.deliverableId
        )
      : undefined
    if (
      args.deliverableId &&
      (!deliverable ||
        deliverable.organizationId !== principal.organizationId ||
        deliverable.requestId !== request._id ||
        (deliverable.retention ?? "active") !== "active" ||
        deliverable.kind !== "blog_article" ||
        (args.name?.trim() && args.name.trim() !== deliverable.name))
    )
      throw new ConvexError({ code: "DELIVERABLE_NOT_FOUND" })
    const now = Date.now()
    if (!deliverable) {
      assertWithinRequestLimit(
        requestDeliverables.length,
        MAX_DELIVERABLES_PER_REQUEST,
        "deliverables"
      )
      const deliverableId = await ctx.db.insert("deliverables", {
        organizationId: principal.organizationId,
        requestId: request._id,
        kind: "blog_article",
        name,
        isPrimary: false,
        retention: "active",
        createdAt: now,
        updatedAt: now,
      })
      const createdDeliverable = await ctx.db.get(deliverableId)
      if (!createdDeliverable) throw new ConvexError({ code: "WRITE_FAILED" })
      deliverable = createdDeliverable
    }
    const latestVersion = await ctx.db
      .query("deliverableVersions")
      .withIndex("by_deliverable_ordinal", (index) =>
        index.eq("deliverableId", deliverable!._id)
      )
      .order("desc")
      .first()
    const versionId = await ctx.db.insert("deliverableVersions", {
      organizationId: principal.organizationId,
      requestId: request._id,
      deliverableId: deliverable._id,
      body,
      ordinal: (latestVersion?.ordinal ?? 0) + 1,
      createdByPrincipalId: principal._id,
      sourceJobId: leaseBackedFounderJob?._id,
      correlationId,
      changeSummary,
      createdAt: now,
    })
    await ctx.db.patch(deliverable._id, {
      currentCandidateVersionId: versionId,
      updatedAt: now,
    })
    await ctx.db.insert("deliverableOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      requestId: request._id,
      operation: latestVersion ? "create_version" : "create_derivative",
      correlationId,
      inputFingerprint,
      deliverableId: deliverable._id,
      versionId,
      createdAt: now,
    })
    const savedDeliverable = await ctx.db.get(deliverable._id)
    if (!savedDeliverable) throw new ConvexError({ code: "WRITE_FAILED" })
    const immutableDeliverableProjection = await deliverableProjection(
      ctx,
      request,
      savedDeliverable
    )
    const completionDeliverable = {
      ...immutableDeliverableProjection,
      versions: await Promise.all(
        immutableDeliverableProjection.versions.map(
          async ({ body: versionBody, ...version }) => ({
            ...version,
            bodyDigest: await sha256(versionBody),
          })
        )
      ),
    }
    const provenanceId = await ctx.db.insert("expertSynthesisProvenance", {
      organizationId: principal.organizationId,
      requestId: request._id,
      deliverableId: deliverable._id,
      versionId,
      processingSnapshotId: snapshot._id,
      submissionIds: snapshot.submissionIds,
      contextVersionIds: snapshot.contextVersionIds,
      payloadDigest: snapshot.payloadDigest,
      canonicalBundle: snapshot.canonicalBundle,
      completionDeliverable,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      correlationId,
      inputFingerprint,
      createdAt: now,
    })
    const nextVersion = leaseBackedFounderJob
      ? await completeAgentJobWithVersion(ctx, {
          job: leaseBackedFounderJob,
          request,
          principal,
          leaseToken: args.leaseToken!,
          leaseGeneration: args.leaseGeneration!,
          versionId,
          correlationId,
          now,
        })
      : request.aggregateVersion + 1
    if (!leaseBackedFounderJob)
      await ctx.db.patch(request._id, {
        lifecycle:
          request.lifecycle === "responded" ? "responded" : "ready_to_respond",
        aggregateVersion: nextVersion,
        updatedAt: now,
      })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "expert_synthesis.completed",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: nextVersion,
      inputFingerprint,
    })
    if (!leaseBackedFounderJob)
      await refreshOperatorWorkspaceProjection(ctx, request._id)
    const provenance = await ctx.db.get(provenanceId)
    if (!provenance) throw new ConvexError({ code: "WRITE_FAILED" })
    return completionProjection(ctx, provenance)
  },
})

function uniqueIds<T extends string>(values: Array<T>, field: string) {
  if (
    !values.length ||
    values.length > 100 ||
    new Set(values).size !== values.length
  )
    throw new ConvexError({ code: "VALIDATION_FAILED", field })
  return values
}

function requirePayloadDigest(value: string) {
  const digest = value.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(digest))
    throw new ConvexError({ code: "VALIDATION_FAILED", field: "payloadDigest" })
  return digest
}

function provenanceProjection(provenance: Doc<"expertSynthesisProvenance">) {
  return {
    provenanceId: provenance._id,
    deliverableId: provenance.deliverableId,
    versionId: provenance.versionId,
    processingSnapshotId: provenance.processingSnapshotId,
    submissionIds: provenance.submissionIds,
    contextVersionIds: provenance.contextVersionIds,
    payloadDigest: provenance.payloadDigest,
    canonicalBundle: provenance.canonicalBundle,
  }
}

async function completionProjection(
  ctx: QueryCtx | MutationCtx,
  provenance: Doc<"expertSynthesisProvenance">
) {
  const versions = await Promise.all(
    provenance.completionDeliverable.versions.map(async (metadata) => {
      const version = await ctx.db.get(metadata.versionId)
      if (
        !version ||
        version.deliverableId !== provenance.deliverableId ||
        (await sha256(version.body)) !== metadata.bodyDigest
      )
        throw new ConvexError({ code: "EXPERT_SYNTHESIS_PROVENANCE_CORRUPT" })
      return {
        versionId: metadata.versionId,
        body: version.body,
        ordinal: metadata.ordinal,
        createdByPrincipalId: metadata.createdByPrincipalId,
        sourceJobId: metadata.sourceJobId,
        changeSummary: metadata.changeSummary,
        createdAt: metadata.createdAt,
      }
    })
  )
  return {
    deliverable: {
      ...provenance.completionDeliverable,
      versions,
    },
    provenance: provenanceProjection(provenance),
  }
}
