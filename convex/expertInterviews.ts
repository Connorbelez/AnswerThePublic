import { ConvexError, v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
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
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"

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

function cleanPackage(args: {
  brief: typeof expertInterviewBriefValidator.type
  gaps: Array<typeof expertInterviewGapValidator.type>
  questions: Array<typeof expertInterviewQuestionValidator.type>
  operatorInstructions?: string
}) {
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
    const cleaned = cleanPackage(args)
    const inputFingerprint = JSON.stringify(cleaned)
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
        prior.inputFingerprint !== inputFingerprint
      )
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      if (!existing) throw new ConvexError({ code: "WRITE_FAILED" })
      return publicPackage(existing, request.humanId)
    }
    const now = Date.now()
    const nextVersion = request.aggregateVersion + 1
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
    await ctx.db.patch(request._id, {
      requestType: "expert_interview",
      aggregateVersion: nextVersion,
      updatedAt: now,
    })
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
      afterVersion: nextVersion,
      inputFingerprint,
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
