import { ConvexError } from "convex/values"

import type { Doc } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { lifecycleForPrimary } from "./deliverableLifecycle"

export async function projectDeliveryLifecycle(
  ctx: MutationCtx,
  request: Doc<"contentRequests">
) {
  const targets = await ctx.db
    .query("deliveryTargets")
    .withIndex("by_request", (index) => index.eq("requestId", request._id))
    .collect()
  const required = targets.filter(
    (target) => target.retention === "active" && target.isRequired
  )
  if (
    required.length > 0 &&
    required.every((target) => target.currentReceiptId)
  ) {
    await ctx.db.patch(request._id, { lifecycle: "responded" })
    return
  }
  const deliverables = await ctx.db
    .query("deliverables")
    .withIndex("by_request", (index) => index.eq("requestId", request._id))
    .collect()
  const primary = deliverables.find(
    (deliverable) =>
      deliverable.isPrimary && (deliverable.retention ?? "active") === "active"
  )
  if (!primary) throw new ConvexError({ code: "PRIMARY_DELIVERABLE_MISSING" })
  await ctx.db.patch(request._id, {
    lifecycle: await lifecycleForPrimary(
      ctx,
      request.lifecycle === "responded"
        ? { ...request, lifecycle: "ready_to_respond" }
        : request,
      primary
    ),
  })
}
