import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"

export async function enqueueNotification(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  recipient: Doc<"principals">,
  type:
    | "request_assigned"
    | "critical_escalation"
    | "response_ready"
    | "drafting_failed"
    | "delivery_reopened",
  now: number
) {
  const hasEmail = Boolean(recipient.email)
  const notificationId = await ctx.db.insert("notifications", {
    organizationId: request.organizationId,
    requestId: request._id,
    recipientPrincipalId: recipient._id,
    type,
    emailQueued: hasEmail,
    emailStatus: hasEmail ? "queued" : "failed",
    createdAt: now,
  })
  if (!recipient.email) return
  const applicationUrl = (
    process.env.FAIRLEND_APP_URL ?? "https://content-requests.fairlend.ca"
  ).replace(/\/$/, "")
  const deliveryId = await ctx.db.insert("notificationEmailOutbox", {
    organizationId: request.organizationId,
    requestId: request._id,
    notificationId,
    recipientPrincipalId: recipient._id,
    recipientEmail: recipient.email,
    template: type,
    deepLink: `${applicationUrl}/app/requests/${request.humanId}`,
    status: "queued",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await ctx.scheduler.runAfter(0, internal.notifications.dispatchEmail, {
    deliveryId,
  })
}
