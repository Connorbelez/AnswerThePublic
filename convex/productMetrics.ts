import { ConvexError, v } from "convex/values"

import type { Doc } from "./_generated/dataModel"
import { query } from "./_generated/server"
import { requirePrincipal } from "./lib/authorization"

const MAX_EVENTS = 10_000
const MAX_WINDOW_MS = 366 * 24 * 60 * 60 * 1_000

const metricValidator = v.object({
  from: v.number(),
  to: v.number(),
  generatedAt: v.number(),
  truncated: v.boolean(),
  founderSubmissions: v.number(),
  readyResponses: v.number(),
  deliveries: v.number(),
  expirations: v.number(),
  failures: v.number(),
  retriesScheduled: v.number(),
  rewrittenResponses: v.number(),
  rewriteRate: v.number(),
  medianFounderToReadyMs: v.union(v.number(), v.null()),
  medianReadyToDeliveryMs: v.union(v.number(), v.null()),
})

function median(values: Array<number>) {
  if (values.length === 0) return null
  const ordered = [...values].sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!
}

type MetricEvent = Pick<
  Doc<"auditEvents">,
  "requestId" | "operation" | "occurredAt"
>

function firstByRequest(
  events: Array<MetricEvent>,
  operations: ReadonlySet<string>
) {
  const result = new Map<string, number>()
  for (const event of events) {
    if (!operations.has(event.operation)) continue
    const key = String(event.requestId)
    const prior = result.get(key)
    if (prior === undefined || event.occurredAt < prior)
      result.set(key, event.occurredAt)
  }
  return result
}

const operation = (...values: Array<string>) => new Set(values)

export function aggregateProductMetricEvents(
  page: Array<MetricEvent>,
  window: { from: number; to: number; generatedAt: number }
) {
  const truncated = page.length > MAX_EVENTS
  const events = page.slice(0, MAX_EVENTS)
  const submissions = firstByRequest(
    events,
    operation("founder_input.submitted")
  )
  const ready = firstByRequest(
    events,
    operation("agent_job.completed", "content_request.ready_response")
  )
  const delivered = firstByRequest(
    events,
    operation("delivery_receipt.confirmed")
  )
  const expired = firstByRequest(events, operation("content_request.expired"))
  const failed = events.filter(
    (event) => event.operation === "agent_job.failed"
  )
  const retries = events.filter(
    (event) => event.operation === "agent_job.retry_scheduled"
  )
  const rewrittenRequestIds = new Set<string>()
  for (const event of events) {
    if (event.operation !== "deliverable.version_created") continue
    const requestId = String(event.requestId)
    const readyAt = ready.get(requestId)
    if (readyAt !== undefined && event.occurredAt > readyAt)
      rewrittenRequestIds.add(requestId)
  }
  const founderToReady = [...ready.entries()].flatMap(
    ([requestId, readyAt]) => {
      const submittedAt = submissions.get(requestId)
      return submittedAt === undefined || readyAt < submittedAt
        ? []
        : [readyAt - submittedAt]
    }
  )
  const readyToDelivery = [...delivered.entries()].flatMap(
    ([requestId, deliveredAt]) => {
      const readyAt = ready.get(requestId)
      return readyAt === undefined || deliveredAt < readyAt
        ? []
        : [deliveredAt - readyAt]
    }
  )

  return {
    ...window,
    truncated,
    founderSubmissions: submissions.size,
    readyResponses: ready.size,
    deliveries: delivered.size,
    expirations: expired.size,
    failures: failed.length,
    retriesScheduled: retries.length,
    rewrittenResponses: rewrittenRequestIds.size,
    rewriteRate: ready.size === 0 ? 0 : rewrittenRequestIds.size / ready.size,
    medianFounderToReadyMs: median(founderToReady),
    medianReadyToDeliveryMs: median(readyToDelivery),
  }
}

export const get = query({
  args: {
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  returns: metricValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    if (
      principal.role !== "operator_editor" &&
      principal.role !== "agent_editor" &&
      principal.role !== "administrator"
    )
      throw new ConvexError({ code: "ROLE_ACCESS_DENIED" })

    const generatedAt = Date.now()
    const to = args.to ?? generatedAt
    const from = args.from ?? to - 30 * 24 * 60 * 60 * 1_000
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 0 ||
      to <= from ||
      to - from > MAX_WINDOW_MS
    )
      throw new ConvexError({ code: "VALIDATION_FAILED" })

    const page = await ctx.db
      .query("auditEvents")
      .withIndex("by_organization_occurred_at", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .gte("occurredAt", from)
          .lte("occurredAt", to)
      )
      .order("asc")
      .take(MAX_EVENTS + 1)
    return aggregateProductMetricEvents(page, { from, to, generatedAt })
  },
})
