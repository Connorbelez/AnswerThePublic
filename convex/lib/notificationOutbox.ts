import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"

const DEFAULT_GUEST_EXPIRY_NOTIFICATION_THRESHOLD_HOURS = 12
const MAX_GUEST_EXPIRY_NOTIFICATION_THRESHOLD_HOURS = 48

export function guestExpiryNotificationThresholdMs() {
  const configured = Number(
    process.env.GUEST_ACCESS_EXPIRY_NOTIFICATION_THRESHOLD_HOURS ??
      DEFAULT_GUEST_EXPIRY_NOTIFICATION_THRESHOLD_HOURS
  )
  const hours =
    Number.isFinite(configured) &&
    configured > 0 &&
    configured <= MAX_GUEST_EXPIRY_NOTIFICATION_THRESHOLD_HOURS
      ? configured
      : DEFAULT_GUEST_EXPIRY_NOTIFICATION_THRESHOLD_HOURS
  return hours * 60 * 60 * 1_000
}

export type NotificationType =
  | "request_assigned"
  | "founder_handoff"
  | "critical_escalation"
  | "deadline_approaching"
  | "response_ready"
  | "drafting_failed"
  | "delivery_reopened"
  | "guest_submission"
  | "guest_expiry_approaching"
  | "guest_upload_failed"

type NotificationContext = {
  dedupeKey?: string
  grantId?: Doc<"guestAccessGrants">["_id"]
  assetId?: Doc<"responseAssets">["_id"]
  submissionId?: Doc<"responseSubmissions">["_id"]
}

async function enqueueNotificationWithResult(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  recipient: Doc<"principals">,
  type: NotificationType,
  now: number,
  context: NotificationContext = {}
) {
  if (context.dedupeKey) {
    const existing = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_dedupe_key", (index) =>
        index
          .eq("recipientPrincipalId", recipient._id)
          .eq("dedupeKey", context.dedupeKey)
      )
      .unique()
    if (existing) return { notificationId: existing._id, created: false }
  }
  const hasEmail = Boolean(recipient.email)
  const relativeDeepLink = context.grantId
    ? `/app/requests/${request.humanId}#guest-access-${context.grantId}${
        context.assetId ? `-asset-${context.assetId}` : ""
      }`
    : `/app/requests/${request.humanId}`
  const notificationId = await ctx.db.insert("notifications", {
    organizationId: request.organizationId,
    requestId: request._id,
    recipientPrincipalId: recipient._id,
    type,
    dedupeKey: context.dedupeKey,
    grantId: context.grantId,
    assetId: context.assetId,
    submissionId: context.submissionId,
    deepLink: relativeDeepLink,
    emailQueued: hasEmail,
    emailStatus: hasEmail ? "queued" : "failed",
    createdAt: now,
  })
  if (!recipient.email) return { notificationId, created: true }
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
    deepLink: `${applicationUrl}${relativeDeepLink}`,
    status: "queued",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await ctx.scheduler.runAfter(0, internal.notifications.dispatchEmail, {
    deliveryId,
  })
  return { notificationId, created: true }
}

export async function enqueueNotification(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  recipient: Doc<"principals">,
  type: NotificationType,
  now: number,
  context: NotificationContext = {}
) {
  return (
    await enqueueNotificationWithResult(
      ctx,
      request,
      recipient,
      type,
      now,
      context
    )
  ).notificationId
}

export async function enqueueAdministratorNotifications(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  type: Extract<
    NotificationType,
    "guest_submission" | "guest_expiry_approaching" | "guest_upload_failed"
  >,
  now: number,
  context: NotificationContext
) {
  const administrators = await ctx.db
    .query("principals")
    .withIndex("by_organization_role", (index) =>
      index
        .eq("organizationId", request.organizationId)
        .eq("role", "administrator")
    )
    .collect()
  return Promise.all(
    administrators.map((recipient) =>
      enqueueNotificationWithResult(ctx, request, recipient, type, now, context)
    )
  )
}

async function suppressNotifications(
  ctx: MutationCtx,
  notifications: Array<Doc<"notifications">>,
  now: number,
  reasonCode: "STALE_GUEST_GRANT" | "RESOLVED_GUEST_UPLOAD"
) {
  await Promise.all(
    notifications
      .filter((notification) => !notification.suppressedAt)
      .map(async (notification) => {
        await ctx.db.patch(notification._id, { suppressedAt: now })
        const deliveries = await ctx.db
          .query("notificationEmailOutbox")
          .withIndex("by_notification", (index) =>
            index.eq("notificationId", notification._id)
          )
          .collect()
        await Promise.all(
          deliveries
            .filter(
              (delivery) =>
                delivery.status !== "sent" &&
                delivery.status !== "exhausted" &&
                !delivery.sendCommittedAt
            )
            .map((delivery) =>
              ctx.db.patch(delivery._id, {
                status: "exhausted",
                claimToken: undefined,
                leaseExpiresAt: undefined,
                sendCommittedAt: undefined,
                nextAttemptAt: undefined,
                updatedAt: now,
                lastErrorCode: reasonCode,
              })
            )
        )
      })
  )
}

export async function suppressGuestExpiryNotifications(
  ctx: MutationCtx,
  grantId: Doc<"guestAccessGrants">["_id"],
  now: number
) {
  const notifications = await ctx.db
    .query("notifications")
    .withIndex("by_grant_type", (index) =>
      index.eq("grantId", grantId).eq("type", "guest_expiry_approaching")
    )
    .collect()
  await suppressNotifications(ctx, notifications, now, "STALE_GUEST_GRANT")
}

export async function reactivateGuestExpiryNotifications(
  ctx: MutationCtx,
  grant: Doc<"guestAccessGrants">,
  now: number
) {
  if (
    grant.expiresAt <= now ||
    grant.expiresAt > now + guestExpiryNotificationThresholdMs()
  )
    return
  const currentDedupeKey = `guest-expiry:${grant._id}:${grant.tokenVersion}`
  const notifications = await ctx.db
    .query("notifications")
    .withIndex("by_grant_type", (index) =>
      index.eq("grantId", grant._id).eq("type", "guest_expiry_approaching")
    )
    .collect()
  for (const notification of notifications.filter(
    (candidate) =>
      candidate.suppressedAt && candidate.dedupeKey === currentDedupeKey
  )) {
    await ctx.db.patch(notification._id, { suppressedAt: undefined })
    const deliveries = await ctx.db
      .query("notificationEmailOutbox")
      .withIndex("by_notification", (index) =>
        index.eq("notificationId", notification._id)
      )
      .collect()
    for (const delivery of deliveries) {
      if (
        delivery.status !== "exhausted" ||
        delivery.lastErrorCode !== "STALE_GUEST_GRANT"
      )
        continue
      await ctx.db.patch(delivery._id, {
        status: "queued",
        attempts: 0,
        claimToken: undefined,
        leaseExpiresAt: undefined,
        sendCommittedAt: undefined,
        nextAttemptAt: now,
        updatedAt: now,
        lastErrorCode: undefined,
      })
      await ctx.scheduler.runAfter(0, internal.notifications.dispatchEmail, {
        deliveryId: delivery._id,
      })
    }
  }
}

export async function suppressGuestUploadFailureNotifications(
  ctx: MutationCtx,
  assetId: Doc<"responseAssets">["_id"],
  now: number
) {
  const notifications = await ctx.db
    .query("notifications")
    .withIndex("by_asset_type", (index) =>
      index.eq("assetId", assetId).eq("type", "guest_upload_failed")
    )
    .collect()
  await suppressNotifications(ctx, notifications, now, "RESOLVED_GUEST_UPLOAD")
}
