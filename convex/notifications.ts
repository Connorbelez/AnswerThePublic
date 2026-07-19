import { v } from "convex/values"

import { internal } from "./_generated/api"
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server"

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
      recipientEmail: v.string(),
      template: v.string(),
      deepLink: v.string(),
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
      delivery.attempts >= 5 ||
      (delivery.status !== "sending" && (delivery.nextAttemptAt ?? 0) > now) ||
      (delivery.status === "sending" &&
        (delivery.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) > now)
    ) {
      return null
    }
    await ctx.db.patch(delivery._id, {
      status: "sending",
      attempts: delivery.attempts + 1,
      leaseExpiresAt: now + 60_000,
      claimToken: args.claimToken,
      updatedAt: now,
      lastErrorCode: undefined,
    })
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
    const finalStatus =
      args.status === "failed" && delivery.attempts >= 5
        ? "exhausted"
        : args.status
    await ctx.db.patch(delivery._id, {
      status: finalStatus,
      leaseExpiresAt: undefined,
      claimToken: undefined,
      nextAttemptAt:
        finalStatus === "failed"
          ? now + Math.min(15 * 60_000, 30_000 * 2 ** (delivery.attempts - 1))
          : undefined,
      updatedAt: now,
      lastErrorCode: args.errorCode,
    })
    await ctx.db.patch(delivery.notificationId, { emailStatus: args.status })
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
    const endpoint = process.env.FAIRLEND_TRANSACTIONAL_EMAIL_ENDPOINT
    const apiKey = process.env.FAIRLEND_TRANSACTIONAL_EMAIL_API_KEY
    if (!endpoint || !apiKey) {
      await ctx.runMutation(internal.notifications.finishEmailDelivery, {
        deliveryId: args.deliveryId,
        status: "failed",
        claimToken: delivery.claimToken,
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
          "idempotency-key": `notification-email:${delivery.deliveryId}`,
        },
        body: JSON.stringify({
          to: delivery.recipientEmail,
          template: delivery.template,
          deepLink: delivery.deepLink,
          idempotencyKey: `notification-email:${delivery.deliveryId}`,
        }),
      })
      await ctx.runMutation(internal.notifications.finishEmailDelivery, {
        deliveryId: args.deliveryId,
        status: response.ok ? "sent" : "failed",
        claimToken: delivery.claimToken,
        errorCode: response.ok ? undefined : `EMAIL_HTTP_${response.status}`,
      })
    } catch {
      await ctx.runMutation(internal.notifications.finishEmailDelivery, {
        deliveryId: args.deliveryId,
        status: "failed",
        claimToken: delivery.claimToken,
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
        .take(25),
      ctx.db
        .query("notificationEmailOutbox")
        .withIndex("by_status_next_attempt", (index) =>
          index.eq("status", "failed").lte("nextAttemptAt", now)
        )
        .take(25),
      ctx.db
        .query("notificationEmailOutbox")
        .withIndex("by_status_lease_expiry", (index) =>
          index.eq("status", "sending").lte("leaseExpiresAt", now)
        )
        .take(25),
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
