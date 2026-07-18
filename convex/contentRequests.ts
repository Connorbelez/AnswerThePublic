import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { requireEditor, requirePrincipal } from "./lib/authorization"
import {
  requestDispositionValidator,
  requestLifecycleValidator,
  requestOriginValidator,
  requestPriorityValidator,
  requestRetentionValidator,
} from "./schema"

const sourceInputValidator = v.object({
  question: v.optional(v.string()),
  body: v.optional(v.string()),
  url: v.optional(v.string()),
  name: v.optional(v.string()),
  channel: v.optional(v.string()),
})

const sourceOutputValidator = v.union(sourceInputValidator, v.null())

const explicitRequestOriginValidator = v.union(
  v.literal("manual"),
  v.literal("chatgpt_app"),
  v.literal("cli"),
  v.literal("http_api")
)

const contentRequestValidator = v.object({
  requestId: v.id("contentRequests"),
  humanId: v.string(),
  title: v.string(),
  aliases: v.array(v.string()),
  origin: requestOriginValidator,
  priority: requestPriorityValidator,
  lifecycle: requestLifecycleValidator,
  disposition: requestDispositionValidator,
  retention: requestRetentionValidator,
  aggregateVersion: v.number(),
  source: sourceOutputValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
})

const requestCandidateValidator = v.object({
  requestId: v.id("contentRequests"),
  humanId: v.string(),
  title: v.string(),
  origin: requestOriginValidator,
  priority: requestPriorityValidator,
  lifecycle: requestLifecycleValidator,
  score: v.number(),
})

const resolutionValidator = v.union(
  v.object({
    kind: v.literal("resolved"),
    matchedBy: v.union(v.literal("exact_id"), v.literal("exact_title")),
    request: contentRequestValidator,
  }),
  v.object({
    kind: v.literal("candidates"),
    candidates: v.array(requestCandidateValidator),
  }),
  v.object({ kind: v.literal("not_found"), candidates: v.array(v.any()) })
)

const auditEventValidator = v.object({
  eventId: v.id("auditEvents"),
  operation: v.string(),
  correlationId: v.string(),
  requestHumanId: v.string(),
  actorPrincipalId: v.id("principals"),
  credentialId: v.string(),
  occurredAt: v.number(),
  beforeVersion: v.union(v.number(), v.null()),
  afterVersion: v.number(),
})

type RequestContext = QueryCtx | MutationCtx

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase("en-CA").replace(/\s+/g, " ")
}

function cleanRequiredText(value: string, field: string) {
  const cleaned = value.trim()
  if (!cleaned) {
    throw new ConvexError({ code: "VALIDATION_FAILED", field })
  }
  return cleaned
}

function cleanOptionalText(value: string | undefined) {
  const cleaned = value?.trim()
  return cleaned ? cleaned : undefined
}

function publicSource(snapshot: Doc<"sourceSnapshots"> | null) {
  if (!snapshot) return null
  return {
    question: snapshot.question,
    body: snapshot.body,
    url: snapshot.url,
    name: snapshot.name,
    channel: snapshot.channel,
  }
}

async function toPublicRequest(
  ctx: RequestContext,
  request: Doc<"contentRequests">
) {
  const source = request.sourceSnapshotId
    ? await ctx.db.get(request.sourceSnapshotId)
    : null
  return {
    requestId: request._id,
    humanId: request.humanId,
    title: request.title,
    aliases: request.aliases,
    origin: request.origin,
    priority: request.priority,
    lifecycle: request.lifecycle,
    disposition: request.disposition,
    retention: request.retention,
    aggregateVersion: request.aggregateVersion,
    source: publicSource(source),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  }
}

function humanIdFor(requestId: Id<"contentRequests">) {
  return `CR-${requestId.slice(0, 17).toUpperCase()}`
}

function fuzzyScore(
  request: Doc<"contentRequests">,
  source: Doc<"sourceSnapshots"> | null,
  input: string
) {
  const queryText = normalizeText(input)
  if (!queryText) return 0
  const searchable = normalizeText(
    [
      request.title,
      ...request.aliases,
      source?.question,
      source?.body,
      source?.url,
      source?.name,
      source?.channel,
    ]
      .filter(Boolean)
      .join(" ")
  )
  const tokens = queryText.split(" ")
  if (!tokens.every((token) => searchable.includes(token))) return 0
  let score = tokens.length * 20
  if (searchable.startsWith(queryText)) score += 25
  if (searchable.includes(queryText)) score += 15
  return score
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

export const createManual = mutation({
  args: {
    title: v.string(),
    origin: explicitRequestOriginValidator,
    source: v.optional(sourceInputValidator),
    aliases: v.optional(v.array(v.string())),
    correlationId: v.string(),
  },
  returns: contentRequestValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const title = cleanRequiredText(args.title, "title")
    const correlationId = cleanRequiredText(args.correlationId, "correlationId")
    const aliases = (args.aliases ?? [])
      .map((alias) => cleanOptionalText(alias))
      .filter((alias): alias is string => Boolean(alias))
    const now = Date.now()
    const requestId = await ctx.db.insert("contentRequests", {
      humanId: "pending",
      organizationId: principal.organizationId,
      title,
      normalizedTitle: normalizeText(title),
      searchText: searchTextFor(title, aliases, args.source),
      aliases,
      origin: args.origin,
      priority: "critical",
      lifecycle: "pending",
      disposition: "active",
      retention: "active",
      aggregateVersion: 1,
      createdByPrincipalId: principal._id,
      createdAt: now,
      updatedAt: now,
    })
    const humanId = humanIdFor(requestId)
    let sourceSnapshotId: Id<"sourceSnapshots"> | undefined
    if (args.source) {
      sourceSnapshotId = await ctx.db.insert("sourceSnapshots", {
        organizationId: principal.organizationId,
        requestId,
        question: args.source.question,
        body: args.source.body,
        url: args.source.url,
        name: args.source.name,
        channel: args.source.channel,
        capturedByPrincipalId: principal._id,
        capturedAt: now,
      })
    }
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
    })
    const request = await ctx.db.get(requestId)
    if (!request) throw new ConvexError({ code: "WRITE_FAILED" })
    return toPublicRequest(ctx, request)
  },
})

export const getByHumanId = query({
  args: { humanId: v.string() },
  returns: v.union(contentRequestValidator, v.null()),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", args.humanId.trim().toUpperCase())
      )
      .unique()
    return request ? toPublicRequest(ctx, request) : null
  },
})

export const list = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(contentRequestValidator),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    if (principal.role === "founder") return []
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 100)
    const requests = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_created_at", (index) =>
        index.eq("organizationId", principal.organizationId)
      )
      .order("desc")
      .take(limit)
    return Promise.all(requests.map((request) => toPublicRequest(ctx, request)))
  },
})

export const resolve = query({
  args: { query: v.string() },
  returns: resolutionValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const rawQuery = cleanRequiredText(args.query, "query")
    const exactId = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", rawQuery.toUpperCase())
      )
      .unique()
    if (exactId) {
      return {
        kind: "resolved" as const,
        matchedBy: "exact_id" as const,
        request: await toPublicRequest(ctx, exactId),
      }
    }

    const normalizedQuery = normalizeText(rawQuery)
    const exactTitles = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_normalized_title", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("normalizedTitle", normalizedQuery)
      )
      .collect()
    if (exactTitles.length === 1) {
      return {
        kind: "resolved" as const,
        matchedBy: "exact_title" as const,
        request: await toPublicRequest(ctx, exactTitles[0]),
      }
    }

    const requests = await ctx.db
      .query("contentRequests")
      .withSearchIndex("search_content", (search) =>
        search
          .search("searchText", rawQuery)
          .eq("organizationId", principal.organizationId)
      )
      .take(50)
    const scored = await Promise.all(
      requests.map(async (request) => {
        const source = request.sourceSnapshotId
          ? await ctx.db.get(request.sourceSnapshotId)
          : null
        return { request, score: fuzzyScore(request, source, rawQuery) }
      })
    )
    const candidates = scored
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.request.createdAt - right.request.createdAt
      )
      .slice(0, 10)
      .map(({ request, score }) => ({
        requestId: request._id,
        humanId: request.humanId,
        title: request.title,
        origin: request.origin,
        priority: request.priority,
        lifecycle: request.lifecycle,
        score,
      }))
    if (candidates.length === 0) {
      return { kind: "not_found" as const, candidates: [] }
    }
    return { kind: "candidates" as const, candidates }
  },
})

export const listAuditEvents = query({
  args: { humanId: v.string() },
  returns: v.array(auditEventValidator),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", args.humanId.trim().toUpperCase())
      )
      .unique()
    if (!request) return []
    const events = await ctx.db
      .query("auditEvents")
      .withIndex("by_request_occurred_at", (index) =>
        index.eq("requestId", request._id)
      )
      .collect()
    return events.map((event) => ({
      eventId: event._id,
      operation: event.operation,
      correlationId: event.correlationId,
      requestHumanId: event.requestHumanId,
      actorPrincipalId: event.actorPrincipalId,
      credentialId: event.credentialId,
      occurredAt: event.occurredAt,
      beforeVersion: event.beforeVersion ?? null,
      afterVersion: event.afterVersion,
    }))
  },
})
