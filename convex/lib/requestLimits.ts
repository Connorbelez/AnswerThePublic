export const MAX_DELIVERABLES_PER_REQUEST = 50
export const MAX_DELIVERY_TARGETS_PER_REQUEST = 50
export const MAX_VOICE_CAPTURES_PER_REQUEST = 50
export const VOICE_CAPTURE_OVERFLOW_SENTINEL =
  MAX_VOICE_CAPTURES_PER_REQUEST + 1
export const MAX_AGENT_JOBS_PER_REQUEST = 1

export function assertWithinRequestLimit(
  count: number,
  limit: number,
  resource: string
) {
  if (count >= limit) {
    throw new ConvexError({
      code: "REQUEST_CHILD_LIMIT_REACHED",
      resource,
      limit,
    })
  }
}

export function assertRequestCollectionBound(
  count: number,
  limit: number,
  resource: string
) {
  if (count > limit) {
    throw new ConvexError({
      code: "REQUEST_CHILD_LIMIT_REQUIRES_REMEDIATION",
      resource,
      limit,
    })
  }
}
import { ConvexError } from "convex/values"
