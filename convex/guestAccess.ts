import { ConvexError, v } from "convex/values"

import type { Doc } from "./_generated/dataModel"
import { mutation, query, type MutationCtx } from "./_generated/server"
import { expertInterviewBriefValidator } from "./schema"
import { personSummaryValidator } from "./people"
import {
  guestGrantParentAccess,
  requireActiveGuestGrantRequest,
  requireActiveRequest,
  requireEditor,
  requirePrincipal,
} from "./lib/authorization"
import {
  enqueueAdministratorNotifications,
  reactivateGuestExpiryNotifications,
  suppressGuestExpiryNotifications,
} from "./lib/notificationOutbox"
import {
  authenticatedGuestAccessNetworkSource,
  guestAccessBoundaryArgs,
  recordFailedGuestTokenAttempt,
} from "./lib/guestAccessBoundary"
import { standardResponseQuestionId } from "../shared/standard-response-question"

const GUEST_ACCESS_DURATION_MS = 48 * 60 * 60 * 1_000
const EDITOR_LEASE_DURATION_MS = 45_000
const MAX_GUEST_ACCESS_GRANTS_PER_REQUEST = 100

const grantStateValidator = v.union(
  v.literal("generated"),
  v.literal("opened"),
  v.literal("in_progress"),
  v.literal("submitted"),
  v.literal("expired"),
  v.literal("revoked")
)

const grantEventKindValidator = v.union(
  v.literal("generated"),
  v.literal("opened"),
  v.literal("first_progress"),
  v.literal("submitted"),
  v.literal("expired"),
  v.literal("revoked"),
  v.literal("renewed"),
  v.literal("reopened"),
  v.literal("taken_over")
)

const grantEventValidator = v.object({
  kind: grantEventKindValidator,
  occurredAt: v.number(),
  actor: v.union(
    v.literal("guest"),
    v.literal("administrator"),
    v.literal("system")
  ),
  actorName: v.string(),
  tokenVersion: v.union(v.number(), v.null()),
})

const grantSummaryValidator = v.object({
  grantId: v.id("guestAccessGrants"),
  requestHumanId: v.string(),
  person: personSummaryValidator,
  state: grantStateValidator,
  tokenVersion: v.number(),
  expiresAt: v.number(),
  createdAt: v.number(),
  firstOpenedAt: v.union(v.number(), v.null()),
  latestActivityAt: v.number(),
  progress: v.object({ completed: v.number(), total: v.number() }),
  submitted: v.boolean(),
  events: v.array(grantEventValidator),
})

const answerModeValidator = v.union(v.literal("batch"), v.literal("one_by_one"))
const submissionSelectionMethodValidator = v.union(
  v.literal("single_mode"),
  v.literal("respondent_choice"),
  v.literal("legacy_workspace_mode")
)

const responseFeedbackScopeValidator = v.union(
  v.object({ kind: v.literal("workspace") }),
  v.object({
    kind: v.literal("question"),
    questionId: v.string(),
  }),
  v.object({
    kind: v.literal("asset"),
    assetId: v.id("responseAssets"),
  })
)
const responseCommentScopeValidator = v.union(
  v.object({ kind: v.literal("workspace") }),
  v.object({
    kind: v.literal("question"),
    questionId: v.string(),
  })
)

const publicResponseFeedbackValidator = v.object({
  feedbackId: v.id("responseFeedback"),
  scope: responseFeedbackScopeValidator,
  body: v.string(),
  author: v.object({ displayName: v.string() }),
  createdAt: v.number(),
})

const responseFeedbackValidator = v.object({
  feedbackId: v.id("responseFeedback"),
  scope: responseFeedbackScopeValidator,
  body: v.string(),
  author: v.object({
    principalId: v.id("principals"),
    displayName: v.string(),
  }),
  createdAt: v.number(),
})

const responseSubmissionValidator = v.object({
  submissionId: v.id("responseSubmissions"),
  requestHumanId: v.string(),
  respondent: v.object({
    personId: v.id("people"),
    displayName: v.string(),
    email: v.string(),
  }),
  workspaceRevision: v.number(),
  answerMode: answerModeValidator,
  selectedAnswerMode: answerModeValidator,
  selectionMethod: submissionSelectionMethodValidator,
  batchText: v.string(),
  questionAnswers: v.array(
    v.object({ questionId: v.string(), text: v.string() })
  ),
  questions: v.array(
    v.object({
      questionId: v.string(),
      question: v.string(),
      motivation: v.string(),
      position: v.number(),
      version: v.number(),
    })
  ),
  assetSnapshots: v.array(
    v.object({
      assetId: v.id("responseAssets"),
      version: v.number(),
      transcriptVersion: v.number(),
      kind: v.union(v.literal("audio"), v.literal("attachment")),
      scope: v.union(
        v.object({ kind: v.literal("batch") }),
        v.object({
          kind: v.literal("question"),
          questionId: v.string(),
        })
      ),
    })
  ),
  submittedAt: v.number(),
})

const responseWorkspaceValidator = v.object({
  answerMode: answerModeValidator,
  batchText: v.string(),
  questionAnswers: v.array(
    v.object({ questionId: v.string(), text: v.string() })
  ),
  progress: v.object({
    completed: v.number(),
    total: v.number(),
  }),
  revision: v.number(),
  locked: v.boolean(),
  lockedAt: v.union(v.number(), v.null()),
  feedback: v.array(publicResponseFeedbackValidator),
  editorLease: v.object({
    active: v.boolean(),
    generation: v.number(),
    expiresAt: v.union(v.number(), v.null()),
  }),
})

const adminResponseWorkspaceValidator = v.object({
  answerMode: answerModeValidator,
  batchText: v.string(),
  questionAnswers: v.array(
    v.object({ questionId: v.string(), text: v.string() })
  ),
  progress: v.object({
    completed: v.number(),
    total: v.number(),
  }),
  revision: v.number(),
  locked: v.boolean(),
  lockedAt: v.union(v.number(), v.null()),
  feedback: v.array(responseFeedbackValidator),
  editorLease: v.object({
    active: v.boolean(),
    generation: v.number(),
    expiresAt: v.union(v.number(), v.null()),
  }),
})

const responseQuestionValidator = v.object({
  questionId: v.string(),
  question: v.string(),
  motivation: v.string(),
})

const editorLeaseResultValidator = v.object({
  status: v.union(v.literal("editing"), v.literal("conflict")),
  editorLease: v.object({
    active: v.boolean(),
    generation: v.number(),
    expiresAt: v.union(v.number(), v.null()),
  }),
})

const guestInterviewQuestionValidator = v.object({
  id: v.string(),
  question: v.string(),
  motivation: v.string(),
})

const availableViewValidator = v.object({
  status: v.literal("available"),
  grantId: v.id("guestAccessGrants"),
  expiresAt: v.number(),
  request: v.object({
    humanId: v.string(),
    title: v.string(),
    requestType: v.union(v.literal("standard"), v.literal("expert_interview")),
    brief: v.object({
      question: v.union(v.string(), v.null()),
      body: v.union(v.string(), v.null()),
    }),
  }),
  interview: v.union(
    v.object({
      brief: expertInterviewBriefValidator,
      questions: v.array(guestInterviewQuestionValidator),
    }),
    v.null()
  ),
  questions: v.array(guestInterviewQuestionValidator),
  workspace: responseWorkspaceValidator,
})

function required(value: string, field: string, maxLength = 200) {
  const cleaned = value.trim()
  if (!cleaned || cleaned.length > maxLength)
    throw new ConvexError({ code: "VALIDATION_FAILED", field })
  return cleaned
}

function tokenSecret() {
  const secret = process.env.GUEST_ACCESS_TOKEN_SECRET
  if (!secret || new TextEncoder().encode(secret).byteLength < 32)
    throw new ConvexError({ code: "GUEST_ACCESS_SECRET_NOT_CONFIGURED" })
  return secret
}

async function sign(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

async function hmac(value: string) {
  return sign(tokenSecret(), value)
}

function derivedState(grant: Doc<"guestAccessGrants">, now: number) {
  if (grant.revokedAt || grant.state === "revoked") return "revoked" as const
  if (grant.expiresAt <= now) return "expired" as const
  return grant.state
}

function personSummary(person: Doc<"people">) {
  return {
    personId: person._id,
    displayName: person.displayName,
    email: person.email,
    principalId: person.principalId ?? null,
    isFounder: person.isFounder,
  }
}

function editorLeaseProjection(
  workspace: Doc<"responseWorkspaces">,
  now = Date.now()
) {
  const expiresAt = workspace.leaseExpiresAt ?? null
  return {
    active: Boolean(workspace.leaseHolderHash && expiresAt && expiresAt > now),
    generation: workspace.leaseGeneration ?? 0,
    expiresAt: expiresAt && expiresAt > now ? expiresAt : null,
  }
}

function responseWorkspaceBaseProjection(
  workspace: Doc<"responseWorkspaces">,
  now = Date.now()
) {
  const completed =
    workspace.answerMode === "batch"
      ? workspace.batchText.trim()
        ? workspace.questionAnswers.length
        : 0
      : workspace.questionAnswers.filter(({ text }) => text.trim()).length
  return {
    answerMode: workspace.answerMode,
    batchText: workspace.batchText,
    questionAnswers: workspace.questionAnswers,
    progress: {
      completed,
      total: workspace.questionAnswers.length,
    },
    revision: workspace.revision,
    locked: Boolean(workspace.lockedAt),
    lockedAt: workspace.lockedAt ?? null,
    editorLease: editorLeaseProjection(workspace, now),
  }
}

function publicResponseFeedbackProjection(feedback: Doc<"responseFeedback">) {
  return {
    feedbackId: feedback._id,
    scope: feedback.scope,
    body: feedback.body,
    author: { displayName: feedback.authorDisplayName },
    createdAt: feedback.createdAt,
  }
}

function responseFeedbackProjection(feedback: Doc<"responseFeedback">) {
  return {
    feedbackId: feedback._id,
    scope: feedback.scope,
    body: feedback.body,
    author: {
      principalId: feedback.authorPrincipalId,
      displayName: feedback.authorDisplayName,
    },
    createdAt: feedback.createdAt,
  }
}

function responseWorkspaceProjection(
  workspace: Doc<"responseWorkspaces">,
  now = Date.now(),
  feedback: Array<Doc<"responseFeedback">> = []
) {
  return {
    ...responseWorkspaceBaseProjection(workspace, now),
    feedback: feedback.map(publicResponseFeedbackProjection),
  }
}

function adminResponseWorkspaceProjection(
  workspace: Doc<"responseWorkspaces">,
  now = Date.now(),
  feedback: Array<Doc<"responseFeedback">> = []
) {
  return {
    ...responseWorkspaceBaseProjection(workspace, now),
    feedback: feedback.map(responseFeedbackProjection),
  }
}

function responseSubmissionProjection(submission: Doc<"responseSubmissions">) {
  return {
    submissionId: submission._id,
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
    questions: submission.questions,
    assetSnapshots: submission.assetSnapshots ?? [],
    submittedAt: submission.submittedAt,
  }
}

async function workspaceFeedback(
  ctx: MutationCtx | Parameters<typeof requirePrincipal>[0],
  workspaceId: Doc<"responseWorkspaces">["_id"]
) {
  const feedback = await ctx.db
    .query("responseFeedback")
    .withIndex("by_workspace_created_at", (index) =>
      index.eq("workspaceId", workspaceId)
    )
    .order("asc")
    .collect()
  // Asset feedback is projected with its evidence asset by guestEvidence.
  // Keeping it out of the workspace stream prevents duplicate, incorrectly
  // contextualized feedback while preserving the dedicated asset attribution.
  return feedback.filter(({ scope }) => scope.kind !== "asset")
}

async function loadOrCreateResponseWorkspace(
  ctx: MutationCtx,
  grant: Doc<"guestAccessGrants">,
  questionIds: Array<string>,
  now: number,
  questionAliases: Readonly<Record<string, ReadonlyArray<string>>> = {}
) {
  const existing = await ctx.db
    .query("responseWorkspaces")
    .withIndex("by_grant", (index) => index.eq("grantId", grant._id))
    .unique()
  if (existing) {
    if (existing.lockedAt) return existing
    const activeAnswers = new Map(
      existing.questionAnswers.map((answer) => [answer.questionId, answer.text])
    )
    const retiredAnswers = new Map(
      (existing.retiredQuestionAnswers ?? []).map((answer) => [
        answer.questionId,
        answer,
      ])
    )
    const reconciledAnswers = questionIds.map((questionId) => ({
      questionId,
      text:
        activeAnswers.get(questionId) ??
        questionAliases[questionId]
          ?.map((alias) => activeAnswers.get(alias))
          .find((text) => text !== undefined) ??
        retiredAnswers.get(questionId)?.text ??
        questionAliases[questionId]
          ?.map((alias) => retiredAnswers.get(alias)?.text)
          .find((text) => text !== undefined) ??
        "",
    }))
    const unchanged =
      reconciledAnswers.length === existing.questionAnswers.length &&
      reconciledAnswers.every(
        (answer, index) =>
          answer.questionId === existing.questionAnswers[index]?.questionId &&
          answer.text === existing.questionAnswers[index]?.text
      )
    if (unchanged) return existing

    const activeQuestionIds = new Set(questionIds)
    const nextRetiredAnswers = new Map(retiredAnswers)
    for (const answer of existing.questionAnswers) {
      if (!activeQuestionIds.has(answer.questionId)) {
        nextRetiredAnswers.set(answer.questionId, {
          ...answer,
          retiredAt: now,
        })
      }
    }
    for (const questionId of activeQuestionIds)
      nextRetiredAnswers.delete(questionId)

    await ctx.db.patch(existing._id, {
      questionAnswers: reconciledAnswers,
      retiredQuestionAnswers: [...nextRetiredAnswers.values()],
      revision: existing.revision + 1,
      updatedAt: now,
    })
    const reconciled = await ctx.db.get(existing._id)
    if (!reconciled) throw new ConvexError({ code: "WRITE_FAILED" })
    return reconciled
  }
  const workspaceId = await ctx.db.insert("responseWorkspaces", {
    organizationId: grant.organizationId,
    requestId: grant.requestId,
    grantId: grant._id,
    answerMode: "one_by_one",
    batchText: "",
    questionAnswers: questionIds.map((questionId) => ({
      questionId,
      text: "",
    })),
    revision: 0,
    leaseGeneration: 0,
    pendingRequiredOperationIds: [],
    createdAt: now,
    updatedAt: now,
  })
  const workspace = await ctx.db.get(workspaceId)
  if (!workspace) throw new ConvexError({ code: "WRITE_FAILED" })
  return workspace
}

async function loadGrantByToken(
  ctx: MutationCtx,
  token: string,
  now: number,
  networkSource?: string
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const tokenHash = await hmac(token)
  const grant = await ctx.db
    .query("guestAccessGrants")
    .withIndex("by_token_hash", (index) =>
      index.eq("currentTokenHash", tokenHash)
    )
    .unique()
  const unavailable =
    !grant ||
    grant.revokedAt ||
    grant.state === "revoked" ||
    grant.expiresAt <= now
  if (unavailable) {
    if (
      networkSource &&
      !(await recordFailedGuestTokenAttempt(ctx, token, networkSource, now))
    )
      throw new ConvexError({ code: "RATE_LIMITED" })
    return null
  }
  await requireActiveGuestGrantRequest(ctx, grant)
  return grant
}

async function grantSummary(
  grant: Doc<"guestAccessGrants">,
  requestHumanId: string,
  person: Doc<"people">,
  now = Date.now(),
  workspace: Doc<"responseWorkspaces"> | null = null,
  lifecycleEvents: Array<Doc<"guestAccessEvents">> = [],
  workspaceEvents: Array<Doc<"responseWorkspaceEvents">> = [],
  actorNames: Map<string, string> = new Map()
) {
  const projection = workspace
    ? responseWorkspaceProjection(workspace, now)
    : null
  const events: Array<{
    kind:
      | "generated"
      | "opened"
      | "first_progress"
      | "submitted"
      | "expired"
      | "revoked"
      | "renewed"
      | "reopened"
      | "taken_over"
    occurredAt: number
    actor: "guest" | "administrator" | "system"
    actorName: string
    tokenVersion: number | null
  }> = [
    {
      kind: "generated",
      occurredAt: grant.createdAt,
      actor: "administrator",
      actorName:
        actorNames.get(String(grant.createdByPrincipalId)) ?? "Administrator",
      tokenVersion: 1,
    },
  ]
  if (grant.firstOpenedAt)
    events.push({
      kind: "opened",
      occurredAt: grant.firstOpenedAt,
      actor: "guest",
      actorName: person.displayName,
      tokenVersion: null,
    })
  if (
    grant.firstProgressAt &&
    !workspaceEvents.some(({ kind }) => kind === "first_progress")
  )
    events.push({
      kind: "first_progress",
      occurredAt: grant.firstProgressAt,
      actor: "guest",
      actorName: person.displayName,
      tokenVersion: null,
    })
  for (const event of lifecycleEvents)
    events.push({
      kind: event.kind,
      occurredAt: event.occurredAt,
      actor: event.actorPrincipalId ? "administrator" : "system",
      actorName: event.actorPrincipalId
        ? (actorNames.get(String(event.actorPrincipalId)) ?? "Administrator")
        : "System",
      tokenVersion: event.tokenVersion,
    })
  if (
    grant.expiresAt <= now &&
    !grant.revokedAt &&
    !lifecycleEvents.some(({ kind }) => kind === "expired")
  )
    events.push({
      kind: "expired",
      occurredAt: grant.expiresAt,
      actor: "system",
      actorName: "System",
      tokenVersion: grant.tokenVersion,
    })
  for (const event of workspaceEvents) {
    const kind =
      event.kind === "lease_taken_over"
        ? "taken_over"
        : event.kind === "first_progress"
          ? "first_progress"
          : event.kind === "submitted"
            ? "submitted"
            : event.kind === "reopened"
              ? "reopened"
              : null
    if (kind)
      events.push({
        kind,
        occurredAt: event.occurredAt,
        actor: event.actorPrincipalId ? "administrator" : "guest",
        actorName: event.actorPrincipalId
          ? (actorNames.get(String(event.actorPrincipalId)) ?? "Administrator")
          : person.displayName,
        tokenVersion: null,
      })
  }
  return {
    grantId: grant._id,
    requestHumanId,
    person: personSummary(person),
    state: derivedState(grant, now),
    tokenVersion: grant.tokenVersion,
    expiresAt: grant.expiresAt,
    createdAt: grant.createdAt,
    firstOpenedAt: grant.firstOpenedAt ?? null,
    latestActivityAt: grant.latestActivityAt,
    progress: projection?.progress ?? { completed: 0, total: 0 },
    submitted: Boolean(workspace?.lockedAt || grant.state === "submitted"),
    events: events.sort((left, right) => left.occurredAt - right.occurredAt),
  }
}

async function loadGrantSummary(
  ctx: Parameters<typeof requirePrincipal>[0],
  grant: Doc<"guestAccessGrants">
) {
  const [request, person, workspace, lifecycleEvents] = await Promise.all([
    ctx.db.get(grant.requestId),
    ctx.db.get(grant.assignedPersonId),
    ctx.db
      .query("responseWorkspaces")
      .withIndex("by_grant", (index) => index.eq("grantId", grant._id))
      .unique(),
    ctx.db
      .query("guestAccessEvents")
      .withIndex("by_grant_occurred_at", (index) =>
        index.eq("grantId", grant._id)
      )
      .collect(),
  ])
  if (
    !request ||
    !person ||
    request.organizationId !== grant.organizationId ||
    person.organizationId !== grant.organizationId
  )
    throw new ConvexError({ code: "NOT_FOUND" })
  const workspaceEvents = workspace
    ? await ctx.db
        .query("responseWorkspaceEvents")
        .withIndex("by_grant_occurred_at", (index) =>
          index.eq("grantId", grant._id)
        )
        .collect()
    : []
  const principalIds = new Set<string>([String(grant.createdByPrincipalId)])
  for (const event of lifecycleEvents)
    if (event.actorPrincipalId) principalIds.add(String(event.actorPrincipalId))
  for (const event of workspaceEvents)
    if (event.actorPrincipalId) principalIds.add(String(event.actorPrincipalId))
  const actorNames = new Map<string, string>()
  await Promise.all(
    [...principalIds].map(async (principalId) => {
      const actor = await ctx.db.get(principalId as Doc<"principals">["_id"])
      if (actor)
        actorNames.set(
          principalId,
          actor.displayName?.trim() ||
            actor.email?.trim() ||
            actor.subject.trim() ||
            "Administrator"
        )
    })
  )
  return grantSummary(
    grant,
    request.humanId,
    person,
    Date.now(),
    workspace,
    lifecycleEvents,
    workspaceEvents,
    actorNames
  )
}

export const list = mutation({
  args: { humanId: v.string() },
  returns: v.array(grantSummaryValidator),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const humanId = required(args.humanId, "humanId").toUpperCase()
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", humanId)
      )
      .unique()
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const grants = await ctx.db
      .query("guestAccessGrants")
      .withIndex("by_request_created_at", (index) =>
        index.eq("requestId", request._id)
      )
      .order("desc")
      .take(MAX_GUEST_ACCESS_GRANTS_PER_REQUEST)
    return Promise.all(
      grants.map(async (grant) => {
        const person = await ctx.db.get(grant.assignedPersonId)
        if (!person || person.organizationId !== principal.organizationId)
          throw new ConvexError({ code: "NOT_FOUND" })
        return loadGrantSummary(ctx, grant)
      })
    )
  },
})

async function deterministicGrantToken(
  purpose: "create" | "renew",
  grantId: Doc<"guestAccessGrants">["_id"],
  tokenVersion: number,
  correlationId: string
) {
  const hex = await hmac(
    `guest-access-${purpose}:v1:${grantId}:${tokenVersion}:${correlationId}`
  )
  let binary = ""
  for (let index = 0; index < hex.length; index += 2)
    binary += String.fromCharCode(
      Number.parseInt(hex.slice(index, index + 2), 16)
    )
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export const create = mutation({
  args: {
    humanId: v.string(),
    personId: v.id("people"),
    correlationId: v.string(),
  },
  returns: v.object({
    grant: grantSummaryValidator,
    token: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const humanId = required(args.humanId, "humanId").toUpperCase()
    const correlationId = required(args.correlationId, "correlationId")
    const prior = await ctx.db
      .query("guestAccessOperations")
      .withIndex("by_organization_actor_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (prior) {
      const grant = await ctx.db.get(prior.grantId)
      const [request, person] = await Promise.all([
        grant ? ctx.db.get(grant.requestId) : null,
        ctx.db.get(args.personId),
      ])
      if (
        !grant ||
        !request ||
        grant.organizationId !== principal.organizationId ||
        request.organizationId !== principal.organizationId
      )
        throw new ConvexError({ code: "NOT_FOUND" })
      const inputFingerprint = JSON.stringify({
        requestId: request._id,
        assignedPersonId: args.personId,
      })
      if (
        prior.inputFingerprint !== inputFingerprint ||
        request.humanId !== humanId ||
        grant.assignedPersonId !== args.personId
      )
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      if (prior.resultGrant)
        return {
          grant: prior.resultGrant,
          token: null,
        }
      if (!person || person.organizationId !== principal.organizationId)
        throw new ConvexError({ code: "NOT_FOUND" })
      return {
        grant: await loadGrantSummary(ctx, grant),
        token: null,
      }
    }
    const [request, person] = await Promise.all([
      ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (index) =>
          index
            .eq("organizationId", principal.organizationId)
            .eq("humanId", humanId)
        )
        .unique(),
      ctx.db.get(args.personId),
    ])
    if (
      !request ||
      !person ||
      person.organizationId !== principal.organizationId
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    requireActiveRequest(request)
    const inputFingerprint = JSON.stringify({
      requestId: request._id,
      assignedPersonId: person._id,
    })
    const currentGrants = await ctx.db
      .query("guestAccessGrants")
      .withIndex("by_request_created_at", (index) =>
        index.eq("requestId", request._id)
      )
      .take(MAX_GUEST_ACCESS_GRANTS_PER_REQUEST)
    if (currentGrants.length >= MAX_GUEST_ACCESS_GRANTS_PER_REQUEST)
      throw new ConvexError({
        code: "GUEST_ACCESS_GRANT_LIMIT_REACHED",
        limit: MAX_GUEST_ACCESS_GRANTS_PER_REQUEST,
      })
    const now = Date.now()
    const grantId = await ctx.db.insert("guestAccessGrants", {
      organizationId: principal.organizationId,
      requestId: request._id,
      assignedPersonId: person._id,
      currentTokenHash: "pending",
      tokenVersion: 1,
      expiresAt: now + GUEST_ACCESS_DURATION_MS,
      state: "generated",
      createdByPrincipalId: principal._id,
      createdAt: now,
      updatedAt: now,
      latestActivityAt: now,
    })
    const token = await deterministicGrantToken(
      "create",
      grantId,
      1,
      correlationId
    )
    await ctx.db.patch(grantId, { currentTokenHash: await hmac(token) })
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
      operation: "guest_access.created",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: nextVersion,
      inputFingerprint,
    })
    const grant = await ctx.db.get(grantId)
    if (!grant) throw new ConvexError({ code: "WRITE_FAILED" })
    const resultGrant = await grantSummary(grant, request.humanId, person, now)
    await ctx.db.insert("guestAccessOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      correlationId,
      inputFingerprint,
      grantId,
      resultGrant,
      createdAt: now,
    })
    return {
      grant: resultGrant,
      token,
    }
  },
})

async function renewalToken(
  grantId: Doc<"guestAccessGrants">["_id"],
  tokenVersion: number,
  correlationId: string
) {
  return deterministicGrantToken("renew", grantId, tokenVersion, correlationId)
}

async function lifecycleOperationFor(
  ctx: MutationCtx,
  principal: Awaited<ReturnType<typeof requirePrincipal>>,
  correlationId: string
) {
  return ctx.db
    .query("guestAccessLifecycleOperations")
    .withIndex("by_organization_actor_correlation", (index) =>
      index
        .eq("organizationId", principal.organizationId)
        .eq("actorPrincipalId", principal._id)
        .eq("correlationId", correlationId)
    )
    .unique()
}

async function recordObservedExpiry(
  ctx: MutationCtx,
  grant: Doc<"guestAccessGrants">,
  correlationId: string,
  now: number
) {
  if (grant.expiresAt > now || grant.revokedAt) return
  await ctx.db.insert("guestAccessEvents", {
    organizationId: grant.organizationId,
    requestId: grant.requestId,
    grantId: grant._id,
    kind: "expired",
    tokenVersion: grant.tokenVersion,
    correlationId: `expired:${correlationId}`,
    occurredAt: grant.expiresAt,
  })
}

export const revoke = mutation({
  args: {
    grantId: v.id("guestAccessGrants"),
    correlationId: v.string(),
    expectedAggregateVersion: v.optional(v.number()),
  },
  returns: grantSummaryValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const correlationId = required(args.correlationId, "correlationId")
    const grant = await ctx.db.get(args.grantId)
    if (!grant || grant.organizationId !== principal.organizationId)
      throw new ConvexError({ code: "NOT_FOUND" })
    const inputFingerprint = JSON.stringify({
      operation: "revoke",
      grantId: grant._id,
    })
    const prior = await lifecycleOperationFor(ctx, principal, correlationId)
    if (prior) {
      if (prior.inputFingerprint !== inputFingerprint)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return loadGrantSummary(ctx, grant)
    }
    const request = await ctx.db.get(grant.requestId)
    if (!request || request.organizationId !== principal.organizationId)
      throw new ConvexError({ code: "NOT_FOUND" })
    if (
      args.expectedAggregateVersion !== undefined &&
      (!Number.isSafeInteger(args.expectedAggregateVersion) ||
        args.expectedAggregateVersion !== request.aggregateVersion)
    )
      throw new ConvexError({
        code: "STALE_AGGREGATE_VERSION",
        expectedAggregateVersion: args.expectedAggregateVersion,
        actualAggregateVersion: request.aggregateVersion,
      })
    const now = Date.now()
    await recordObservedExpiry(ctx, grant, correlationId, now)
    await ctx.db.patch(grant._id, {
      state: "revoked",
      revokedAt: now,
      latestActivityAt: now,
      updatedAt: now,
    })
    await suppressGuestExpiryNotifications(ctx, grant._id, now)
    await ctx.db.insert("guestAccessLifecycleOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      grantId: grant._id,
      operation: "revoke",
      correlationId,
      inputFingerprint,
      resultTokenVersion: grant.tokenVersion,
      resultExpiresAt: grant.expiresAt,
      createdAt: now,
    })
    await ctx.db.insert("guestAccessEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      grantId: grant._id,
      kind: "revoked",
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      tokenVersion: grant.tokenVersion,
      correlationId,
      occurredAt: now,
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
      operation: "guest_access.revoked",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: nextVersion,
      inputFingerprint,
    })
    const revoked = await ctx.db.get(grant._id)
    if (!revoked) throw new ConvexError({ code: "WRITE_FAILED" })
    return loadGrantSummary(ctx, revoked)
  },
})

export const renew = mutation({
  args: {
    grantId: v.id("guestAccessGrants"),
    correlationId: v.string(),
  },
  returns: v.object({
    grant: grantSummaryValidator,
    token: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const correlationId = required(args.correlationId, "correlationId")
    const inputFingerprint = JSON.stringify({
      operation: "renew",
      grantId: args.grantId,
    })
    const prior = await lifecycleOperationFor(ctx, principal, correlationId)
    if (prior) {
      if (
        prior.inputFingerprint !== inputFingerprint ||
        prior.grantId !== args.grantId
      )
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      if (prior.resultGrant)
        return {
          grant: prior.resultGrant,
          token: null,
        }
      const replayGrant = await ctx.db.get(prior.grantId)
      if (
        !replayGrant ||
        replayGrant.organizationId !== principal.organizationId
      )
        throw new ConvexError({ code: "NOT_FOUND" })
      return {
        grant: await loadGrantSummary(ctx, replayGrant),
        token: null,
      }
    }
    const grant = await ctx.db.get(args.grantId)
    if (!grant || grant.organizationId !== principal.organizationId)
      throw new ConvexError({ code: "NOT_FOUND" })
    if (grant.revokedAt || grant.state === "revoked")
      throw new ConvexError({ code: "GUEST_ACCESS_GRANT_REVOKED" })
    const request = await ctx.db.get(grant.requestId)
    if (!request || request.organizationId !== principal.organizationId)
      throw new ConvexError({ code: "NOT_FOUND" })
    requireActiveRequest(request)
    const workspace = await ctx.db
      .query("responseWorkspaces")
      .withIndex("by_grant", (index) => index.eq("grantId", grant._id))
      .unique()
    const now = Date.now()
    await recordObservedExpiry(ctx, grant, correlationId, now)
    const tokenVersion = grant.tokenVersion + 1
    const expiresAt = now + GUEST_ACCESS_DURATION_MS
    const token = await renewalToken(grant._id, tokenVersion, correlationId)
    const progress = workspace
      ? responseWorkspaceProjection(workspace, now).progress.completed
      : 0
    const state = workspace?.lockedAt
      ? ("submitted" as const)
      : progress > 0
        ? ("in_progress" as const)
        : grant.firstOpenedAt
          ? ("opened" as const)
          : ("generated" as const)
    await ctx.db.patch(grant._id, {
      currentTokenHash: await hmac(token),
      tokenVersion,
      expiresAt,
      state,
      revokedAt: undefined,
      latestActivityAt: now,
      updatedAt: now,
    })
    await suppressGuestExpiryNotifications(ctx, grant._id, now)
    await ctx.db.insert("guestAccessEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      grantId: grant._id,
      kind: "renewed",
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      tokenVersion,
      correlationId,
      occurredAt: now,
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
      operation: "guest_access.renewed",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: nextVersion,
      inputFingerprint,
    })
    const renewed = await ctx.db.get(grant._id)
    if (!renewed) throw new ConvexError({ code: "WRITE_FAILED" })
    const resultGrant = await loadGrantSummary(ctx, renewed)
    await ctx.db.insert("guestAccessLifecycleOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      grantId: grant._id,
      operation: "renew",
      correlationId,
      inputFingerprint,
      resultTokenVersion: tokenVersion,
      resultExpiresAt: expiresAt,
      resultGrant,
      createdAt: now,
    })
    return { grant: resultGrant, token }
  },
})

export const resolve = mutation({
  args: {
    token: v.string(),
    ...guestAccessBoundaryArgs,
  },
  returns: v.union(
    availableViewValidator,
    v.object({ status: v.literal("expired") }),
    v.object({ status: v.literal("rate_limited") }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const now = Date.now()
    const networkSource = await authenticatedGuestAccessNetworkSource(args, now)
    if (!networkSource) return null
    const tokenHash = await hmac(args.token)
    const grant = await ctx.db
      .query("guestAccessGrants")
      .withIndex("by_token_hash", (index) =>
        index.eq("currentTokenHash", tokenHash)
      )
      .unique()
    if (!grant) {
      const allowed = await recordFailedGuestTokenAttempt(
        ctx,
        args.token,
        networkSource,
        now
      )
      return allowed ? null : { status: "rate_limited" as const }
    }
    if (grant.revokedAt || grant.state === "revoked") return null
    if (grant.expiresAt <= now) return { status: "expired" as const }
    const [request, person, interview] = await Promise.all([
      ctx.db.get(grant.requestId),
      ctx.db.get(grant.assignedPersonId),
      ctx.db
        .query("expertInterviews")
        .withIndex("by_request", (index) =>
          index.eq("requestId", grant.requestId)
        )
        .unique(),
    ])
    if (
      !request ||
      !person ||
      request.organizationId !== grant.organizationId ||
      person.organizationId !== grant.organizationId ||
      (interview && interview.organizationId !== grant.organizationId)
    )
      return null
    const parentAccess = await guestGrantParentAccess(ctx, grant)
    if (parentAccess.status === "archived" || parentAccess.status === "invalid")
      return null
    if (parentAccess.status === "expired") return { status: "expired" as const }
    const source = request.sourceSnapshotId
      ? await ctx.db.get(request.sourceSnapshotId)
      : null
    if (
      source &&
      (source.organizationId !== grant.organizationId ||
        source.requestId !== request._id)
    )
      return null
    const standardQuestionId = standardResponseQuestionId(request._id)
    const questions = interview
      ? interview.questions.map(({ id, question, motivation }) => ({
          id,
          question,
          motivation,
        }))
      : [
          {
            id: standardQuestionId,
            question: source?.question ?? request.title,
            motivation:
              source?.body ??
              "Share the practical context FairLend needs to complete this request.",
          },
        ]
    const workspace = await loadOrCreateResponseWorkspace(
      ctx,
      grant,
      questions.map(({ id }) => id),
      now,
      interview ? {} : { [standardQuestionId]: ["request"] }
    )
    const feedback = await workspaceFeedback(ctx, workspace._id)
    if (grant.state === "generated") {
      const afterVersion = request.aggregateVersion + 1
      await ctx.db.patch(grant._id, {
        state: "opened",
        firstOpenedAt: now,
        latestActivityAt: now,
        updatedAt: now,
      })
      await ctx.db.patch(request._id, {
        aggregateVersion: afterVersion,
        updatedAt: now,
      })
      await ctx.db.insert("auditEvents", {
        organizationId: grant.organizationId,
        requestId: request._id,
        requestHumanId: request.humanId,
        actorGrantId: grant._id,
        credentialId: `guest-access-grant:${grant._id}`,
        operation: "guest_access.opened",
        correlationId: `guest-access-open:${grant._id}`,
        occurredAt: now,
        beforeVersion: request.aggregateVersion,
        afterVersion,
        inputFingerprint: JSON.stringify({ grantId: grant._id }),
      })
    }
    return {
      status: "available" as const,
      grantId: grant._id,
      expiresAt: grant.expiresAt,
      request: {
        humanId: request.humanId,
        title: request.title,
        requestType: request.requestType ?? ("standard" as const),
        brief: {
          question: source?.question ?? null,
          body: source?.body ?? null,
        },
      },
      interview: interview
        ? {
            brief: interview.brief,
            questions,
          }
        : null,
      questions,
      workspace: responseWorkspaceProjection(workspace, now, feedback),
    }
  },
})

async function loadTokenWorkspace(
  ctx: MutationCtx,
  token: string,
  now: number,
  networkSource?: string
) {
  const grant = await loadGrantByToken(ctx, token, now, networkSource)
  if (!grant) return null
  const workspace = await ctx.db
    .query("responseWorkspaces")
    .withIndex("by_grant", (index) => index.eq("grantId", grant._id))
    .unique()
  return workspace ? { grant, workspace } : null
}

async function leaseCredentialHash(leaseId: string) {
  return hmac(`editor-lease:${required(leaseId, "leaseId", 200)}`)
}

async function leaseOperationFingerprint(input: Record<string, unknown>) {
  return hmac(`editor-lease-operation:${JSON.stringify(input)}`)
}

function storedLeaseOperationResult(
  operation: Doc<"responseWorkspaceLeaseOperations">,
  now: number
) {
  const expiresAt = operation.resultExpiresAt ?? null
  const active = Boolean(expiresAt && expiresAt > now)
  return {
    status:
      operation.resultStatus === "editing" && !active
        ? ("conflict" as const)
        : operation.resultStatus,
    editorLease: {
      active,
      generation: operation.resultGeneration,
      expiresAt,
    },
  }
}

async function priorLeaseOperation(
  ctx: MutationCtx,
  workspace: Doc<"responseWorkspaces">,
  operationId: string,
  inputFingerprint: string,
  now: number
) {
  const prior = await ctx.db
    .query("responseWorkspaceLeaseOperations")
    .withIndex("by_workspace_operation", (index) =>
      index.eq("workspaceId", workspace._id).eq("operationId", operationId)
    )
    .unique()
  if (!prior) return null
  if (prior.inputFingerprint !== inputFingerprint)
    throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
  if (
    prior.resultStatus === "editing" &&
    (prior.resultGeneration !== (workspace.leaseGeneration ?? 0) ||
      !workspace.leaseHolderHash ||
      (workspace.leaseExpiresAt ?? 0) <= now)
  )
    return {
      status: "conflict" as const,
      editorLease: editorLeaseProjection(workspace, now),
    }
  return storedLeaseOperationResult(prior, now)
}

async function recordLeaseOperation(
  ctx: MutationCtx,
  input: {
    workspaceId: Doc<"responseWorkspaces">["_id"]
    operationId: string
    kind: "acquire" | "heartbeat" | "takeover"
    inputFingerprint: string
    resultStatus: "editing" | "conflict"
    resultGeneration: number
    resultExpiresAt?: number
    createdAt: number
  }
) {
  await ctx.db.insert("responseWorkspaceLeaseOperations", input)
}

async function recordLeaseEvent(
  ctx: MutationCtx,
  grant: Doc<"guestAccessGrants">,
  workspace: Doc<"responseWorkspaces">,
  input: {
    kind: "lease_acquired" | "lease_taken_over"
    leaseGeneration: number
    operationId: string
    occurredAt: number
  }
) {
  const request = await ctx.db.get(grant.requestId)
  if (!request || request.organizationId !== grant.organizationId)
    throw new ConvexError({ code: "NOT_FOUND" })
  await ctx.db.insert("responseWorkspaceEvents", {
    organizationId: grant.organizationId,
    requestId: grant.requestId,
    grantId: grant._id,
    workspaceId: workspace._id,
    ...input,
    actorGrantId: grant._id,
    credentialId: `guest-access-grant:${grant._id}`,
  })
  await ctx.db.insert("auditEvents", {
    organizationId: grant.organizationId,
    requestId: request._id,
    requestHumanId: request.humanId,
    actorGrantId: grant._id,
    credentialId: `guest-access-grant:${grant._id}`,
    operation: `guest_access.${input.kind}`,
    correlationId: input.operationId,
    occurredAt: input.occurredAt,
    afterVersion: request.aggregateVersion,
    inputFingerprint: JSON.stringify({
      grantId: grant._id,
      workspaceId: workspace._id,
      leaseGeneration: input.leaseGeneration,
    }),
  })
}

export const acquireEditorLease = mutation({
  args: {
    token: v.string(),
    ...guestAccessBoundaryArgs,
    leaseId: v.string(),
    operationId: v.string(),
  },
  returns: v.union(editorLeaseResultValidator, v.null()),
  handler: async (ctx, args) => {
    const now = Date.now()
    const networkSource = await authenticatedGuestAccessNetworkSource(args, now)
    if (!networkSource) return null
    const loaded = await loadTokenWorkspace(ctx, args.token, now, networkSource)
    if (!loaded) return null
    const operationId = required(args.operationId, "operationId")
    const holderHash = await leaseCredentialHash(args.leaseId)
    const inputFingerprint = await leaseOperationFingerprint({
      kind: "acquire",
      holderHash,
    })
    const prior = await priorLeaseOperation(
      ctx,
      loaded.workspace,
      operationId,
      inputFingerprint,
      now
    )
    if (prior) return prior

    const generation = loaded.workspace.leaseGeneration ?? 0
    const currentExpiresAt = loaded.workspace.leaseExpiresAt ?? 0
    const currentActive = Boolean(
      loaded.workspace.leaseHolderHash && currentExpiresAt > now
    )
    if (currentActive && loaded.workspace.leaseHolderHash !== holderHash) {
      await recordLeaseOperation(ctx, {
        workspaceId: loaded.workspace._id,
        operationId,
        kind: "acquire",
        inputFingerprint,
        resultStatus: "conflict",
        resultGeneration: generation,
        resultExpiresAt: currentExpiresAt,
        createdAt: now,
      })
      return {
        status: "conflict" as const,
        editorLease: editorLeaseProjection(loaded.workspace, now),
      }
    }

    const nextGeneration = currentActive ? generation : generation + 1
    const expiresAt = now + EDITOR_LEASE_DURATION_MS
    await ctx.db.patch(loaded.workspace._id, {
      leaseHolderHash: holderHash,
      leaseGeneration: nextGeneration,
      leaseExpiresAt: expiresAt,
      updatedAt: now,
    })
    await ctx.db.patch(loaded.grant._id, {
      latestActivityAt: now,
      updatedAt: now,
    })
    await recordLeaseOperation(ctx, {
      workspaceId: loaded.workspace._id,
      operationId,
      kind: "acquire",
      inputFingerprint,
      resultStatus: "editing",
      resultGeneration: nextGeneration,
      resultExpiresAt: expiresAt,
      createdAt: now,
    })
    if (!currentActive)
      await recordLeaseEvent(ctx, loaded.grant, loaded.workspace, {
        kind: "lease_acquired",
        leaseGeneration: nextGeneration,
        operationId,
        occurredAt: now,
      })
    return {
      status: "editing" as const,
      editorLease: {
        active: true,
        generation: nextGeneration,
        expiresAt,
      },
    }
  },
})

export const heartbeatEditorLease = mutation({
  args: {
    token: v.string(),
    ...guestAccessBoundaryArgs,
    leaseId: v.string(),
    leaseGeneration: v.number(),
    operationId: v.string(),
  },
  returns: v.union(editorLeaseResultValidator, v.null()),
  handler: async (ctx, args) => {
    const now = Date.now()
    const networkSource = await authenticatedGuestAccessNetworkSource(args, now)
    if (!networkSource) return null
    const loaded = await loadTokenWorkspace(ctx, args.token, now, networkSource)
    if (!loaded) return null
    const operationId = required(args.operationId, "operationId")
    const holderHash = await leaseCredentialHash(args.leaseId)
    const inputFingerprint = await leaseOperationFingerprint({
      kind: "heartbeat",
      holderHash,
      leaseGeneration: args.leaseGeneration,
    })
    const prior = await priorLeaseOperation(
      ctx,
      loaded.workspace,
      operationId,
      inputFingerprint,
      now
    )
    if (prior) return prior

    const generation = loaded.workspace.leaseGeneration ?? 0
    const isCurrent =
      Number.isSafeInteger(args.leaseGeneration) &&
      args.leaseGeneration === generation &&
      loaded.workspace.leaseHolderHash === holderHash &&
      (loaded.workspace.leaseExpiresAt ?? 0) > now
    if (!isCurrent) {
      const current = editorLeaseProjection(loaded.workspace, now)
      await recordLeaseOperation(ctx, {
        workspaceId: loaded.workspace._id,
        operationId,
        kind: "heartbeat",
        inputFingerprint,
        resultStatus: "conflict",
        resultGeneration: current.generation,
        resultExpiresAt: current.expiresAt ?? undefined,
        createdAt: now,
      })
      return { status: "conflict" as const, editorLease: current }
    }

    const expiresAt = now + EDITOR_LEASE_DURATION_MS
    await ctx.db.patch(loaded.workspace._id, {
      leaseExpiresAt: expiresAt,
      updatedAt: now,
    })
    await recordLeaseOperation(ctx, {
      workspaceId: loaded.workspace._id,
      operationId,
      kind: "heartbeat",
      inputFingerprint,
      resultStatus: "editing",
      resultGeneration: generation,
      resultExpiresAt: expiresAt,
      createdAt: now,
    })
    return {
      status: "editing" as const,
      editorLease: { active: true, generation, expiresAt },
    }
  },
})

export const takeoverEditorLease = mutation({
  args: {
    token: v.string(),
    ...guestAccessBoundaryArgs,
    leaseId: v.string(),
    expectedGeneration: v.number(),
    operationId: v.string(),
  },
  returns: v.union(editorLeaseResultValidator, v.null()),
  handler: async (ctx, args) => {
    const now = Date.now()
    const networkSource = await authenticatedGuestAccessNetworkSource(args, now)
    if (!networkSource) return null
    const loaded = await loadTokenWorkspace(ctx, args.token, now, networkSource)
    if (!loaded) return null
    const operationId = required(args.operationId, "operationId")
    const holderHash = await leaseCredentialHash(args.leaseId)
    const inputFingerprint = await leaseOperationFingerprint({
      kind: "takeover",
      holderHash,
      expectedGeneration: args.expectedGeneration,
    })
    const prior = await priorLeaseOperation(
      ctx,
      loaded.workspace,
      operationId,
      inputFingerprint,
      now
    )
    if (prior) return prior

    const generation = loaded.workspace.leaseGeneration ?? 0
    if (
      !Number.isSafeInteger(args.expectedGeneration) ||
      args.expectedGeneration !== generation
    ) {
      const current = editorLeaseProjection(loaded.workspace, now)
      await recordLeaseOperation(ctx, {
        workspaceId: loaded.workspace._id,
        operationId,
        kind: "takeover",
        inputFingerprint,
        resultStatus: "conflict",
        resultGeneration: current.generation,
        resultExpiresAt: current.expiresAt ?? undefined,
        createdAt: now,
      })
      return { status: "conflict" as const, editorLease: current }
    }

    const wasActive = Boolean(
      loaded.workspace.leaseHolderHash &&
      (loaded.workspace.leaseExpiresAt ?? 0) > now
    )
    const nextGeneration = generation + 1
    const expiresAt = now + EDITOR_LEASE_DURATION_MS
    await ctx.db.patch(loaded.workspace._id, {
      leaseHolderHash: holderHash,
      leaseGeneration: nextGeneration,
      leaseExpiresAt: expiresAt,
      updatedAt: now,
    })
    await ctx.db.patch(loaded.grant._id, {
      latestActivityAt: now,
      updatedAt: now,
    })
    await recordLeaseOperation(ctx, {
      workspaceId: loaded.workspace._id,
      operationId,
      kind: "takeover",
      inputFingerprint,
      resultStatus: "editing",
      resultGeneration: nextGeneration,
      resultExpiresAt: expiresAt,
      createdAt: now,
    })
    await recordLeaseEvent(ctx, loaded.grant, loaded.workspace, {
      kind: wasActive ? "lease_taken_over" : "lease_acquired",
      leaseGeneration: nextGeneration,
      operationId,
      occurredAt: now,
    })
    return {
      status: "editing" as const,
      editorLease: {
        active: true,
        generation: nextGeneration,
        expiresAt,
      },
    }
  },
})

export const saveResponseWorkspace = mutation({
  args: {
    token: v.string(),
    ...guestAccessBoundaryArgs,
    leaseId: v.string(),
    leaseGeneration: v.number(),
    operationId: v.string(),
    expectedRevision: v.number(),
    answerMode: answerModeValidator,
    batchText: v.string(),
    questionAnswers: v.array(
      v.object({ questionId: v.string(), text: v.string() })
    ),
  },
  returns: v.union(
    v.object({
      status: v.literal("saved"),
      workspace: responseWorkspaceValidator,
    }),
    v.object({
      status: v.literal("conflict"),
      workspace: responseWorkspaceValidator,
    }),
    v.object({
      status: v.literal("lease_conflict"),
      workspace: responseWorkspaceValidator,
      editorLease: v.object({
        active: v.boolean(),
        generation: v.number(),
        expiresAt: v.union(v.number(), v.null()),
      }),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const now = Date.now()
    const networkSource = await authenticatedGuestAccessNetworkSource(args, now)
    if (!networkSource) return null
    const grant = await loadGrantByToken(ctx, args.token, now, networkSource)
    if (!grant) return null
    const workspace = await ctx.db
      .query("responseWorkspaces")
      .withIndex("by_grant", (index) => index.eq("grantId", grant._id))
      .unique()
    if (!workspace) return null
    const feedback = await workspaceFeedback(ctx, workspace._id)

    const operationId = required(args.operationId, "operationId")
    const submittedAnswers = args.questionAnswers
      .map(({ questionId, text }) => ({
        questionId: required(questionId, "questionId"),
        text: text.slice(0, 100_000),
      }))
      .sort((left, right) => left.questionId.localeCompare(right.questionId))
    const holderHash = await leaseCredentialHash(args.leaseId)
    const inputFingerprint = JSON.stringify({
      holderHash,
      leaseGeneration: args.leaseGeneration,
      expectedRevision: args.expectedRevision,
      answerMode: args.answerMode,
      batchText: args.batchText,
      questionAnswers: submittedAnswers,
    })
    const prior = await ctx.db
      .query("responseWorkspaceOperations")
      .withIndex("by_workspace_operation", (index) =>
        index.eq("workspaceId", workspace._id).eq("operationId", operationId)
      )
      .unique()
    if (prior) {
      if (prior.inputFingerprint !== inputFingerprint)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      if (
        !Number.isSafeInteger(args.leaseGeneration) ||
        args.leaseGeneration !== (workspace.leaseGeneration ?? 0) ||
        workspace.leaseHolderHash !== holderHash ||
        (workspace.leaseExpiresAt ?? 0) <= now
      )
        return {
          status: "lease_conflict" as const,
          workspace: responseWorkspaceProjection(workspace, now, feedback),
          editorLease: editorLeaseProjection(workspace, now),
        }
      return prior.resultJson
        ? (JSON.parse(prior.resultJson) as {
            status: "saved"
            workspace: ReturnType<typeof responseWorkspaceProjection>
          })
        : {
            status: "saved" as const,
            workspace: responseWorkspaceProjection(workspace, now, feedback),
          }
    }

    const questionIds = workspace.questionAnswers.map(
      ({ questionId }) => questionId
    )
    const answerByQuestionId = new Map(
      submittedAnswers.map(({ questionId, text }) => [questionId, text])
    )
    if (
      answerByQuestionId.size !== questionIds.length ||
      questionIds.some((questionId) => !answerByQuestionId.has(questionId))
    )
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "questionAnswers",
      })
    const normalizedAnswers = questionIds.map((questionId) => ({
      questionId,
      text: answerByQuestionId.get(questionId) ?? "",
    }))
    if (workspace.lockedAt) throw new ConvexError({ code: "WORKSPACE_LOCKED" })
    if (
      !Number.isSafeInteger(args.leaseGeneration) ||
      args.leaseGeneration !== (workspace.leaseGeneration ?? 0) ||
      workspace.leaseHolderHash !== holderHash ||
      (workspace.leaseExpiresAt ?? 0) <= now
    )
      return {
        status: "lease_conflict" as const,
        workspace: responseWorkspaceProjection(workspace, now, feedback),
        editorLease: editorLeaseProjection(workspace, now),
      }
    if (
      !Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < 0 ||
      args.expectedRevision !== workspace.revision
    )
      return {
        status: "conflict" as const,
        workspace: responseWorkspaceProjection(workspace, now, feedback),
      }

    const nextRevision = workspace.revision + 1
    await ctx.db.patch(workspace._id, {
      answerMode: args.answerMode,
      batchText: args.batchText.slice(0, 100_000),
      questionAnswers: normalizedAnswers,
      revision: nextRevision,
      updatedAt: now,
    })
    const firstMeaningfulProgress =
      !grant.firstProgressAt &&
      (args.batchText.trim().length > 0 ||
        normalizedAnswers.some(({ text }) => text.trim().length > 0))
    if (firstMeaningfulProgress) {
      await ctx.db.insert("responseWorkspaceEvents", {
        organizationId: grant.organizationId,
        requestId: grant.requestId,
        grantId: grant._id,
        workspaceId: workspace._id,
        kind: "first_progress",
        leaseGeneration: workspace.leaseGeneration ?? 0,
        operationId,
        actorGrantId: grant._id,
        occurredAt: now,
      })
      const request = await ctx.db.get(grant.requestId)
      if (!request || request.organizationId !== grant.organizationId)
        throw new ConvexError({ code: "NOT_FOUND" })
      await ctx.db.insert("auditEvents", {
        organizationId: grant.organizationId,
        requestId: request._id,
        requestHumanId: request.humanId,
        actorGrantId: grant._id,
        credentialId: `guest-access-grant:${grant._id}`,
        operation: "guest_access.first_progress",
        correlationId: operationId,
        occurredAt: now,
        afterVersion: request.aggregateVersion,
      })
    }
    await ctx.db.patch(grant._id, {
      state: "in_progress",
      firstProgressAt: firstMeaningfulProgress ? now : grant.firstProgressAt,
      latestActivityAt: now,
      updatedAt: now,
    })
    const saved = await ctx.db.get(workspace._id)
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    const result = {
      status: "saved" as const,
      workspace: responseWorkspaceProjection(saved, now, feedback),
    }
    await ctx.db.insert("responseWorkspaceOperations", {
      workspaceId: workspace._id,
      operationId,
      inputFingerprint,
      resultRevision: nextRevision,
      resultJson: JSON.stringify(result),
      createdAt: now,
    })
    return result
  },
})

async function lifecycleFingerprint(input: Record<string, unknown>) {
  return hmac(`response-lifecycle:${JSON.stringify(input)}`)
}

async function lifecycleOperation(
  ctx: MutationCtx,
  workspaceId: Doc<"responseWorkspaces">["_id"],
  operationId: string,
  inputFingerprint: string
) {
  const prior = await ctx.db
    .query("responseLifecycleOperations")
    .withIndex("by_workspace_operation", (index) =>
      index.eq("workspaceId", workspaceId).eq("operationId", operationId)
    )
    .unique()
  if (prior && prior.inputFingerprint !== inputFingerprint)
    throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
  return prior
}

export const submitResponseWorkspace = mutation({
  args: {
    token: v.string(),
    ...guestAccessBoundaryArgs,
    leaseId: v.string(),
    leaseGeneration: v.number(),
    operationId: v.string(),
    expectedRevision: v.number(),
    confirmed: v.boolean(),
    selectedAnswerMode: v.optional(answerModeValidator),
  },
  returns: v.union(
    v.object({
      status: v.literal("submitted"),
      workspace: v.object({
        locked: v.literal(true),
        revision: v.number(),
      }),
      submission: responseSubmissionValidator,
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const now = Date.now()
    const networkSource = await authenticatedGuestAccessNetworkSource(args, now)
    if (!networkSource) return null
    const loaded = await loadTokenWorkspace(ctx, args.token, now, networkSource)
    if (!loaded) return null
    const operationId = required(args.operationId, "operationId")
    const holderHash = await leaseCredentialHash(args.leaseId)
    const inputFingerprint = await lifecycleFingerprint({
      kind: "submit",
      holderHash,
      leaseGeneration: args.leaseGeneration,
      expectedRevision: args.expectedRevision,
      confirmed: args.confirmed,
      selectedAnswerMode: args.selectedAnswerMode,
    })
    const prior = await lifecycleOperation(
      ctx,
      loaded.workspace._id,
      operationId,
      inputFingerprint
    )
    if (prior?.submissionId) {
      const submission = await ctx.db.get(prior.submissionId)
      if (!submission) throw new ConvexError({ code: "WRITE_FAILED" })
      return {
        status: "submitted" as const,
        workspace: {
          locked: true as const,
          revision: prior.resultRevision,
        },
        submission: responseSubmissionProjection(submission),
      }
    }
    if (!args.confirmed)
      throw new ConvexError({ code: "SUBMISSION_CONFIRMATION_REQUIRED" })
    if (loaded.workspace.lockedAt)
      throw new ConvexError({ code: "WORKSPACE_LOCKED" })
    if (
      !Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < 0 ||
      args.expectedRevision !== loaded.workspace.revision
    )
      throw new ConvexError({
        code: "REVISION_CONFLICT",
        currentRevision: loaded.workspace.revision,
      })
    if (
      !Number.isSafeInteger(args.leaseGeneration) ||
      args.leaseGeneration !== (loaded.workspace.leaseGeneration ?? 0) ||
      loaded.workspace.leaseHolderHash !== holderHash ||
      (loaded.workspace.leaseExpiresAt ?? 0) <= now
    )
      throw new ConvexError({ code: "EDITOR_LEASE_REQUIRED" })

    const [request, person, interview, assets] = await Promise.all([
      ctx.db.get(loaded.grant.requestId),
      ctx.db.get(loaded.grant.assignedPersonId),
      ctx.db
        .query("expertInterviews")
        .withIndex("by_request", (index) =>
          index.eq("requestId", loaded.grant.requestId)
        )
        .unique(),
      ctx.db
        .query("responseAssets")
        .withIndex("by_workspace_created_at", (index) =>
          index.eq("workspaceId", loaded.workspace._id)
        )
        .collect(),
    ])
    if (
      !request ||
      !person ||
      request.organizationId !== loaded.grant.organizationId ||
      person.organizationId !== loaded.grant.organizationId ||
      (interview && interview.organizationId !== loaded.grant.organizationId)
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    const source = request.sourceSnapshotId
      ? await ctx.db.get(request.sourceSnapshotId)
      : null
    if (
      source &&
      (source.organizationId !== loaded.grant.organizationId ||
        source.requestId !== request._id)
    )
      throw new ConvexError({ code: "NOT_FOUND" })

    const questions = interview
      ? interview.questions.map((question, position) => ({
          questionId: question.id,
          question: question.question,
          motivation: question.motivation,
          position,
          version: interview.updatedAt,
        }))
      : loaded.workspace.questionAnswers.map(({ questionId }, position) => ({
          questionId,
          question: source?.question ?? request.title,
          motivation: source?.body ?? "",
          position,
          version: request.updatedAt,
        }))
    const activeAssets = assets.filter((asset) => !asset.discardedAt)
    const batchHasMaterial =
      Boolean(loaded.workspace.batchText.trim()) ||
      activeAssets.some((asset) => asset.scope.kind === "batch")
    const oneByOneHasMaterial =
      loaded.workspace.questionAnswers.some(({ text }) =>
        Boolean(text.trim())
      ) || activeAssets.some((asset) => asset.scope.kind === "question")
    if (batchHasMaterial && oneByOneHasMaterial && !args.selectedAnswerMode)
      throw new ConvexError({ code: "SUBMISSION_MODE_SELECTION_REQUIRED" })
    if (!batchHasMaterial && !oneByOneHasMaterial)
      throw new ConvexError({ code: "SUBMISSION_CONTENT_REQUIRED" })
    const selectedAnswerMode =
      batchHasMaterial && oneByOneHasMaterial
        ? args.selectedAnswerMode!
        : batchHasMaterial
          ? ("batch" as const)
          : ("one_by_one" as const)
    const selectionMethod =
      batchHasMaterial && oneByOneHasMaterial
        ? ("respondent_choice" as const)
        : ("single_mode" as const)
    const selectedAssets = activeAssets.filter((asset) =>
      selectedAnswerMode === "batch"
        ? asset.scope.kind === "batch"
        : asset.scope.kind === "question"
    )
    const selectedAssetOperationKeys = new Set(
      selectedAssets.map((asset) => `asset:${asset._id}`)
    )
    const activeAssetOperationKeys = new Set(
      activeAssets.map((asset) => `asset:${asset._id}`)
    )
    const blockingOperationIds = (
      loaded.workspace.pendingRequiredOperationIds ?? []
    ).filter(
      (operationId) =>
        !activeAssetOperationKeys.has(operationId) ||
        selectedAssetOperationKeys.has(operationId)
    )
    if (blockingOperationIds.length)
      throw new ConvexError({
        code: "REQUIRED_OPERATIONS_PENDING",
        count: blockingOperationIds.length,
      })
    const settledAssets = selectedAssets.filter(
      (asset) =>
        asset.uploadState === "uploaded" &&
        (asset.kind === "attachment" ||
          asset.transcriptionState === "transcribed")
    )
    if (settledAssets.length !== selectedAssets.length)
      throw new ConvexError({
        code: "REQUIRED_OPERATIONS_PENDING",
        count: selectedAssets.length - settledAssets.length,
      })
    const assetSnapshots = settledAssets.map((asset) => ({
      assetId: asset._id,
      version: asset.version,
      transcriptVersion: asset.transcriptVersion,
      kind: asset.kind,
      scope: asset.scope,
    }))
    const submissionId = await ctx.db.insert("responseSubmissions", {
      organizationId: loaded.grant.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      grantId: loaded.grant._id,
      workspaceId: loaded.workspace._id,
      assignedPersonId: person._id,
      respondentDisplayName: person.displayName,
      respondentEmail: person.email,
      workspaceRevision: loaded.workspace.revision,
      answerMode: selectedAnswerMode,
      selectedAnswerMode,
      selectionMethod,
      batchText:
        selectedAnswerMode === "batch" ? loaded.workspace.batchText : "",
      questionAnswers:
        selectedAnswerMode === "one_by_one"
          ? loaded.workspace.questionAnswers
          : [],
      questions,
      assetSnapshots,
      submittedAt: now,
    })
    await Promise.all(
      settledAssets
        .filter((asset) => !asset.submittedAt)
        .map((asset) =>
          ctx.db.patch(asset._id, { submittedAt: now, updatedAt: now })
        )
    )
    await ctx.db.patch(loaded.workspace._id, {
      lockedAt: now,
      latestSubmissionId: submissionId,
      updatedAt: now,
    })
    await ctx.db.patch(loaded.grant._id, {
      state: "submitted",
      latestActivityAt: now,
      updatedAt: now,
    })
    await suppressGuestExpiryNotifications(ctx, loaded.grant._id, now)
    const nextVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      aggregateVersion: nextVersion,
      updatedAt: now,
    })
    await ctx.db.insert("responseLifecycleOperations", {
      workspaceId: loaded.workspace._id,
      operationId,
      kind: "submit",
      inputFingerprint,
      resultRevision: loaded.workspace.revision,
      submissionId,
      createdAt: now,
    })
    await ctx.db.insert("responseWorkspaceEvents", {
      organizationId: loaded.grant.organizationId,
      requestId: request._id,
      grantId: loaded.grant._id,
      workspaceId: loaded.workspace._id,
      kind: "submitted",
      leaseGeneration: loaded.workspace.leaseGeneration ?? 0,
      operationId,
      actorGrantId: loaded.grant._id,
      submissionId,
      occurredAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: loaded.grant.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorGrantId: loaded.grant._id,
      credentialId: `guest-access-grant:${loaded.grant._id}`,
      operation: "guest_response.submitted",
      correlationId: operationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: nextVersion,
      inputFingerprint,
    })
    await enqueueAdministratorNotifications(
      ctx,
      request,
      "guest_submission",
      now,
      {
        dedupeKey: `guest-submission:${submissionId}`,
        grantId: loaded.grant._id,
        submissionId,
      }
    )
    const submission = await ctx.db.get(submissionId)
    if (!submission) throw new ConvexError({ code: "WRITE_FAILED" })
    return {
      status: "submitted" as const,
      workspace: {
        locked: true as const,
        revision: loaded.workspace.revision,
      },
      submission: responseSubmissionProjection(submission),
    }
  },
})

export const addResponseFeedback = mutation({
  args: {
    grantId: v.id("guestAccessGrants"),
    scope: responseCommentScopeValidator,
    body: v.string(),
    correlationId: v.string(),
  },
  returns: responseFeedbackValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const correlationId = required(args.correlationId, "correlationId")
    const body = required(args.body, "body", 10_000)
    const grant = await ctx.db.get(args.grantId)
    if (!grant || grant.organizationId !== principal.organizationId)
      throw new ConvexError({ code: "NOT_FOUND" })
    const [request, workspace] = await Promise.all([
      ctx.db.get(grant.requestId),
      ctx.db
        .query("responseWorkspaces")
        .withIndex("by_grant", (index) => index.eq("grantId", grant._id))
        .unique(),
    ])
    if (
      !request ||
      !workspace ||
      request.organizationId !== principal.organizationId
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    const scope =
      args.scope.kind === "workspace"
        ? ({ kind: "workspace" } as const)
        : ({
            kind: "question",
            questionId: required(args.scope.questionId, "questionId"),
          } as const)
    if (
      scope.kind === "question" &&
      !workspace.questionAnswers.some(
        ({ questionId }) => questionId === scope.questionId
      )
    )
      throw new ConvexError({ code: "QUESTION_NOT_FOUND" })
    const inputFingerprint = await lifecycleFingerprint({
      kind: "feedback",
      scope,
      body,
      actorPrincipalId: principal._id,
    })
    const prior = await lifecycleOperation(
      ctx,
      workspace._id,
      correlationId,
      inputFingerprint
    )
    if (prior?.feedbackId) {
      const feedback = await ctx.db.get(prior.feedbackId)
      if (!feedback) throw new ConvexError({ code: "WRITE_FAILED" })
      return responseFeedbackProjection(feedback)
    }
    const now = Date.now()
    const authorDisplayName =
      principal.displayName?.trim() ||
      principal.email?.trim() ||
      "FairLend administrator"
    const feedbackId = await ctx.db.insert("responseFeedback", {
      organizationId: principal.organizationId,
      requestId: request._id,
      grantId: grant._id,
      workspaceId: workspace._id,
      scope,
      body,
      authorPrincipalId: principal._id,
      authorDisplayName,
      credentialId: principal.credentialId,
      createdAt: now,
    })
    await ctx.db.insert("responseLifecycleOperations", {
      workspaceId: workspace._id,
      operationId: correlationId,
      kind: "feedback",
      inputFingerprint,
      resultRevision: workspace.revision,
      feedbackId,
      createdAt: now,
    })
    await ctx.db.insert("responseWorkspaceEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      grantId: grant._id,
      workspaceId: workspace._id,
      kind: "feedback_added",
      leaseGeneration: workspace.leaseGeneration ?? 0,
      operationId: correlationId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      feedbackId,
      occurredAt: now,
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
      operation: "guest_response.feedback_added",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: nextVersion,
      inputFingerprint,
    })
    const feedback = await ctx.db.get(feedbackId)
    if (!feedback) throw new ConvexError({ code: "WRITE_FAILED" })
    return responseFeedbackProjection(feedback)
  },
})

export const reopenResponseWorkspace = mutation({
  args: {
    grantId: v.id("guestAccessGrants"),
    correlationId: v.string(),
  },
  returns: v.object({
    locked: v.literal(false),
    lockedAt: v.null(),
    revision: v.number(),
  }),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const correlationId = required(args.correlationId, "correlationId")
    const grant = await ctx.db.get(args.grantId)
    if (!grant || grant.organizationId !== principal.organizationId)
      throw new ConvexError({ code: "NOT_FOUND" })
    const [request, workspace] = await Promise.all([
      ctx.db.get(grant.requestId),
      ctx.db
        .query("responseWorkspaces")
        .withIndex("by_grant", (index) => index.eq("grantId", grant._id))
        .unique(),
    ])
    if (
      !request ||
      !workspace ||
      request.organizationId !== principal.organizationId
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    const inputFingerprint = await lifecycleFingerprint({
      kind: "reopen",
      actorPrincipalId: principal._id,
    })
    const prior = await lifecycleOperation(
      ctx,
      workspace._id,
      correlationId,
      inputFingerprint
    )
    if (prior)
      return {
        locked: false as const,
        lockedAt: null,
        revision: prior.resultRevision,
      }
    if (
      derivedState(grant, Date.now()) === "expired" ||
      grant.state === "revoked"
    )
      throw new ConvexError({ code: "GUEST_ACCESS_UNAVAILABLE" })
    if (!workspace.lockedAt)
      throw new ConvexError({ code: "WORKSPACE_NOT_LOCKED" })
    requireActiveRequest(request)
    const now = Date.now()
    const nextRevision = workspace.revision + 1
    await ctx.db.patch(workspace._id, {
      lockedAt: undefined,
      revision: nextRevision,
      updatedAt: now,
    })
    await ctx.db.patch(grant._id, {
      state: "in_progress",
      latestActivityAt: now,
      updatedAt: now,
    })
    await reactivateGuestExpiryNotifications(ctx, grant, now)
    await ctx.db.insert("responseLifecycleOperations", {
      workspaceId: workspace._id,
      operationId: correlationId,
      kind: "reopen",
      inputFingerprint,
      resultRevision: nextRevision,
      createdAt: now,
    })
    await ctx.db.insert("responseWorkspaceEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      grantId: grant._id,
      workspaceId: workspace._id,
      kind: "reopened",
      leaseGeneration: workspace.leaseGeneration ?? 0,
      operationId: correlationId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      occurredAt: now,
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
      operation: "guest_response.reopened",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: nextVersion,
      inputFingerprint,
    })
    return { locked: false as const, lockedAt: null, revision: nextRevision }
  },
})

export const inspectResponseWorkspace = query({
  args: { grantId: v.id("guestAccessGrants") },
  returns: v.union(
    v.object({
      grantId: v.id("guestAccessGrants"),
      requestHumanId: v.string(),
      assignedPerson: v.object({ displayName: v.string() }),
      readOnly: v.literal(true),
      questions: v.array(responseQuestionValidator),
      workspace: adminResponseWorkspaceValidator,
      submissions: v.array(responseSubmissionValidator),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const grant = await ctx.db.get(args.grantId)
    if (!grant || grant.organizationId !== principal.organizationId)
      throw new ConvexError({ code: "NOT_FOUND" })
    const [request, person, workspace] = await Promise.all([
      ctx.db.get(grant.requestId),
      ctx.db.get(grant.assignedPersonId),
      ctx.db
        .query("responseWorkspaces")
        .withIndex("by_grant", (index) => index.eq("grantId", grant._id))
        .unique(),
    ])
    if (
      !request ||
      !person ||
      request.organizationId !== principal.organizationId ||
      person.organizationId !== principal.organizationId
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    if (!workspace) return null
    const [feedback, submissions, interview, source] = await Promise.all([
      workspaceFeedback(ctx, workspace._id),
      ctx.db
        .query("responseSubmissions")
        .withIndex("by_workspace_submitted_at", (index) =>
          index.eq("workspaceId", workspace._id)
        )
        .order("asc")
        .collect(),
      ctx.db
        .query("expertInterviews")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .unique(),
      request.sourceSnapshotId
        ? ctx.db.get(request.sourceSnapshotId)
        : Promise.resolve(null),
    ])
    if (
      (interview && interview.organizationId !== principal.organizationId) ||
      (source &&
        (source.organizationId !== principal.organizationId ||
          source.requestId !== request._id))
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    return {
      grantId: grant._id,
      requestHumanId: request.humanId,
      assignedPerson: { displayName: person.displayName },
      readOnly: true as const,
      questions: interview
        ? interview.questions.map((question) => ({
            questionId: question.id,
            question: question.question,
            motivation: question.motivation,
          }))
        : workspace.questionAnswers.map(({ questionId }) => ({
            questionId,
            question: source?.question ?? request.title,
            motivation: source?.body ?? "",
          })),
      workspace: adminResponseWorkspaceProjection(
        workspace,
        Date.now(),
        feedback
      ),
      submissions: submissions.map(responseSubmissionProjection),
    }
  },
})
