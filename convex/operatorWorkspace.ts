import { paginationOptsValidator, type PaginationOptions } from "convex/server"
import { ConvexError, v } from "convex/values"

import type { Doc } from "./_generated/dataModel"
import { internalMutation, query, type QueryCtx } from "./_generated/server"
import { contentRequestValidator, toPublicRequest } from "./contentRequests"
import { requireEditor, requirePrincipal } from "./lib/authorization"
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"
import {
  requestDispositionValidator,
  requestLifecycleValidator,
  requestOriginValidator,
  requestPriorityValidator,
} from "./schema"

const queueValidator = v.union(
  v.literal("needs_elie"),
  v.literal("agent_drafting"),
  v.literal("needs_operator"),
  v.literal("delivered"),
  v.literal("attention_required")
)
const jobStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("retry_wait"),
  v.literal("failed"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.null()
)
const itemValidator = v.object({
  request: contentRequestValidator,
  queue: queueValidator,
  agentJobStatus: jobStatusValidator,
  requiredDeliveryConfirmed: v.number(),
  requiredDeliveryTotal: v.number(),
  openConflictCount: v.number(),
  attentionReasonCount: v.number(),
  attentionReasons: v.array(v.string()),
  deliveryChannels: v.array(v.string()),
  nextActionChangedAt: v.number(),
})

type WorkspaceFilters = {
  queue?: Doc<"operatorWorkspaceItems">["queue"]
  priority?: Doc<"operatorWorkspaceItems">["priority"]
  origin?: Doc<"operatorWorkspaceItems">["origin"]
  lifecycle?: Doc<"operatorWorkspaceItems">["lifecycle"]
  disposition?: Doc<"operatorWorkspaceItems">["disposition"]
  assigneePrincipalId?: Doc<"operatorWorkspaceItems">["assigneePrincipalId"]
  deliveryChannel?: string
}

const cursorPrefix = "operator-workspace:v1:"
const orderBuckets = [
  "00:00",
  "00:01",
  "00:02",
  "00:03",
  "01:00",
  "01:01",
  "01:02",
  "01:03",
] as const
type OrderBucket = (typeof orderBuckets)[number]

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-CA")
}

function encodeSearchCursor(stage: OrderBucket, cursor: string | null) {
  return `${cursorPrefix}${JSON.stringify({ stage, cursor })}`
}

function decodeSearchCursor(cursor: string | null) {
  if (!cursor) return { stage: orderBuckets[0], cursor: null as string | null }
  if (!cursor.startsWith(cursorPrefix))
    throw new ConvexError({ code: "INVALID_PAGINATION_CURSOR" })
  try {
    const decoded = JSON.parse(cursor.slice(cursorPrefix.length)) as {
      stage?: unknown
      cursor?: unknown
    }
    if (
      !orderBuckets.includes(decoded.stage as OrderBucket) ||
      (typeof decoded.cursor !== "string" && decoded.cursor !== null)
    )
      throw new Error("Invalid cursor payload")
    return {
      stage: decoded.stage as OrderBucket,
      cursor: decoded.cursor,
    }
  } catch {
    throw new ConvexError({ code: "INVALID_PAGINATION_CURSOR" })
  }
}

export const refreshRequest = internalMutation({
  args: { requestId: v.id("contentRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await refreshOperatorWorkspaceProjection(ctx, args.requestId)
    return null
  },
})

function matches(
  projection: Doc<"operatorWorkspaceItems">,
  args: WorkspaceFilters
) {
  const inScope =
    projection.retained &&
    (args.disposition
      ? projection.disposition === args.disposition
      : projection.active)
  return (
    inScope &&
    (!args.queue || projection.queue === args.queue) &&
    (!args.priority || projection.priority === args.priority) &&
    (!args.origin || projection.origin === args.origin) &&
    (!args.lifecycle || projection.lifecycle === args.lifecycle) &&
    (!args.assigneePrincipalId ||
      projection.assigneePrincipalId === args.assigneePrincipalId) &&
    (!args.deliveryChannel ||
      projection.deliveryChannels
        .map(normalize)
        .includes(normalize(args.deliveryChannel)))
  )
}

async function toItem(
  ctx: QueryCtx,
  projection: Doc<"operatorWorkspaceItems">
) {
  const request = await ctx.db.get(projection.requestId)
  if (!request) return null
  return {
    request: await toPublicRequest(ctx, request),
    queue: projection.queue,
    agentJobStatus: projection.agentJobStatus ?? null,
    requiredDeliveryConfirmed: projection.requiredDeliveryConfirmed,
    requiredDeliveryTotal: projection.requiredDeliveryTotal,
    openConflictCount: projection.openConflictCount,
    attentionReasonCount: projection.attentionReasonCount,
    attentionReasons: projection.attentionReasons,
    deliveryChannels: projection.deliveryChannels,
    nextActionChangedAt: projection.nextActionChangedAt,
  }
}

function searchRowsQuery(
  ctx: QueryCtx,
  organizationId: string,
  args: WorkspaceFilters,
  terms: string,
  normalizedTitle: string | undefined,
  orderBucket: OrderBucket
) {
  return ctx.db
    .query("operatorWorkspaceSearchRows")
    .withSearchIndex("search_workspace_rows", (index) => {
      let scoped = index
        .search("searchText", terms)
        .eq("organizationId", organizationId)
        .eq(
          "channelKey",
          args.deliveryChannel ? normalize(args.deliveryChannel) : ""
        )
        .eq("orderBucket", orderBucket)
      if (args.disposition)
        scoped = scoped.eq("retained", true).eq("disposition", args.disposition)
      else scoped = scoped.eq("active", true)
      if (args.queue) scoped = scoped.eq("queue", args.queue)
      if (args.priority) scoped = scoped.eq("priority", args.priority)
      if (args.origin) scoped = scoped.eq("origin", args.origin)
      if (args.lifecycle) scoped = scoped.eq("lifecycle", args.lifecycle)
      if (args.assigneePrincipalId)
        scoped = scoped.eq("assigneePrincipalId", args.assigneePrincipalId)
      if (normalizedTitle)
        scoped = scoped.eq("normalizedTitle", normalizedTitle)
      return scoped
    })
}

async function materializedSearch(
  ctx: QueryCtx,
  organizationId: string,
  args: WorkspaceFilters,
  terms: string,
  normalizedTitle: string | undefined,
  paginationOpts: PaginationOptions
) {
  const decoded = decodeSearchCursor(paginationOpts.cursor)
  let stageIndex = orderBuckets.indexOf(decoded.stage)
  const cursor = decoded.cursor

  if (!cursor) {
    while (stageIndex < orderBuckets.length) {
      const preview = await searchRowsQuery(
        ctx,
        organizationId,
        args,
        terms,
        normalizedTitle,
        orderBuckets[stageIndex]
      ).take(1)
      if (preview.length > 0) break
      stageIndex += 1
    }
  }
  if (stageIndex >= orderBuckets.length)
    return { rows: [], isDone: true, continueCursor: "" }

  const currentBucket = orderBuckets[stageIndex]
  const current = await searchRowsQuery(
    ctx,
    organizationId,
    args,
    terms,
    normalizedTitle,
    currentBucket
  ).paginate({ numItems: paginationOpts.numItems, cursor })
  if (!current.isDone)
    return {
      rows: current.page,
      isDone: false,
      continueCursor: encodeSearchCursor(currentBucket, current.continueCursor),
    }

  let nextStage = stageIndex + 1
  while (nextStage < orderBuckets.length) {
    const preview = await searchRowsQuery(
      ctx,
      organizationId,
      args,
      terms,
      normalizedTitle,
      orderBuckets[nextStage]
    ).take(1)
    if (preview.length > 0)
      return {
        rows: current.page,
        isDone: false,
        continueCursor: encodeSearchCursor(orderBuckets[nextStage], null),
      }
    nextStage += 1
  }
  return {
    rows: current.page,
    isDone: true,
    continueCursor: "",
  }
}

async function itemsFromSearchRows(
  ctx: QueryCtx,
  rows: Array<Doc<"operatorWorkspaceSearchRows">>
) {
  const projections = await Promise.all(
    rows.map((row) =>
      ctx.db
        .query("operatorWorkspaceItems")
        .withIndex("by_request", (index) =>
          index.eq("requestId", row.requestId)
        )
        .unique()
    )
  )
  const items = await Promise.all(
    projections.map((projection) =>
      projection ? toItem(ctx, projection) : null
    )
  )
  return items.filter((item) => item !== null)
}

export const list = query({
  args: {
    queue: v.optional(queueValidator),
    search: v.optional(v.string()),
    priority: v.optional(requestPriorityValidator),
    origin: v.optional(requestOriginValidator),
    lifecycle: v.optional(requestLifecycleValidator),
    disposition: v.optional(requestDispositionValidator),
    assigneePrincipalId: v.optional(v.id("principals")),
    deliveryChannel: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(itemValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const search = args.search?.trim()
    const filters: WorkspaceFilters = args

    if (search) {
      const exactId = await ctx.db
        .query("operatorWorkspaceItems")
        .withIndex("by_organization_human_id", (index) =>
          index
            .eq("organizationId", principal.organizationId)
            .eq("humanId", search.toUpperCase())
        )
        .unique()
      if (exactId) {
        const item = matches(exactId, filters)
          ? await toItem(ctx, exactId)
          : null
        return { page: item ? [item] : [], isDone: true, continueCursor: "" }
      }

      const normalizedTitle = normalize(search)
      const disposition = args.disposition ?? "active"
      const exactTitle = await ctx.db
        .query("operatorWorkspaceItems")
        .withIndex(
          "by_organization_normalized_title_retained_disposition_sort",
          (index) =>
            index
              .eq("organizationId", principal.organizationId)
              .eq("normalizedTitle", normalizedTitle)
              .eq("retained", true)
              .eq("disposition", disposition)
        )
        .first()
      if (exactTitle) {
        const result = await materializedSearch(
          ctx,
          principal.organizationId,
          filters,
          "operatorworkspaceall",
          normalizedTitle,
          args.paginationOpts
        )
        return {
          page: await itemsFromSearchRows(ctx, result.rows),
          isDone: result.isDone,
          continueCursor: result.continueCursor,
        }
      }
    }

    const hasFacetFilters = Boolean(
      args.priority ||
      args.origin ||
      args.lifecycle ||
      args.disposition ||
      args.assigneePrincipalId ||
      args.deliveryChannel
    )
    if (search || hasFacetFilters) {
      const result = await materializedSearch(
        ctx,
        principal.organizationId,
        filters,
        search || "operatorworkspaceall",
        undefined,
        args.paginationOpts
      )
      return {
        page: await itemsFromSearchRows(ctx, result.rows),
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      }
    }

    const result = args.queue
      ? await ctx.db
          .query("operatorWorkspaceItems")
          .withIndex("by_organization_active_queue_sort", (index) =>
            index
              .eq("organizationId", principal.organizationId)
              .eq("active", true)
              .eq("queue", args.queue!)
          )
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("operatorWorkspaceItems")
          .withIndex("by_organization_active_sort", (index) =>
            index
              .eq("organizationId", principal.organizationId)
              .eq("active", true)
          )
          .paginate(args.paginationOpts)
    const items = await Promise.all(
      result.page.map((item) => toItem(ctx, item))
    )
    return {
      page: items.filter((item) => item !== null),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    }
  },
})
