import { ConvexError, v } from "convex/values"

import { internal } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server"
import {
  enqueueAdministratorNotifications,
  guestExpiryNotificationThresholdMs,
} from "./lib/notificationOutbox"
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"

const GUEST_EXPIRY_NOTIFICATION_SYSTEM_SUBJECT =
  "system:guest-expiry-notifications"
const GUEST_EXPIRY_NOTIFICATION_AUDIT_OPERATION =
  "notification.guest_expiry_approaching"

async function guestExpiryNotificationSystemActor(
  ctx: MutationCtx,
  organizationId: string,
  now: number
) {
  const existing = await ctx.db
    .query("principals")
    .withIndex("by_organization_subject", (index) =>
      index
        .eq("organizationId", organizationId)
        .eq("subject", GUEST_EXPIRY_NOTIFICATION_SYSTEM_SUBJECT)
    )
    .unique()
  if (existing) {
    if (existing.kind !== "system")
      throw new ConvexError({ code: "SYSTEM_PRINCIPAL_CONFLICT" })
    return existing
  }
  const principalId = await ctx.db.insert("principals", {
    subject: GUEST_EXPIRY_NOTIFICATION_SYSTEM_SUBJECT,
    organizationId,
    role: "agent_editor",
    kind: "system",
    updatedAt: now,
  })
  const principal = await ctx.db.get(principalId)
  if (!principal) throw new ConvexError({ code: "WRITE_FAILED" })
  return principal
}

async function auditGuestExpiryNotification(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  grant: Doc<"guestAccessGrants">,
  now: number
) {
  const correlationId = `guest-expiry:${grant._id}:${grant.tokenVersion}`
  const existing = await ctx.db
    .query("auditEvents")
    .withIndex("by_request_operation_correlation", (index) =>
      index
        .eq("requestId", request._id)
        .eq("operation", GUEST_EXPIRY_NOTIFICATION_AUDIT_OPERATION)
        .eq("correlationId", correlationId)
    )
    .unique()
  if (existing) return
  const actor = await guestExpiryNotificationSystemActor(
    ctx,
    request.organizationId,
    now
  )
  await ctx.db.insert("auditEvents", {
    organizationId: request.organizationId,
    requestId: request._id,
    requestHumanId: request.humanId,
    actorPrincipalId: actor._id,
    credentialId: GUEST_EXPIRY_NOTIFICATION_SYSTEM_SUBJECT,
    operation: GUEST_EXPIRY_NOTIFICATION_AUDIT_OPERATION,
    correlationId,
    occurredAt: now,
    afterVersion: request.aggregateVersion,
    inputFingerprint: correlationId,
  })
}

export const scheduleGuestExpiryNotifications = internalMutation({
  args: {
    now: v.optional(v.number()),
    state: v.optional(
      v.union(
        v.literal("generated"),
        v.literal("opened"),
        v.literal("in_progress")
      )
    ),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    state: v.union(
      v.literal("generated"),
      v.literal("opened"),
      v.literal("in_progress")
    ),
    pageCreatedCount: v.number(),
    pageDone: v.boolean(),
    continuation: v.union(
      v.object({
        state: v.union(
          v.literal("generated"),
          v.literal("opened"),
          v.literal("in_progress")
        ),
        cursor: v.union(v.string(), v.null()),
      }),
      v.null()
    ),
  }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now()
    const thresholdEnd = now + guestExpiryNotificationThresholdMs()
    const unfinishedStates = ["generated", "opened", "in_progress"] as const
    const state = args.state ?? unfinishedStates[0]
    const grants = await ctx.db
      .query("guestAccessGrants")
      .withIndex("by_state_expiry", (index) =>
        index
          .eq("state", state)
          .gt("expiresAt", now)
          .lte("expiresAt", thresholdEnd)
      )
      .paginate({ cursor: args.cursor ?? null, numItems: 100 })
    let createdCount = 0
    for (const candidate of grants.page) {
      const grant = await ctx.db.get(candidate._id)
      if (
        !grant ||
        !unfinishedStates.includes(
          grant.state as (typeof unfinishedStates)[number]
        ) ||
        grant.expiresAt <= now ||
        grant.expiresAt > thresholdEnd ||
        grant.revokedAt
      )
        continue
      const [request, workspace] = await Promise.all([
        ctx.db.get(grant.requestId),
        ctx.db
          .query("responseWorkspaces")
          .withIndex("by_grant", (index) => index.eq("grantId", grant._id))
          .unique(),
      ])
      if (
        !request ||
        request.organizationId !== grant.organizationId ||
        workspace?.lockedAt
      )
        continue
      const notificationResults = await enqueueAdministratorNotifications(
        ctx,
        request,
        "guest_expiry_approaching",
        now,
        {
          dedupeKey: `guest-expiry:${grant._id}:${grant.tokenVersion}`,
          grantId: grant._id,
        }
      )
      const candidateCreatedCount = notificationResults.filter(
        ({ created }) => created
      ).length
      if (candidateCreatedCount > 0)
        await auditGuestExpiryNotification(ctx, request, grant, now)
      createdCount += candidateCreatedCount
    }
    const stateIndex = unfinishedStates.indexOf(state)
    const nextState = unfinishedStates[stateIndex + 1]
    const continuation = !grants.isDone
      ? { state, cursor: grants.continueCursor }
      : nextState
        ? { state: nextState, cursor: null }
        : null
    if (!grants.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.scheduleGuestExpiryNotifications,
        {
          now,
          state,
          cursor: grants.continueCursor,
        }
      )
    } else {
      if (nextState) {
        await ctx.scheduler.runAfter(
          0,
          internal.notifications.scheduleGuestExpiryNotifications,
          {
            now,
            state: nextState,
          }
        )
      }
    }
    return {
      state,
      pageCreatedCount: createdCount,
      pageDone: grants.isDone,
      continuation,
    }
  },
})

export const getEmailDelivery = internalQuery({
  args: { deliveryId: v.id("notificationEmailOutbox") },
  returns: v.union(
    v.object({
      deliveryId: v.id("notificationEmailOutbox"),
      recipientEmail: v.string(),
      template: v.string(),
      deepLink: v.string(),
      status: v.union(
        v.literal("queued"),
        v.literal("sending"),
        v.literal("sent"),
        v.literal("failed"),
        v.literal("exhausted")
      ),
      attempts: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId)
    return delivery
      ? {
          deliveryId: delivery._id,
          recipientEmail: delivery.recipientEmail,
          template: delivery.template,
          deepLink: delivery.deepLink,
          status: delivery.status,
          attempts: delivery.attempts,
        }
      : null
  },
})

export const claimEmailDelivery = internalMutation({
  args: {
    deliveryId: v.id("notificationEmailOutbox"),
    claimToken: v.string(),
  },
  returns: v.union(
    v.object({
      deliveryId: v.id("notificationEmailOutbox"),
      claimToken: v.string(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId)
    const now = Date.now()
    if (
      !delivery ||
      delivery.status === "sent" ||
      delivery.status === "exhausted"
    )
      return null
    if (
      (delivery.status !== "sending" && (delivery.nextAttemptAt ?? 0) > now) ||
      (delivery.status === "sending" &&
        (delivery.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) > now)
    ) {
      return null
    }
    if (delivery.attempts >= 5) {
      const committedButUnconfirmed = Boolean(delivery.sendCommittedAt)
      await ctx.db.patch(delivery._id, {
        status: committedButUnconfirmed ? "failed" : "exhausted",
        claimToken: undefined,
        leaseExpiresAt: undefined,
        nextAttemptAt: undefined,
        updatedAt: now,
        lastErrorCode: committedButUnconfirmed
          ? "EMAIL_DELIVERY_AMBIGUOUS"
          : "EMAIL_ATTEMPTS_EXHAUSTED",
      })
      await ctx.db.patch(delivery.notificationId, { emailStatus: "failed" })
      return null
    }
    const notification = await ctx.db.get(delivery.notificationId)
    if (notification?.suppressedAt && !delivery.sendCommittedAt) {
      await ctx.db.patch(delivery._id, {
        status: "exhausted",
        claimToken: undefined,
        leaseExpiresAt: undefined,
        sendCommittedAt: undefined,
        nextAttemptAt: undefined,
        updatedAt: now,
        lastErrorCode:
          notification.type === "guest_upload_failed"
            ? "RESOLVED_GUEST_UPLOAD"
            : "STALE_GUEST_GRANT",
      })
      return null
    }
    await ctx.db.patch(delivery._id, {
      status: "sending",
      attempts: delivery.attempts + 1,
      leaseExpiresAt: now + 60_000,
      claimToken: args.claimToken,
      sendCommittedAt: delivery.sendCommittedAt,
      updatedAt: now,
      lastErrorCode: undefined,
    })
    return {
      deliveryId: delivery._id,
      claimToken: args.claimToken,
    }
  },
})

export const commitEmailDelivery = internalMutation({
  args: {
    deliveryId: v.id("notificationEmailOutbox"),
    claimToken: v.string(),
  },
  returns: v.union(
    v.object({
      deliveryId: v.id("notificationEmailOutbox"),
      recipientEmail: v.string(),
      template: v.string(),
      deepLink: v.string(),
      claimToken: v.string(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId)
    if (
      !delivery ||
      delivery.status !== "sending" ||
      delivery.claimToken !== args.claimToken
    )
      return null
    if (delivery.sendCommittedAt) {
      return {
        deliveryId: delivery._id,
        recipientEmail: delivery.recipientEmail,
        template: delivery.template,
        deepLink: delivery.deepLink,
        claimToken: args.claimToken,
      }
    }
    const notification = await ctx.db.get(delivery.notificationId)
    const now = Date.now()
    if (notification?.suppressedAt) {
      await ctx.db.patch(delivery._id, {
        status: "exhausted",
        claimToken: undefined,
        leaseExpiresAt: undefined,
        sendCommittedAt: undefined,
        nextAttemptAt: undefined,
        updatedAt: now,
        lastErrorCode:
          notification.type === "guest_upload_failed"
            ? "RESOLVED_GUEST_UPLOAD"
            : "STALE_GUEST_GRANT",
      })
      return null
    }
    await ctx.db.patch(delivery._id, { sendCommittedAt: now, updatedAt: now })
    return {
      deliveryId: delivery._id,
      recipientEmail: delivery.recipientEmail,
      template: delivery.template,
      deepLink: delivery.deepLink,
      claimToken: args.claimToken,
    }
  },
})

export const finishEmailDelivery = internalMutation({
  args: {
    deliveryId: v.id("notificationEmailOutbox"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    claimToken: v.string(),
    errorCode: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId)
    if (
      !delivery ||
      delivery.status === "sent" ||
      delivery.claimToken !== args.claimToken
    ) {
      return null
    }
    const now = Date.now()
    const notification = await ctx.db.get(delivery.notificationId)
    const suppressedFailure =
      args.status === "failed" && notification?.suppressedAt
    const finalStatus =
      suppressedFailure || (args.status === "failed" && delivery.attempts >= 5)
        ? "exhausted"
        : args.status
    await ctx.db.patch(delivery._id, {
      status: finalStatus,
      leaseExpiresAt: undefined,
      claimToken: undefined,
      sendCommittedAt:
        finalStatus === "sent" ? delivery.sendCommittedAt : undefined,
      nextAttemptAt:
        finalStatus === "failed"
          ? now + Math.min(15 * 60_000, 30_000 * 2 ** (delivery.attempts - 1))
          : undefined,
      updatedAt: now,
      lastErrorCode: suppressedFailure
        ? notification.type === "guest_upload_failed"
          ? "RESOLVED_GUEST_UPLOAD"
          : "STALE_GUEST_GRANT"
        : args.errorCode,
    })
    await ctx.db.patch(delivery.notificationId, { emailStatus: args.status })
    if (notification?.type === "founder_handoff")
      await refreshOperatorWorkspaceProjection(ctx, notification.requestId)
    return null
  },
})

export const dispatchEmail = internalAction({
  args: { deliveryId: v.id("notificationEmailOutbox") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const delivery = await ctx.runMutation(
      internal.notifications.claimEmailDelivery,
      {
        deliveryId: args.deliveryId,
        claimToken: crypto.randomUUID(),
      }
    )
    if (!delivery) return null
    const committedDelivery = await ctx.runMutation(
      internal.notifications.commitEmailDelivery,
      {
        deliveryId: args.deliveryId,
        claimToken: delivery.claimToken,
      }
    )
    if (!committedDelivery) return null
    const endpoint = process.env.FAIRLEND_TRANSACTIONAL_EMAIL_ENDPOINT
    const apiKey = process.env.FAIRLEND_TRANSACTIONAL_EMAIL_API_KEY
    if (!endpoint || !apiKey) {
      await ctx.runMutation(internal.notifications.finishEmailDelivery, {
        deliveryId: args.deliveryId,
        status: "failed",
        claimToken: committedDelivery.claimToken,
        errorCode: "EMAIL_PROVIDER_NOT_CONFIGURED",
      })
      return null
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `notification-email:${committedDelivery.deliveryId}`,
        },
        body: JSON.stringify({
          to: committedDelivery.recipientEmail,
          template: committedDelivery.template,
          deepLink: committedDelivery.deepLink,
          idempotencyKey: `notification-email:${committedDelivery.deliveryId}`,
        }),
      })
      await ctx.runMutation(internal.notifications.finishEmailDelivery, {
        deliveryId: args.deliveryId,
        status: response.ok ? "sent" : "failed",
        claimToken: committedDelivery.claimToken,
        errorCode: response.ok ? undefined : `EMAIL_HTTP_${response.status}`,
      })
    } catch {
      await ctx.runMutation(internal.notifications.finishEmailDelivery, {
        deliveryId: args.deliveryId,
        status: "failed",
        claimToken: committedDelivery.claimToken,
        errorCode: "EMAIL_TRANSPORT_FAILED",
      })
    }
    return null
  },
})

export const listRetryableEmailDeliveries = internalQuery({
  args: {},
  returns: v.array(v.id("notificationEmailOutbox")),
  handler: async (ctx) => {
    const now = Date.now()
    const [queued, failed, leaseExpired] = await Promise.all([
      ctx.db
        .query("notificationEmailOutbox")
        .withIndex("by_status_next_attempt", (index) =>
          index.eq("status", "queued").lte("nextAttemptAt", now)
        )
        .take(9),
      ctx.db
        .query("notificationEmailOutbox")
        .withIndex("by_status_next_attempt", (index) =>
          index.eq("status", "failed").lte("nextAttemptAt", now)
        )
        .take(8),
      ctx.db
        .query("notificationEmailOutbox")
        .withIndex("by_status_lease_expiry", (index) =>
          index.eq("status", "sending").lte("leaseExpiresAt", now)
        )
        .take(8),
    ])
    return [...queued, ...failed, ...leaseExpired]
      .slice(0, 25)
      .map((delivery) => delivery._id)
  },
})

export const reapEmailDeliveries = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const deliveryIds = await ctx.runQuery(
      internal.notifications.listRetryableEmailDeliveries,
      {}
    )
    await Promise.all(
      deliveryIds.map((deliveryId) =>
        ctx.runAction(internal.notifications.dispatchEmail, { deliveryId })
      )
    )
    return null
  },
})
