import { ConvexError, v } from "convex/values"

import type { Doc } from "./_generated/dataModel"
import { mutation } from "./_generated/server"
import { requireEditor, requirePrincipal } from "./lib/authorization"

const MAX_ACTIVE_SHARES_PER_REQUEST = 50
const MAX_SHARE_SNAPSHOT_BYTES = 500_000
const PUBLIC_CONTEXT_KINDS = new Set([
  "source_summary",
  "talking_points",
  "research_requirements",
  "missing_research",
  "citations",
])

const citation = v.object({
  label: v.string(),
  url: v.string(),
  supports: v.string(),
})

const shareSummary = v.object({
  shareId: v.id("publicShares"),
  expiresAt: v.union(v.number(), v.null()),
  revokedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  briefSectionCount: v.number(),
  deliverableCount: v.number(),
})

const publicView = v.object({
  shareId: v.id("publicShares"),
  request: v.object({
    humanId: v.string(),
    title: v.string(),
    priority: v.string(),
    createdAt: v.number(),
  }),
  briefSections: v.array(
    v.object({
      kind: v.string(),
      title: v.string(),
      bulletPoints: v.array(v.string()),
      citations: v.array(citation),
    })
  ),
  deliverables: v.array(
    v.object({ kind: v.string(), name: v.string(), body: v.string() })
  ),
  expiresAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
})

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

async function tokenFor(
  organizationId: string,
  actorPrincipalId: string,
  correlationId: string
) {
  const secret = process.env.PUBLIC_SHARE_TOKEN_SECRET
  if (!secret || secret.length < 32)
    throw new ConvexError({ code: "PUBLIC_SHARE_SECRET_NOT_CONFIGURED" })
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `${organizationId}:${actorPrincipalId}:${correlationId}`
    )
  )
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

function summary(share: Doc<"publicShares">) {
  return {
    shareId: share._id,
    expiresAt: share.expiresAt ?? null,
    revokedAt: share.revokedAt ?? null,
    createdAt: share.createdAt,
    briefSectionCount: share.briefSections.length,
    deliverableCount: share.deliverables.length,
  }
}

export const list = mutation({
  args: { humanId: v.string() },
  returns: v.array(shareSummary),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", args.humanId.trim().toUpperCase())
      )
      .unique()
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const shares = await ctx.db
      .query("publicShares")
      .withIndex("by_request_active_created_at", (index) =>
        index.eq("requestId", request._id).eq("active", true)
      )
      .order("desc")
      .take(50)
    const now = Date.now()
    const current = []
    for (const share of shares) {
      if (share.expiresAt !== undefined && share.expiresAt <= now) {
        await ctx.db.patch(share._id, { active: false, updatedAt: now })
        continue
      }
      current.push(share)
    }
    return current.map(summary)
  },
})

export const create = mutation({
  args: {
    humanId: v.string(),
    contextItemIds: v.array(v.id("contextItems")),
    deliverableIds: v.array(v.id("deliverables")),
    expiresAt: v.optional(v.number()),
    correlationId: v.string(),
  },
  returns: v.object({ share: shareSummary, token: v.string() }),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", args.humanId.trim().toUpperCase())
      )
      .unique()
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const correlationId = args.correlationId.trim()
    if (!correlationId || correlationId.length > 200)
      throw new ConvexError({ code: "VALIDATION_FAILED" })
    const inputFingerprint = JSON.stringify({
      requestId: request._id,
      contextItemIds: args.contextItemIds,
      deliverableIds: args.deliverableIds,
      expiresAt: args.expiresAt ?? null,
    })
    const prior = await ctx.db
      .query("publicShareOperations")
      .withIndex("by_organization_actor_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (prior) {
      if (prior.inputFingerprint !== inputFingerprint)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      const share = await ctx.db.get(prior.shareId)
      if (!share) throw new ConvexError({ code: "NOT_FOUND" })
      const replayToken = await tokenFor(
        principal.organizationId,
        principal._id,
        correlationId
      )
      if ((await sha256(replayToken)) !== share.tokenHash)
        throw new ConvexError({ code: "PUBLIC_SHARE_SECRET_ROTATED" })
      return {
        share: summary(share),
        token: replayToken,
      }
    }
    if (args.contextItemIds.length + args.deliverableIds.length === 0)
      throw new ConvexError({ code: "SHARE_SELECTION_REQUIRED" })
    if (args.contextItemIds.length > 50 || args.deliverableIds.length > 50)
      throw new ConvexError({ code: "VALIDATION_FAILED" })
    const now = Date.now()
    if (
      args.expiresAt !== undefined &&
      (!Number.isSafeInteger(args.expiresAt) ||
        !Number.isFinite(new Date(args.expiresAt).getTime()) ||
        args.expiresAt <= now)
    )
      throw new ConvexError({ code: "INVALID_SHARE_EXPIRY" })
    const indexedShares = await ctx.db
      .query("publicShares")
      .withIndex("by_request_active_created_at", (index) =>
        index.eq("requestId", request._id).eq("active", true)
      )
      .take(MAX_ACTIVE_SHARES_PER_REQUEST)
    let activeShareCount = 0
    for (const share of indexedShares) {
      if (share.expiresAt !== undefined && share.expiresAt <= now)
        await ctx.db.patch(share._id, { active: false, updatedAt: now })
      else activeShareCount += 1
    }
    if (activeShareCount >= MAX_ACTIVE_SHARES_PER_REQUEST)
      throw new ConvexError({
        code: "ACTIVE_SHARE_LIMIT_REACHED",
        limit: MAX_ACTIVE_SHARES_PER_REQUEST,
      })
    const contexts = await Promise.all(
      args.contextItemIds.map((id) => ctx.db.get(id))
    )
    const deliverables = await Promise.all(
      args.deliverableIds.map((id) => ctx.db.get(id))
    )
    if (contexts.some((item) => !item || item.requestId !== request._id))
      throw new ConvexError({ code: "NOT_FOUND" })
    if (contexts.some((item) => !PUBLIC_CONTEXT_KINDS.has(item!.kind)))
      throw new ConvexError({ code: "PRIVATE_CONTEXT_NOT_SHAREABLE" })
    if (
      deliverables.some(
        (item) =>
          !item || item.requestId !== request._id || !item.promotedVersionId
      )
    )
      throw new ConvexError({ code: "PROMOTED_VERSION_REQUIRED" })
    const promoted = await Promise.all(
      deliverables.map((item) => ctx.db.get(item!.promotedVersionId!))
    )
    if (
      promoted.some(
        (version, index) =>
          !version || version.deliverableId !== deliverables[index]!._id
      )
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    const requestSnapshot = {
      humanId: request.humanId,
      title: request.title,
      priority: request.priority,
      createdAt: request.createdAt,
    }
    const briefSections = contexts.map((item) => ({
      contextItemId: item!._id,
      kind: item!.kind,
      title: item!.title,
      bulletPoints: item!.bulletPoints,
      citations: item!.citations,
    }))
    const publicDeliverables = deliverables.map((item, index) => ({
      deliverableId: item!._id,
      versionId: promoted[index]!._id,
      kind: item!.kind,
      name: item!.name,
      body: promoted[index]!.body,
    }))
    const snapshotBytes = new TextEncoder().encode(
      JSON.stringify({ requestSnapshot, briefSections, publicDeliverables })
    ).byteLength
    if (snapshotBytes > MAX_SHARE_SNAPSHOT_BYTES)
      throw new ConvexError({
        code: "SHARE_SNAPSHOT_TOO_LARGE",
        maxBytes: MAX_SHARE_SNAPSHOT_BYTES,
        actualBytes: snapshotBytes,
      })
    const token = await tokenFor(
      principal.organizationId,
      principal._id,
      correlationId
    )
    const shareId = await ctx.db.insert("publicShares", {
      organizationId: principal.organizationId,
      requestId: request._id,
      tokenHash: await sha256(token),
      requestSnapshot,
      briefSections,
      deliverables: publicDeliverables,
      expiresAt: args.expiresAt,
      active: true,
      createdByPrincipalId: principal._id,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert("publicShareOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      correlationId,
      inputFingerprint,
      shareId,
      createdAt: now,
    })
    const afterVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "public_share.created",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion,
    })
    const share = await ctx.db.get(shareId)
    if (!share) throw new ConvexError({ code: "WRITE_FAILED" })
    return { share: summary(share), token }
  },
})

export const revoke = mutation({
  args: { shareId: v.id("publicShares"), correlationId: v.string() },
  returns: shareSummary,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const share = await ctx.db.get(args.shareId)
    if (!share || share.organizationId !== principal.organizationId)
      throw new ConvexError({ code: "NOT_FOUND" })
    if (share.revokedAt) return summary(share)
    const request = await ctx.db.get(share.requestId)
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const now = Date.now()
    await ctx.db.patch(share._id, {
      active: false,
      revokedAt: now,
      updatedAt: now,
    })
    const afterVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "public_share.revoked",
      correlationId: args.correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion,
    })
    return summary((await ctx.db.get(share._id))!)
  },
})

export const view = mutation({
  args: { token: v.string() },
  returns: v.union(publicView, v.null()),
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{64}$/.test(args.token)) return null
    const tokenHash = await sha256(args.token)
    const share = await ctx.db
      .query("publicShares")
      .withIndex("by_token_hash", (index) => index.eq("tokenHash", tokenHash))
      .unique()
    const now = Date.now()
    if (
      !share ||
      !share.active ||
      share.revokedAt ||
      (share.expiresAt !== undefined && share.expiresAt <= now)
    ) {
      if (
        share?.active &&
        share.expiresAt !== undefined &&
        share.expiresAt <= now
      )
        await ctx.db.patch(share._id, { active: false, updatedAt: now })
      return null
    }
    const hourBucket = Math.floor(now / 3_600_000)
    const access = await ctx.db
      .query("publicShareAccesses")
      .withIndex("by_share_hour_bucket", (index) =>
        index.eq("shareId", share._id).eq("hourBucket", hourBucket)
      )
      .unique()
    if (!access)
      await ctx.db.insert("publicShareAccesses", {
        shareId: share._id,
        hourBucket,
        count: 1,
        firstAccessedAt: now,
        lastAccessedAt: now,
      })
    return {
      shareId: share._id,
      request: share.requestSnapshot,
      briefSections: share.briefSections.map(
        ({ kind, title, bulletPoints, citations }) => ({
          kind,
          title,
          bulletPoints,
          citations,
        })
      ),
      deliverables: share.deliverables.map(({ kind, name, body }) => ({
        kind,
        name,
        body,
      })),
      expiresAt: share.expiresAt ?? null,
      createdAt: share.createdAt,
    }
  },
})
