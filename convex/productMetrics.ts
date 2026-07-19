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
  firstOpens: v.number(),
  founderSubmissions: v.number(),
  readyResponses: v.number(),
  deliveries: v.number(),
  expirations: v.number(),
  failures: v.number(),
  retriesScheduled: v.number(),
  draftingCompletions: v.number(),
  draftingFailureRate: v.number(),
  deliveriesWithExpiration: v.number(),
  deliveriesBeforeExpiration: v.number(),
  deliveryBeforeExpirationRate: v.number(),
  agentDraftDeliveries: v.number(),
  rewrittenResponses: v.number(),
  rewriteRate: v.number(),
  deliveredWithoutSubstantialRewriteRate: v.number(),
  medianCreationToFirstOpenMs: v.union(v.number(), v.null()),
  medianCreationToFounderSubmissionMs: v.union(v.number(), v.null()),
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
  "requestId" | "operation" | "occurredAt" | "productMetric"
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
  const created = firstByRequest(events, operation("content_request.created"))
  const opened = firstByRequest(events, operation("content_request.opened"))
  const submissions = firstByRequest(
    events,
    operation("founder_input.submitted")
  )
  const ready = firstByRequest(
    events,
    operation("agent_job.completed", "content_request.ready_response")
  )
  const completedDeliveryEvents = events.filter(
    (event) =>
      event.operation === "delivery_receipt.confirmed" &&
      event.productMetric?.responseCompleted
  )
  const delivered = firstByRequest(
    completedDeliveryEvents,
    operation("delivery_receipt.confirmed")
  )
  const expired = firstByRequest(events, operation("content_request.expired"))
  const failed = events.filter(
    (event) => event.operation === "agent_job.failed"
  )
  const retries = events.filter(
    (event) => event.operation === "agent_job.retry_scheduled"
  )
  const draftingCompletions = events.filter(
    (event) => event.operation === "agent_job.completed"
  )
  const deliveriesWithExpiration = new Set<string>()
  const deliveriesBeforeExpiration = new Set<string>()
  const agentDraftDeliveries = new Set<string>()
  const rewrittenRequestIds = new Set<string>()
  for (const event of completedDeliveryEvents) {
    const requestId = String(event.requestId)
    if (event.occurredAt !== delivered.get(requestId)) continue
    if (event.productMetric?.deliveryBeforeExpiration !== undefined)
      deliveriesWithExpiration.add(requestId)
    if (event.productMetric?.deliveryBeforeExpiration)
      deliveriesBeforeExpiration.add(requestId)
    if (event.productMetric?.agentDraftDelivered)
      agentDraftDeliveries.add(requestId)
    if (
      event.productMetric?.agentDraftDelivered &&
      event.productMetric.substantialOperatorRewrite
    )
      rewrittenRequestIds.add(requestId)
  }
  const creationToFirstOpen = [...opened.entries()].flatMap(
    ([requestId, openedAt]) => {
      const createdAt = created.get(requestId)
      return createdAt === undefined || openedAt < createdAt
        ? []
        : [openedAt - createdAt]
    }
  )
  const creationToFounderSubmission = [...submissions.entries()].flatMap(
    ([requestId, submittedAt]) => {
      const createdAt = created.get(requestId)
      return createdAt === undefined || submittedAt < createdAt
        ? []
        : [submittedAt - createdAt]
    }
  )
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
    firstOpens: opened.size,
    founderSubmissions: submissions.size,
    readyResponses: ready.size,
    deliveries: delivered.size,
    expirations: expired.size,
    failures: failed.length,
    retriesScheduled: retries.length,
    draftingCompletions: draftingCompletions.length,
    draftingFailureRate:
      failed.length + draftingCompletions.length === 0
        ? 0
        : failed.length / (failed.length + draftingCompletions.length),
    deliveriesWithExpiration: deliveriesWithExpiration.size,
    deliveriesBeforeExpiration: deliveriesBeforeExpiration.size,
    deliveryBeforeExpirationRate:
      deliveriesWithExpiration.size === 0
        ? 0
        : deliveriesBeforeExpiration.size / deliveriesWithExpiration.size,
    agentDraftDeliveries: agentDraftDeliveries.size,
    rewrittenResponses: rewrittenRequestIds.size,
    rewriteRate:
      agentDraftDeliveries.size === 0
        ? 0
        : rewrittenRequestIds.size / agentDraftDeliveries.size,
    deliveredWithoutSubstantialRewriteRate:
      agentDraftDeliveries.size === 0
        ? 0
        : (agentDraftDeliveries.size - rewrittenRequestIds.size) /
          agentDraftDeliveries.size,
    medianCreationToFirstOpenMs: median(creationToFirstOpen),
    medianCreationToFounderSubmissionMs: median(creationToFounderSubmission),
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
