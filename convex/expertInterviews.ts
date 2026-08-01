import { ConvexError, v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { contentRequestValidator, toPublicRequest } from "./contentRequests"
import {
  expertInterviewBriefValidator,
  expertInterviewGapValidator,
  expertInterviewQuestionValidator,
} from "./schema"
import {
  requireActiveRequest,
  requireEditor,
  requirePrincipal,
} from "./lib/authorization"
import { contentRequestCreationDefaults } from "./lib/contentRequestDefaults"
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"
import { requestQueueSortKey } from "./lib/requestOrdering"
import { canonicalJson } from "../shared/canonical-json"

export const expertInterviewPackageValidator = v.object({
  expertInterviewId: v.id("expertInterviews"),
  requestHumanId: v.string(),
  brief: expertInterviewBriefValidator,
  gaps: v.array(expertInterviewGapValidator),
  questions: v.array(expertInterviewQuestionValidator),
  operatorInstructions: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

const MAX_EXPERT_INTERVIEW_GAPS = 50
const MAX_EXPERT_INTERVIEW_QUESTIONS = 100
const MAX_EXPERT_INTERVIEW_CITATIONS_PER_GAP = 20
const MAX_EXPERT_INTERVIEW_TEXT_LENGTH = 10_000
const MAX_EXPERT_INTERVIEW_PACKAGE_BYTES = 512 * 1024

const sourceInputValidator = v.object({
  question: v.optional(v.string()),
  body: v.optional(v.string()),
  url: v.optional(v.string()),
  name: v.optional(v.string()),
  channel: v.optional(v.string()),
})

const explicitRequestOriginValidator = v.union(
  v.literal("manual"),
  v.literal("chatgpt_app"),
  v.literal("cli"),
  v.literal("http_api")
)

const contextItemValidator = v.object({
  contextId: v.string(),
  kind: v.union(
    v.literal("source_summary"),
    v.literal("missing_research"),
    v.literal("talking_points"),
    v.literal("research_requirements")
  ),
  title: v.string(),
  bulletPoints: v.array(v.string()),
  citations: v.array(
    v.object({
      label: v.string(),
      url: v.string(),
      supports: v.string(),
    })
  ),
})

const createResultValidator = v.object({
  request: contentRequestValidator,
  humanId: v.string(),
  package: expertInterviewPackageValidator,
  brief: contextItemValidator,
  gaps: v.array(contextItemValidator),
  questions: v.array(contextItemValidator),
  instructions: contextItemValidator,
})

function required(value: string, field: string) {
  const cleaned = value.trim()
  if (!cleaned) throw new ConvexError({ code: "VALIDATION_FAILED", field })
  if (cleaned.length > MAX_EXPERT_INTERVIEW_TEXT_LENGTH)
    throw new ConvexError({ code: "VALIDATION_FAILED", field })
  return cleaned
}

function httpUrl(value: string, field: string) {
  const cleaned = required(value, field)
  try {
    const url = new URL(cleaned)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error()
  } catch {
    throw new ConvexError({ code: "VALIDATION_FAILED", field })
  }
  return cleaned
}

function cleanOptional(value: string | undefined, field: string) {
  if (value === undefined) return undefined
  const cleaned = value.trim()
  if (!cleaned) return undefined
  if (cleaned.length > MAX_EXPERT_INTERVIEW_TEXT_LENGTH)
    throw new ConvexError({ code: "VALIDATION_FAILED", field })
  return cleaned
}

function cleanSource(source: typeof sourceInputValidator.type | undefined) {
  if (!source) return undefined
  const cleaned = {
    question: cleanOptional(source.question, "source.question"),
    body: cleanOptional(source.body, "source.body"),
    url: source.url?.trim() ? httpUrl(source.url, "source.url") : undefined,
    name: cleanOptional(source.name, "source.name"),
    channel: cleanOptional(source.channel, "source.channel"),
  }
  return Object.values(cleaned).some(Boolean) ? cleaned : undefined
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

function matchesLegacyJsonFingerprint(
  fingerprint: string | undefined,
  cleaned: ReturnType<typeof cleanPackage>
) {
  if (!fingerprint?.startsWith("{")) return false
  try {
    return canonicalJson(JSON.parse(fingerprint)) === canonicalJson(cleaned)
  } catch {
    return false
  }
}

function cleanPackage(
  args: {
    brief: typeof expertInterviewBriefValidator.type
    gaps: Array<typeof expertInterviewGapValidator.type>
    questions: Array<typeof expertInterviewQuestionValidator.type>
    operatorInstructions?: string
  },
  options: { allowEmptyCitations?: boolean } = {}
) {
  if (!args.gaps.length)
    throw new ConvexError({
      code: "VALIDATION_FAILED",
      field: "gaps",
    })
  if (args.gaps.length > MAX_EXPERT_INTERVIEW_GAPS)
    throw new ConvexError({
      code: "VALIDATION_FAILED",
      field: "gaps",
    })
  if (!args.questions.length)
    throw new ConvexError({
      code: "VALIDATION_FAILED",
      field: "questions",
    })
  if (args.questions.length > MAX_EXPERT_INTERVIEW_QUESTIONS)
    throw new ConvexError({
      code: "VALIDATION_FAILED",
      field: "questions",
    })
  const gaps = args.gaps.map((gap) => ({
    ...gap,
    id: required(gap.id, "gaps.id"),
    title: required(gap.title, "gaps.title"),
    existingCoverage: required(gap.existingCoverage, "gaps.existingCoverage"),
    whyItFallsShort: required(gap.whyItFallsShort, "gaps.whyItFallsShort"),
    expertOpportunity: required(
      gap.expertOpportunity,
      "gaps.expertOpportunity"
    ),
    citations: (() => {
      if (!options.allowEmptyCitations && gap.citations.length === 0)
        throw new ConvexError({
          code: "VALIDATION_FAILED",
          field: "gaps.citations",
        })
      if (gap.citations.length > MAX_EXPERT_INTERVIEW_CITATIONS_PER_GAP)
        throw new ConvexError({
          code: "VALIDATION_FAILED",
          field: "gaps.citations",
        })
      return gap.citations.map((citation) => ({
        label: required(citation.label, "gaps.citations.label"),
        url: httpUrl(citation.url, "gaps.citations.url"),
        supports: required(citation.supports, "gaps.citations.supports"),
      }))
    })(),
  }))
  const gapIds = new Set(gaps.map(({ id }) => id))
  if (gapIds.size !== gaps.length)
    throw new ConvexError({
      code: "VALIDATION_FAILED",
      field: "gaps.id",
    })
  const questions = args.questions.map((question) => ({
    ...question,
    id: required(question.id, "questions.id"),
    question: required(question.question, "questions.question"),
    motivation: required(question.motivation, "questions.motivation"),
    gapIds: question.gapIds.map((gapId) => required(gapId, "questions.gapIds")),
  }))
  if (new Set(questions.map(({ id }) => id)).size !== questions.length)
    throw new ConvexError({
      code: "VALIDATION_FAILED",
      field: "questions.id",
    })
  if (
    questions.some(
      ({ gapIds: questionGapIds }) =>
        !questionGapIds.length ||
        questionGapIds.some((gapId) => !gapIds.has(gapId))
    )
  )
    throw new ConvexError({
      code: "VALIDATION_FAILED",
      field: "questions.gapIds",
    })
  const cleaned = {
    brief: {
      ...args.brief,
      topic: required(args.brief.topic, "brief.topic"),
      summary: required(args.brief.summary, "brief.summary"),
      audience: required(args.brief.audience, "brief.audience"),
      fairlendPosture: required(
        args.brief.fairlendPosture,
        "brief.fairlendPosture"
      ),
      founderContribution: required(
        args.brief.founderContribution,
        "brief.founderContribution"
      ),
    },
    gaps,
    questions,
    operatorInstructions: args.operatorInstructions?.trim()
      ? required(args.operatorInstructions, "operatorInstructions")
      : undefined,
  }
  if (
    new TextEncoder().encode(JSON.stringify(cleaned)).byteLength >
    MAX_EXPERT_INTERVIEW_PACKAGE_BYTES
  )
    throw new ConvexError({
      code: "VALIDATION_FAILED",
      field: "package",
    })
  return cleaned
}

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase("en-CA").replace(/\s+/g, " ")
}

function humanIdFor(requestId: Id<"contentRequests">) {
  return `CR-${requestId.slice(0, 17).toUpperCase()}`
}

function searchTextFor(
  title: string,
  aliases: Array<string>,
  source: typeof sourceInputValidator.type | undefined
) {
  return [
    title,
    ...aliases,
    source?.question,
    source?.body,
    source?.url,
    source?.name,
    source?.channel,
  ]
    .filter(Boolean)
    .join(" ")
}

function briefBullets(brief: typeof expertInterviewBriefValidator.type) {
  return [
    `Topic: ${brief.topic}`,
    `Summary: ${brief.summary}`,
    `Audience: ${brief.audience}`,
    `Framing: ${brief.framing}`,
    `FairLend posture: ${brief.fairlendPosture}`,
    `Founder contribution: ${brief.founderContribution}`,
    "Request type: expert_interview",
  ]
}

function contextDefinitionsFor(
  cleaned: ReturnType<typeof cleanPackage>,
  correlationId: string
) {
  return [
    {
      key: "brief" as const,
      kind: "source_summary" as const,
      title: "Expert interview brief",
      bulletPoints: briefBullets(cleaned.brief),
      citations: [],
      correlationId: `${correlationId}:brief`,
    },
    {
      key: "gaps" as const,
      kind: "missing_research" as const,
      title: "Knowledge gap · complete ordered set",
      bulletPoints: cleaned.gaps.map(
        (gap, index) =>
          `Gap ${index + 1} · ${gap.id} · ${gap.title} — Kind: ${gap.kind}. Existing coverage: ${gap.existingCoverage}. Why it falls short: ${gap.whyItFallsShort}. Expert opportunity: ${gap.expertOpportunity}.`
      ),
      citations: cleaned.gaps.flatMap((gap) => gap.citations),
      correlationId: `${correlationId}:gaps`,
    },
    {
      key: "questions" as const,
      kind: "talking_points" as const,
      title: "Interview question · complete ordered set",
      bulletPoints: cleaned.questions.map(
        (question, index) =>
          `Question ${index + 1} · ${question.id}: ${question.question} Motivation: ${question.motivation}. Knowledge gaps: ${question.gapIds.join(", ")}.`
      ),
      citations: [],
      correlationId: `${correlationId}:questions`,
    },
    {
      key: "instructions" as const,
      kind: "research_requirements" as const,
      title: "Expert interview agent instructions",
      bulletPoints: [
        cleaned.operatorInstructions
          ? `Operator-directed priority: ${cleaned.operatorInstructions}`
          : "Operator-directed priority: none supplied",
        "Preserve each expert response as an attributable source.",
        "Separate sourced facts from practitioner claims and editorial inference.",
        "Do not flatten disagreements between respondents during synthesis.",
        "Draft only after reviewing every question motivation and available response.",
      ],
      citations: [],
      correlationId: `${correlationId}:instructions`,
    },
  ]
}

function publicPackage(
  interview: {
    _id: Id<"expertInterviews">
    brief: typeof expertInterviewBriefValidator.type
    gaps: Array<typeof expertInterviewGapValidator.type>
    questions: Array<typeof expertInterviewQuestionValidator.type>
    operatorInstructions?: string
    createdAt: number
    updatedAt: number
  },
  requestHumanId: string
) {
  return {
    expertInterviewId: interview._id,
    requestHumanId,
    brief: interview.brief,
    gaps: interview.gaps,
    questions: interview.questions,
    operatorInstructions: interview.operatorInstructions ?? null,
    createdAt: interview.createdAt,
    updatedAt: interview.updatedAt,
  }
}

export const create = mutation({
  args: {
    title: v.string(),
    origin: explicitRequestOriginValidator,
    source: v.optional(sourceInputValidator),
    aliases: v.optional(v.array(v.string())),
    brief: expertInterviewBriefValidator,
    gaps: v.array(expertInterviewGapValidator),
    questions: v.array(expertInterviewQuestionValidator),
    operatorInstructions: v.optional(v.string()),
    correlationId: v.string(),
  },
  returns: createResultValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const title = required(args.title, "title")
    const correlationId = required(args.correlationId, "correlationId")
    const aliases = (args.aliases ?? []).map((alias) =>
      required(alias, "aliases")
    )
    if (aliases.length > 100)
      throw new ConvexError({ code: "VALIDATION_FAILED", field: "aliases" })
    const source = cleanSource(args.source)
    const cleaned = cleanPackage(args)
    const packageFingerprint = await sha256(canonicalJson(cleaned))
    const canonicalInput = canonicalJson({
      title,
      origin: args.origin,
      aliases,
      source: source ?? null,
      ...cleaned,
    })
    if (
      new TextEncoder().encode(canonicalInput).byteLength >
      MAX_EXPERT_INTERVIEW_PACKAGE_BYTES
    )
      throw new ConvexError({ code: "VALIDATION_FAILED", field: "input" })
    const inputFingerprint = await sha256(canonicalInput)
    const contextDefinitions = contextDefinitionsFor(cleaned, correlationId)
    const priorEvents = await ctx.db
      .query("auditEvents")
      .withIndex("by_organization_actor_operation_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("operation", "expert_interview.created")
          .eq("correlationId", correlationId)
      )
      .take(2)
    if (priorEvents.length > 1)
      throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
    const prior = priorEvents[0]

    const loadResult = async (requestId: Id<"contentRequests">) => {
      const request = await ctx.db.get(requestId)
      if (!request) throw new ConvexError({ code: "WRITE_FAILED" })
      const interview = await ctx.db
        .query("expertInterviews")
        .withIndex("by_request", (index) => index.eq("requestId", requestId))
        .unique()
      if (!interview) throw new ConvexError({ code: "WRITE_FAILED" })
      const contextOperationMatches = await Promise.all(
        contextDefinitions.map((definition) =>
          ctx.db
            .query("contextOperations")
            .withIndex("by_organization_actor_correlation", (index) =>
              index
                .eq("organizationId", principal.organizationId)
                .eq("actorPrincipalId", principal._id)
                .eq("correlationId", definition.correlationId)
            )
            .take(2)
        )
      )
      if (contextOperationMatches.some((matches) => matches.length !== 1))
        throw new ConvexError({ code: "WRITE_FAILED" })
      const contextOperations = contextOperationMatches.map(
        (matches) => matches[0]!
      )
      const projected = new Map<
        (typeof contextDefinitions)[number]["key"],
        {
          contextId: Id<"contextItems">
          kind: (typeof contextDefinitions)[number]["kind"]
          title: string
          bulletPoints: Array<string>
          citations: Array<{ label: string; url: string; supports: string }>
        }
      >()
      for (const [index, operation] of contextOperations.entries()) {
        const definition = contextDefinitions[index]
        if (!definition || !operation || operation.requestId !== requestId)
          throw new ConvexError({ code: "WRITE_FAILED" })
        const version = await ctx.db.get(operation.versionId)
        const context = await ctx.db.get(operation.contextItemId)
        if (
          !version ||
          !context ||
          context.requestId !== requestId ||
          version.contextItemId !== operation.contextItemId ||
          version.kind !== definition.kind ||
          context.kind !== definition.kind
        )
          throw new ConvexError({ code: "WRITE_FAILED" })
        projected.set(definition.key, {
          contextId: operation.contextItemId,
          kind: definition.kind,
          title: context.title,
          bulletPoints: context.bulletPoints,
          citations: context.citations,
        })
      }
      const brief = projected.get("brief")
      const gaps = projected.get("gaps")
      const questions = projected.get("questions")
      const instructions = projected.get("instructions")
      if (!brief || !gaps || !questions || !instructions)
        throw new ConvexError({ code: "WRITE_FAILED" })
      return {
        request: await toPublicRequest(ctx, request),
        humanId: request.humanId,
        package: publicPackage(interview, request.humanId),
        brief,
        gaps: [gaps],
        questions: [questions],
        instructions,
      }
    }

    if (prior) {
      if (prior.inputFingerprint !== inputFingerprint)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return loadResult(prior.requestId)
    }

    const auditCorrelations = [
      { operation: "content_request.created", correlationId },
      {
        operation: "expert_interview.package_saved",
        correlationId: `${correlationId}:package`,
      },
      ...contextDefinitions.map((definition) => ({
        operation: "context.upserted",
        correlationId: definition.correlationId,
      })),
      { operation: "expert_interview.created", correlationId },
    ]
    const [auditCollisions, contextOperationCollisions] = await Promise.all([
      Promise.all(
        auditCorrelations.map(({ operation, correlationId: derivedId }) =>
          ctx.db
            .query("auditEvents")
            .withIndex("by_organization_actor_operation_correlation", (index) =>
              index
                .eq("organizationId", principal.organizationId)
                .eq("actorPrincipalId", principal._id)
                .eq("operation", operation)
                .eq("correlationId", derivedId)
            )
            .first()
        )
      ),
      Promise.all(
        contextDefinitions.map((definition) =>
          ctx.db
            .query("contextOperations")
            .withIndex("by_organization_actor_correlation", (index) =>
              index
                .eq("organizationId", principal.organizationId)
                .eq("actorPrincipalId", principal._id)
                .eq("correlationId", definition.correlationId)
            )
            .first()
        )
      ),
    ])
    if (
      auditCollisions.some(Boolean) ||
      contextOperationCollisions.some(Boolean)
    )
      throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })

    const now = Date.now()
    const requestId = await ctx.db.insert("contentRequests", {
      ...contentRequestCreationDefaults(now),
      organizationId: principal.organizationId,
      title,
      normalizedTitle: normalizeText(title),
      searchText: searchTextFor(title, aliases, source),
      queueSortKey: requestQueueSortKey(args.origin, "critical", now),
      aliases,
      requestType: "expert_interview",
      origin: args.origin,
      priority: "critical",
      // Expert Interviews deliberately preserve source provenance without
      // participating in Standard Request URL deduplication.
      normalizedSourceUrl: undefined,
      assigneePrincipalId: principal._id,
      createdByPrincipalId: principal._id,
    })
    const humanId = humanIdFor(requestId)
    const primaryDeliverableId = await ctx.db.insert("deliverables", {
      organizationId: principal.organizationId,
      requestId,
      kind: "primary_response",
      name: "Primary response",
      isPrimary: true,
      retention: "active",
      createdAt: now,
      updatedAt: now,
    })
    let sourceSnapshotId: Id<"sourceSnapshots"> | undefined
    if (source) {
      sourceSnapshotId = await ctx.db.insert("sourceSnapshots", {
        organizationId: principal.organizationId,
        requestId,
        question: source.question,
        body: source.body,
        url: source.url,
        name: source.name,
        channel: source.channel,
        capturedByPrincipalId: principal._id,
        capturedAt: now,
      })
    }
    await ctx.db.insert("deliveryTargets", {
      organizationId: principal.organizationId,
      requestId,
      deliverableId: primaryDeliverableId,
      channel: source?.channel || "original_opportunity",
      destinationLabel: source?.name || "Original opportunity response",
      destinationUrl: source?.url,
      isOriginal: true,
      isRequired: true,
      retention: "active",
      createdByPrincipalId: principal._id,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(requestId, { humanId, sourceSnapshotId })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId,
      requestHumanId: humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "content_request.created",
      correlationId,
      occurredAt: now,
      afterVersion: 1,
      inputFingerprint,
    })
    const expertInterviewId = await ctx.db.insert("expertInterviews", {
      organizationId: principal.organizationId,
      requestId,
      ...cleaned,
      createdByPrincipalId: principal._id,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId,
      requestHumanId: humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "expert_interview.package_saved",
      correlationId: `${correlationId}:package`,
      occurredAt: now,
      beforeVersion: 1,
      afterVersion: 2,
      inputFingerprint: packageFingerprint,
    })

    let aggregateVersion = 2
    const projectedContexts = new Map<
      (typeof contextDefinitions)[number]["key"],
      {
        contextId: Id<"contextItems">
        kind: (typeof contextDefinitions)[number]["kind"]
        title: string
        bulletPoints: Array<string>
        citations: Array<{ label: string; url: string; supports: string }>
      }
    >()
    for (const definition of contextDefinitions) {
      const contextId = await ctx.db.insert("contextItems", {
        organizationId: principal.organizationId,
        requestId,
        kind: definition.kind,
        title: definition.title,
        bulletPoints: definition.bulletPoints,
        citations: definition.citations,
        updatedByPrincipalId: principal._id,
        createdAt: now,
        updatedAt: now,
      })
      const versionId = await ctx.db.insert("contextItemVersions", {
        organizationId: principal.organizationId,
        requestId,
        contextItemId: contextId,
        ordinal: 1,
        kind: definition.kind,
        title: definition.title,
        bulletPoints: definition.bulletPoints,
        citations: definition.citations,
        actorPrincipalId: principal._id,
        credentialId: principal.credentialId,
        correlationId: definition.correlationId,
        createdAt: now,
      })
      const contextFingerprint = await sha256(
        canonicalJson({
          kind: definition.kind,
          title: definition.title,
          bulletPoints: definition.bulletPoints,
          citations: definition.citations,
        })
      )
      await ctx.db.insert("contextOperations", {
        organizationId: principal.organizationId,
        actorPrincipalId: principal._id,
        requestId,
        correlationId: definition.correlationId,
        inputFingerprint: contextFingerprint,
        contextItemId: contextId,
        versionId,
      })
      await ctx.db.insert("auditEvents", {
        organizationId: principal.organizationId,
        requestId,
        requestHumanId: humanId,
        actorPrincipalId: principal._id,
        credentialId: principal.credentialId,
        operation: "context.upserted",
        correlationId: definition.correlationId,
        occurredAt: now,
        beforeVersion: aggregateVersion,
        afterVersion: aggregateVersion + 1,
        inputFingerprint: contextFingerprint,
      })
      aggregateVersion += 1
      projectedContexts.set(definition.key, {
        contextId,
        kind: definition.kind,
        title: definition.title,
        bulletPoints: definition.bulletPoints,
        citations: definition.citations,
      })
    }
    await ctx.db.patch(requestId, {
      aggregateVersion,
      updatedAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId,
      requestHumanId: humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "expert_interview.created",
      correlationId,
      occurredAt: now,
      afterVersion: aggregateVersion,
      inputFingerprint,
    })
    await refreshOperatorWorkspaceProjection(ctx, requestId)
    const expertInterview = await ctx.db.get(expertInterviewId)
    const brief = projectedContexts.get("brief")
    const gaps = projectedContexts.get("gaps")
    const questions = projectedContexts.get("questions")
    const instructions = projectedContexts.get("instructions")
    const request = await ctx.db.get(requestId)
    if (
      !request ||
      !expertInterview ||
      !brief ||
      !gaps ||
      !questions ||
      !instructions
    )
      throw new ConvexError({ code: "WRITE_FAILED" })
    return {
      request: await toPublicRequest(ctx, request),
      humanId,
      package: publicPackage(expertInterview, humanId),
      brief,
      gaps: [gaps],
      questions: [questions],
      instructions,
    }
  },
})

export const savePackage = mutation({
  args: {
    humanId: v.string(),
    brief: expertInterviewBriefValidator,
    gaps: v.array(expertInterviewGapValidator),
    questions: v.array(expertInterviewQuestionValidator),
    operatorInstructions: v.optional(v.string()),
    correlationId: v.string(),
  },
  returns: expertInterviewPackageValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const humanId = required(args.humanId, "humanId").toUpperCase()
    const correlationId = required(args.correlationId, "correlationId")
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", humanId)
      )
      .unique()
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    requireActiveRequest(request)
    const legacyCleaned = cleanPackage(args, { allowEmptyCitations: true })
    const legacyInputFingerprint = JSON.stringify(legacyCleaned)
    const rawLegacyInputFingerprint = JSON.stringify({
      brief: args.brief,
      gaps: args.gaps,
      questions: args.questions,
      operatorInstructions: args.operatorInstructions,
    })
    const inputFingerprint = await sha256(canonicalJson(legacyCleaned))
    const prior = await ctx.db
      .query("auditEvents")
      .withIndex("by_organization_actor_operation_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("operation", "expert_interview.package_saved")
          .eq("correlationId", correlationId)
      )
      .unique()
    const existing = await ctx.db
      .query("expertInterviews")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .unique()
    if (prior) {
      if (
        prior.requestId !== request._id ||
        (prior.inputFingerprint !== inputFingerprint &&
          prior.inputFingerprint !== legacyInputFingerprint &&
          prior.inputFingerprint !== rawLegacyInputFingerprint &&
          !matchesLegacyJsonFingerprint(prior.inputFingerprint, legacyCleaned))
      )
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      if (!existing) throw new ConvexError({ code: "WRITE_FAILED" })
      return publicPackage(existing, request.humanId)
    }
    const cleaned = cleanPackage(args)
    const contextDefinitions = contextDefinitionsFor(cleaned, correlationId)
    const [contextOperationCollisions, contextAuditCollisions] =
      await Promise.all([
        Promise.all(
          contextDefinitions.map((definition) =>
            ctx.db
              .query("contextOperations")
              .withIndex("by_organization_actor_correlation", (index) =>
                index
                  .eq("organizationId", principal.organizationId)
                  .eq("actorPrincipalId", principal._id)
                  .eq("correlationId", definition.correlationId)
              )
              .first()
          )
        ),
        Promise.all(
          contextDefinitions.map((definition) =>
            ctx.db
              .query("auditEvents")
              .withIndex(
                "by_organization_actor_operation_correlation",
                (index) =>
                  index
                    .eq("organizationId", principal.organizationId)
                    .eq("actorPrincipalId", principal._id)
                    .eq("operation", "context.upserted")
                    .eq("correlationId", definition.correlationId)
              )
              .first()
          )
        ),
      ])
    if (
      contextOperationCollisions.some(Boolean) ||
      contextAuditCollisions.some(Boolean)
    )
      throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })

    const now = Date.now()
    const packageVersion = request.aggregateVersion + 1
    let expertInterviewId = existing?._id
    if (existing) {
      await ctx.db.patch(existing._id, { ...cleaned, updatedAt: now })
    } else {
      expertInterviewId = await ctx.db.insert("expertInterviews", {
        organizationId: principal.organizationId,
        requestId: request._id,
        ...cleaned,
        createdByPrincipalId: principal._id,
        createdAt: now,
        updatedAt: now,
      })
    }
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "expert_interview.package_saved",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: packageVersion,
      inputFingerprint,
    })
    let aggregateVersion = packageVersion
    for (const definition of contextDefinitions) {
      const existingContext = await ctx.db
        .query("contextItems")
        .withIndex("by_request_kind", (index) =>
          index.eq("requestId", request._id).eq("kind", definition.kind)
        )
        .unique()
      const contextId = existingContext
        ? (await ctx.db.patch(existingContext._id, {
            title: definition.title,
            bulletPoints: definition.bulletPoints,
            citations: definition.citations,
            updatedByPrincipalId: principal._id,
            updatedAt: now,
          }),
          existingContext._id)
        : await ctx.db.insert("contextItems", {
            organizationId: principal.organizationId,
            requestId: request._id,
            kind: definition.kind,
            title: definition.title,
            bulletPoints: definition.bulletPoints,
            citations: definition.citations,
            updatedByPrincipalId: principal._id,
            createdAt: now,
            updatedAt: now,
          })
      const latestVersion = await ctx.db
        .query("contextItemVersions")
        .withIndex("by_context_ordinal", (index) =>
          index.eq("contextItemId", contextId)
        )
        .order("desc")
        .first()
      const versionId = await ctx.db.insert("contextItemVersions", {
        organizationId: principal.organizationId,
        requestId: request._id,
        contextItemId: contextId,
        ordinal: (latestVersion?.ordinal ?? 0) + 1,
        kind: definition.kind,
        title: definition.title,
        bulletPoints: definition.bulletPoints,
        citations: definition.citations,
        actorPrincipalId: principal._id,
        credentialId: principal.credentialId,
        correlationId: definition.correlationId,
        createdAt: now,
      })
      const contextFingerprint = await sha256(
        canonicalJson({
          kind: definition.kind,
          title: definition.title,
          bulletPoints: definition.bulletPoints,
          citations: definition.citations,
        })
      )
      await ctx.db.insert("contextOperations", {
        organizationId: principal.organizationId,
        actorPrincipalId: principal._id,
        requestId: request._id,
        correlationId: definition.correlationId,
        inputFingerprint: contextFingerprint,
        contextItemId: contextId,
        versionId,
      })
      await ctx.db.insert("auditEvents", {
        organizationId: principal.organizationId,
        requestId: request._id,
        requestHumanId: request.humanId,
        actorPrincipalId: principal._id,
        credentialId: principal.credentialId,
        operation: "context.upserted",
        correlationId: definition.correlationId,
        occurredAt: now,
        beforeVersion: aggregateVersion,
        afterVersion: aggregateVersion + 1,
        inputFingerprint: contextFingerprint,
      })
      aggregateVersion += 1
    }
    await ctx.db.patch(request._id, {
      requestType: "expert_interview",
      normalizedSourceUrl: undefined,
      aggregateVersion,
      updatedAt: now,
    })
    await refreshOperatorWorkspaceProjection(ctx, request._id)
    const saved = expertInterviewId ? await ctx.db.get(expertInterviewId) : null
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    return publicPackage(saved, request.humanId)
  },
})

export const getByHumanId = query({
  args: { humanId: v.string() },
  returns: v.union(expertInterviewPackageValidator, v.null()),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", args.humanId.trim().toUpperCase())
      )
      .unique()
    if (!request) return null
    if (
      principal.role === "founder" &&
      (request.assigneePrincipalId ?? request.createdByPrincipalId) !==
        principal._id
    )
      throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED" })
    const interview = await ctx.db
      .query("expertInterviews")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .unique()
    return interview ? publicPackage(interview, request.humanId) : null
  },
})
