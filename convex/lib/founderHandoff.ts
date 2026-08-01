import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { deriveFounderHandoffStage } from "../../shared/founder-handoff"

type RequestCtx = QueryCtx | MutationCtx

export async function findCurrentFounderHandoff(
  ctx: RequestCtx,
  requestId: Id<"contentRequests">
) {
  return ctx.db
    .query("founderHandoffs")
    .withIndex("by_request_state", (index) =>
      index.eq("requestId", requestId).eq("state", "active")
    )
    .unique()
}

export async function founderHandoffStatus(
  ctx: RequestCtx,
  request: Doc<"contentRequests">,
  latestJob?: Doc<"agentJobs"> | null
) {
  const handoff = await findCurrentFounderHandoff(ctx, request._id)
  if (!handoff) return null
  const [recipient, notification, founderInput] = await Promise.all([
    ctx.db.get(handoff.recipientPrincipalId),
    handoff.notificationId ? ctx.db.get(handoff.notificationId) : null,
    ctx.db
      .query("founderInputDocuments")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .unique(),
  ])
  if (!recipient) return null
  const job =
    latestJob === undefined
      ? await ctx.db
          .query("agentJobs")
          .withIndex("by_request_created_at", (index) =>
            index.eq("requestId", request._id)
          )
          .order("desc")
          .first()
      : latestJob
  return {
    handoffId: handoff._id,
    recipient: {
      principalId: recipient._id,
      subject: recipient.subject,
      role: recipient.role,
    },
    selectedFormats: handoff.selectedFormats,
    note: handoff.note ?? null,
    stage: deriveFounderHandoffStage({
      lifecycle: request.lifecycle,
      hasFounderDraft: founderInput?.hasMeaningfulDraft ?? false,
      openedAt: handoff.openedAt ?? null,
      agentJobStatus: job?.status ?? null,
    }),
    deliveredAt: handoff.deliveredAt,
    openedAt: handoff.openedAt ?? null,
    emailStatus: notification?.emailStatus ?? null,
  }
}

export async function markCurrentFounderHandoffOpened(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  actorPrincipalId: Id<"principals">,
  now: number
) {
  const handoff = await findCurrentFounderHandoff(ctx, request._id)
  if (
    !handoff ||
    handoff.recipientPrincipalId !== actorPrincipalId ||
    handoff.openedAt
  )
    return false
  await ctx.db.patch(handoff._id, { openedAt: now, updatedAt: now })
  if (handoff.notificationId) {
    const notification = await ctx.db.get(handoff.notificationId)
    if (
      notification &&
      notification.recipientPrincipalId === actorPrincipalId &&
      !notification.readAt
    )
      await ctx.db.patch(notification._id, { readAt: now })
  }
  return true
}

export async function endCurrentFounderHandoff(
  ctx: MutationCtx,
  requestId: Id<"contentRequests">,
  nextAssigneePrincipalId: Id<"principals">,
  now: number
) {
  const handoff = await findCurrentFounderHandoff(ctx, requestId)
  if (!handoff || handoff.recipientPrincipalId === nextAssigneePrincipalId)
    return false
  await ctx.db.patch(handoff._id, {
    state: "ended",
    endedAt: now,
    updatedAt: now,
  })
  return true
}
