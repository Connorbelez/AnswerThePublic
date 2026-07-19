import type { Doc } from "../_generated/dataModel"

type QueueOrigin = Doc<"contentRequests">["origin"]
type QueuePriority = Doc<"contentRequests">["priority"]

const priorityBucket: Record<QueuePriority, string> = {
  critical: "00",
  high: "01",
  normal: "02",
  low: "03",
}

/**
 * Stable lexical queue ordering. Explicitly requested work always sorts ahead
 * of scout-generated work; priority and recency break ties within that class.
 */
export function requestQueueSortKey(
  origin: QueueOrigin,
  priority: QueuePriority,
  createdAt: number
) {
  const originBucket = origin === "automated_scout" ? "01" : "00"
  const reverseTime = String(Number.MAX_SAFE_INTEGER - createdAt).padStart(
    16,
    "0"
  )
  return `${originBucket}:${priorityBucket[priority]}:${reverseTime}`
}
