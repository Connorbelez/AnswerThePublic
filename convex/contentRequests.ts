import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  requireActiveRequest,
  requireEditor,
  requirePrincipal,
} from "./lib/authorization"
import { contentRequestCreationDefaults } from "./lib/contentRequestDefaults"
import { enqueueNotification } from "./lib/notificationOutbox"
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"
import { requestQueueSortKey } from "./lib/requestOrdering"
import {
  requestDispositionValidator,
  requestLifecycleValidator,
  requestOriginValidator,
  requestPriorityValidator,
  requestRetentionValidator,
  workspaceRoleValidator,
} from "./schema"
import { normalizeSourceUrl } from "../shared/url-normalization"

const sourceInputValidator = v.object({
  question: v.optional(v.string()),
  body: v.optional(v.string()),
  url: v.optional(v.string()),
  name: v.optional(v.string()),
  channel: v.optional(v.string()),
})

const sourceOutputValidator = v.union(sourceInputValidator, v.null())

const principalSummaryValidator = v.object({
  principalId: v.id("principals"),
  subject: v.string(),
  role: workspaceRoleValidator,
})

const explicitRequestOriginValidator = v.union(
  v.literal("manual"),
  v.literal("chatgpt_app"),
  v.literal("cli"),
  v.literal("http_api")
)

export const contentRequestValidator = v.object({
  requestId: v.id("contentRequests"),
  humanId: v.string(),
  title: v.string(),
  aliases: v.array(v.string()),
  origin: requestOriginValidator,
  priority: requestPriorityValidator,
  timingLabel: v.union(v.string(), v.null()),
  lifecycle: requestLifecycleValidator,
  disposition: requestDispositionValidator,
  retention: requestRetentionValidator,
  retentionTransition: v.union(
    v.literal("archiving"),
    v.literal("restoring"),
    v.null()
  ),
  expiresAt: v.union(v.number(), v.null()),
  expiredAt: v.union(v.number(), v.null()),
  expirationReason: v.union(v.string(), v.null()),
  expirationReviewRequiredAt: v.union(v.number(), v.null()),
  archivedAt: v.union(v.number(), v.null()),
  parentRequestHumanId: v.union(v.string(), v.null()),
  aggregateVersion: v.number(),
  assignee: principalSummaryValidator,
  watchers: v.array(principalSummaryValidator),
  firstOpenedAt: v.union(v.number(), v.null()),
  latestOpenedAt: v.union(v.number(), v.null()),
  hasFounderDraft: v.boolean(),
  founderDraftUpdatedAt: v.union(v.number(), v.null()),
  source: sourceOutputValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
})

const requestCandidateValidator = v.object({
  requestId: v.id("contentRequests"),
  humanId: v.string(),
  title: v.string(),
  origin: requestOriginValidator,
  priority: requestPriorityValidator,
  lifecycle: requestLifecycleValidator,
  score: v.number(),
})

const resolutionValidator = v.union(
  v.object({
    kind: v.literal("resolved"),
    matchedBy: v.union(v.literal("exact_id"), v.literal("exact_title")),
    request: contentRequestValidator,
  }),
  v.object({
    kind: v.literal("candidates"),
    candidates: v.array(requestCandidateValidator),
  }),
  v.object({ kind: v.literal("not_found"), candidates: v.array(v.any()) })
)

const auditEventValidator = v.object({
  eventId: v.id("auditEvents"),
  operation: v.string(),
  correlationId: v.string(),
  requestHumanId: v.string(),
  actorPrincipalId: v.id("principals"),
  credentialId: v.string(),
  occurredAt: v.number(),
  beforeVersion: v.union(v.number(), v.null()),
  afterVersion: v.number(),
})

const assignmentEventValidator = v.object({
  eventId: v.id("assignmentEvents"),
  previousAssigneePrincipalId: v.id("principals"),
  newAssigneePrincipalId: v.id("principals"),
  watcherPrincipalIds: v.array(v.id("principals")),
  actorPrincipalId: v.id("principals"),
  credentialId: v.string(),
  reason: v.union(v.string(), v.null()),
  correlationId: v.string(),
  occurredAt: v.number(),
})

const notificationValidator = v.object({
  notificationId: v.id("notifications"),
  requestHumanId: v.string(),
  type: v.union(
    v.literal("request_assigned"),
    v.literal("critical_escalation"),
    v.literal("deadline_approaching"),
    v.literal("response_ready"),
    v.literal("drafting_failed"),
    v.literal("delivery_reopened")
  ),
  emailQueued: v.boolean(),
  emailStatus: v.union(
    v.literal("queued"),
    v.literal("sent"),
    v.literal("failed")
  ),
  createdAt: v.number(),
  readAt: v.union(v.number(), v.null()),
  deepLink: v.string(),
})

type RequestContext = QueryCtx | MutationCtx

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase("en-CA").replace(/\s+/g, " ")
}

function cleanRequiredText(value: string, field: string) {
  const cleaned = value.trim()
  if (!cleaned) {
    throw new ConvexError({ code: "VALIDATION_FAILED", field })
  }
  return cleaned
}

function cleanOptionalText(value: string | undefined) {
  const cleaned = value?.trim()
  return cleaned ? cleaned : undefined
}

function publicSource(snapshot: Doc<"sourceSnapshots"> | null) {
  if (!snapshot) return null
  return {
    question: snapshot.question,
    body: snapshot.body,
    url: snapshot.url,
    name: snapshot.name,
    channel: snapshot.channel,
  }
}

export async function toPublicRequest(
  ctx: RequestContext,
  request: Doc<"contentRequests">
) {
  const source = request.sourceSnapshotId
    ? await ctx.db.get(request.sourceSnapshotId)
    : null
  const assignee = await ctx.db.get(
    request.assigneePrincipalId ?? request.createdByPrincipalId
  )
  if (!assignee) throw new ConvexError({ code: "ASSIGNEE_NOT_FOUND" })
  const watchers = await Promise.all(
    (request.watcherPrincipalIds ?? []).map((principalId) =>
      ctx.db.get(principalId)
    )
  )
  const founderInput = await ctx.db
    .query("founderInputDocuments")
    .withIndex("by_request", (index) => index.eq("requestId", request._id))
    .unique()
  const parentRequest = request.parentRequestId
    ? await ctx.db.get(request.parentRequestId)
    : null
  const retentionTransition: "archiving" | "restoring" | null =
    request.archiveTransitionMode === "archive"
      ? "archiving"
      : request.archiveTransitionMode === "restore"
        ? "restoring"
        : null
  return {
    requestId: request._id,
    humanId: request.humanId,
    title: request.title,
    aliases: request.aliases,
    origin: request.origin,
    priority: request.priority,
    timingLabel: request.timingLabel ?? null,
    lifecycle: request.lifecycle,
    disposition: request.disposition,
    retention: request.retention,
    retentionTransition,
    expiresAt: request.expiresAt ?? null,
    expiredAt: request.expiredAt ?? null,
    expirationReason: request.expirationReason ?? null,
    expirationReviewRequiredAt: request.expirationReviewRequiredAt ?? null,
    archivedAt: request.archivedAt ?? null,
    parentRequestHumanId: parentRequest?.humanId ?? null,
    aggregateVersion: request.aggregateVersion,
    assignee: {
      principalId: assignee._id,
      subject: assignee.subject,
      role: assignee.role,
    },
    watchers: watchers.flatMap((watcher) =>
      watcher
        ? [
            {
              principalId: watcher._id,
              subject: watcher.subject,
              role: watcher.role,
            },
          ]
        : []
    ),
    firstOpenedAt: request.firstOpenedAt ?? null,
    latestOpenedAt: request.latestOpenedAt ?? null,
    hasFounderDraft: founderInput?.hasMeaningfulDraft ?? false,
    founderDraftUpdatedAt: founderInput?.updatedAt ?? null,
    source: publicSource(source),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  }
}

function humanIdFor(requestId: Id<"contentRequests">) {
  return `CR-${requestId.slice(0, 17).toUpperCase()}`
}

function fuzzyScore(
  request: Doc<"contentRequests">,
  source: Doc<"sourceSnapshots"> | null,
  input: string
) {
  const queryText = normalizeText(input)
  if (!queryText) return 0
  const searchable = normalizeText(
    [
      request.title,
      ...request.aliases,
      source?.question,
      source?.body,
      source?.url,
      source?.name,
      source?.channel,
    ]
      .filter(Boolean)
      .join(" ")
  )
  const tokens = queryText.split(" ")
  if (!tokens.every((token) => searchable.includes(token))) return 0
  let score = tokens.length * 20
  if (searchable.startsWith(queryText)) score += 25
  if (searchable.includes(queryText)) score += 15
  return score
}

function searchTextFor(
  title: string,
  aliases: Array<string>,
  source: typeof sourceInputValidator.type | undefined
) {
  return [
    title,
    ...aliases,
    source?.question,
    source?.body,
    source?.url,
    source?.name,
    source?.channel,
  ]
    .filter(Boolean)
    .join(" ")
}

export const createManual = mutation({
  args: {
    title: v.string(),
    origin: explicitRequestOriginValidator,
    source: v.optional(sourceInputValidator),
    aliases: v.optional(v.array(v.string())),
    correlationId: v.string(),
  },
  returns: contentRequestValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const title = cleanRequiredText(args.title, "title")
    const correlationId = cleanRequiredText(args.correlationId, "correlationId")
    const aliases = (args.aliases ?? [])
      .map((alias) => cleanOptionalText(alias))
      .filter((alias): alias is string => Boolean(alias))
    const inputFingerprint = JSON.stringify({
      title,
      origin: args.origin,
      aliases,
      source: args.source
        ? {
            question: args.source.question,
            body: args.source.body,
            url: args.source.url,
            name: args.source.name,
            channel: args.source.channel,
          }
        : null,
    })
    const priorEvents = await Promise.all(
      [
        "content_request.created",
        "content_request.upgraded_to_manual",
        "content_request.deduplicated",
      ].map((operation) =>
        ctx.db
          .query("auditEvents")
          .withIndex("by_organization_actor_operation_correlation", (index) =>
            index
              .eq("organizationId", principal.organizationId)
              .eq("actorPrincipalId", principal._id)
              .eq("operation", operation)
              .eq("correlationId", correlationId)
          )
          .unique()
      )
    )
    const priorEvent = priorEvents.find(Boolean)
    if (priorEvent) {
      if (priorEvent.inputFingerprint !== inputFingerprint) {
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      }
      const priorRequest = await ctx.db.get(priorEvent.requestId)
      if (!priorRequest) throw new ConvexError({ code: "WRITE_FAILED" })
      return toPublicRequest(ctx, priorRequest)
    }
    const now = Date.now()
    const normalizedSourceUrl = args.source?.url
      ? (normalizeSourceUrl(args.source.url) ?? undefined)
      : undefined
    const sourceMatches = normalizedSourceUrl
      ? await ctx.db
          .query("contentRequests")
          .withIndex("by_organization_normalized_source_url", (index) =>
            index
              .eq("organizationId", principal.organizationId)
              .eq("normalizedSourceUrl", normalizedSourceUrl)
          )
          .collect()
      : []
    if (sourceMatches.length > 1) {
      throw new ConvexError({
        code: "SOURCE_COLLISION_REQUIRES_REMEDIATION",
        normalizedSourceUrl,
        requestHumanIds: sourceMatches.map((request) => request.humanId),
      })
    }
    const existingExplicitRequest = sourceMatches.find(
      (request) => request.origin !== "automated_scout"
    )
    if (existingExplicitRequest) {
      requireActiveRequest(existingExplicitRequest)
      await ctx.db.insert("auditEvents", {
        organizationId: principal.organizationId,
        requestId: existingExplicitRequest._id,
        requestHumanId: existingExplicitRequest.humanId,
        actorPrincipalId: principal._id,
        credentialId: principal.credentialId,
        operation: "content_request.deduplicated",
        correlationId,
        occurredAt: now,
        beforeVersion: existingExplicitRequest.aggregateVersion,
        afterVersion: existingExplicitRequest.aggregateVersion,
        inputFingerprint,
      })
      return toPublicRequest(ctx, existingExplicitRequest)
    }
    const matchedAutomatedRequest = sourceMatches.find(
      (request) => request.origin === "automated_scout"
    )
    if (matchedAutomatedRequest) {
      requireActiveRequest(matchedAutomatedRequest)
      if (args.source) {
        await ctx.db.insert("sourceSnapshots", {
          organizationId: principal.organizationId,
          requestId: matchedAutomatedRequest._id,
          question: args.source.question,
          body: args.source.body,
          url: args.source.url,
          name: args.source.name,
          channel: args.source.channel,
          captureKind: "manual_supplemental",
          capturedByPrincipalId: principal._id,
          capturedAt: now,
        })
      }
      const nextVersion = matchedAutomatedRequest.aggregateVersion + 1
      await ctx.db.patch(matchedAutomatedRequest._id, {
        title,
        normalizedTitle: normalizeText(title),
        searchText: searchTextFor(title, aliases, args.source),
        aliases,
        origin: args.origin,
        priority: "critical",
        autoExpirationDueAt: undefined,
        expirationDispatchToken: undefined,
        expirationOriginalDueAt: undefined,
        expirationReviewRequiredAt: undefined,
        queueSortKey: requestQueueSortKey(
          args.origin,
          "critical",
          matchedAutomatedRequest.createdAt
        ),
        aggregateVersion: nextVersion,
        updatedAt: now,
      })
      await ctx.db.insert("auditEvents", {
        organizationId: principal.organizationId,
        requestId: matchedAutomatedRequest._id,
        requestHumanId: matchedAutomatedRequest.humanId,
        actorPrincipalId: principal._id,
        credentialId: principal.credentialId,
        operation: "content_request.upgraded_to_manual",
        correlationId,
        occurredAt: now,
        beforeVersion: matchedAutomatedRequest.aggregateVersion,
        afterVersion: nextVersion,
        inputFingerprint,
      })
      const upgraded = await ctx.db.get(matchedAutomatedRequest._id)
      if (!upgraded) throw new ConvexError({ code: "WRITE_FAILED" })
      const assignee = await ctx.db.get(
        upgraded.assigneePrincipalId ?? upgraded.createdByPrincipalId
      )
      if (!assignee) throw new ConvexError({ code: "ASSIGNEE_NOT_FOUND" })
      await enqueueNotification(
        ctx,
        upgraded,
        assignee,
        "critical_escalation",
        now
      )
      await refreshOperatorWorkspaceProjection(ctx, upgraded._id)
      return toPublicRequest(ctx, upgraded)
    }
    const requestId = await ctx.db.insert("contentRequests", {
      ...contentRequestCreationDefaults(now),
      organizationId: principal.organizationId,
      title,
      normalizedTitle: normalizeText(title),
      searchText: searchTextFor(title, aliases, args.source),
      queueSortKey: requestQueueSortKey(args.origin, "critical", now),
      aliases,
      origin: args.origin,
      priority: "critical",
      normalizedSourceUrl,
      assigneePrincipalId: principal._id,
      createdByPrincipalId: principal._id,
    })
    const humanId = humanIdFor(requestId)
    const primaryDeliverableId = await ctx.db.insert("deliverables", {
      organizationId: principal.organizationId,
      requestId,
      kind: "primary_response",
      name: "Primary response",
      isPrimary: true,
      retention: "active",
      createdAt: now,
      updatedAt: now,
    })
    let sourceSnapshotId: Id<"sourceSnapshots"> | undefined
    if (args.source) {
      sourceSnapshotId = await ctx.db.insert("sourceSnapshots", {
        organizationId: principal.organizationId,
        requestId,
        question: args.source.question,
        body: args.source.body,
        url: args.source.url,
        name: args.source.name,
        channel: args.source.channel,
        capturedByPrincipalId: principal._id,
        capturedAt: now,
      })
    }
    await ctx.db.insert("deliveryTargets", {
      organizationId: principal.organizationId,
      requestId,
      deliverableId: primaryDeliverableId,
      channel: args.source?.channel?.trim() || "original_opportunity",
      destinationLabel:
        args.source?.name?.trim() || "Original opportunity response",
      destinationUrl: args.source?.url?.trim() || undefined,
      isOriginal: true,
      isRequired: true,
      retention: "active",
      createdByPrincipalId: principal._id,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(requestId, { humanId, sourceSnapshotId })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId,
      requestHumanId: humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "content_request.created",
      correlationId,
      occurredAt: now,
      afterVersion: 1,
      inputFingerprint,
    })
    const request = await ctx.db.get(requestId)
    if (!request) throw new ConvexError({ code: "WRITE_FAILED" })
    await refreshOperatorWorkspaceProjection(ctx, requestId)
    return toPublicRequest(ctx, request)
  },
})

/**
 * Updates only editorial request metadata. Original source snapshots and
 * founder input are intentionally absent from this mutation's schema.
 */
export const update = mutation({
  args: {
    humanId: v.string(),
    title: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    priority: v.optional(requestPriorityValidator),
    timingLabel: v.optional(v.union(v.string(), v.null())),
    correlationId: v.string(),
  },
  returns: contentRequestValidator,
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
    requireActiveRequest(request)
    if (
      args.title === undefined &&
      args.aliases === undefined &&
      args.priority === undefined &&
      args.timingLabel === undefined
    )
      throw new ConvexError({ code: "VALIDATION_FAILED", field: "update" })
    const title =
      args.title === undefined
        ? request.title
        : cleanRequiredText(args.title, "title")
    const aliases =
      args.aliases === undefined
        ? request.aliases
        : args.aliases.map((alias) => cleanRequiredText(alias, "aliases"))
    if (aliases.length > 100)
      throw new ConvexError({ code: "VALIDATION_FAILED", field: "aliases" })
    const priority = args.priority ?? request.priority
    const timingLabel =
      args.timingLabel === undefined
        ? request.timingLabel
        : (cleanOptionalText(args.timingLabel ?? undefined) ?? undefined)
    const correlationId = cleanRequiredText(args.correlationId, "correlationId")
    const inputFingerprint = JSON.stringify({
      humanId: request.humanId,
      title: args.title === undefined ? null : title,
      aliases: args.aliases === undefined ? null : aliases,
      priority: args.priority ?? null,
      timingLabel:
        args.timingLabel === undefined
          ? "__unchanged__"
          : (timingLabel ?? null),
    })
    const prior = await ctx.db
      .query("auditEvents")
      .withIndex("by_organization_actor_operation_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("operation", "content_request.updated")
          .eq("correlationId", correlationId)
      )
      .unique()
    if (prior) {
      if (
        prior.requestId !== request._id ||
        prior.inputFingerprint !== inputFingerprint
      )
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return toPublicRequest(ctx, request)
    }
    const source = request.sourceSnapshotId
      ? await ctx.db.get(request.sourceSnapshotId)
      : null
    const now = Date.now()
    const afterVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      title,
      normalizedTitle: normalizeText(title),
      searchText: searchTextFor(title, aliases, source ?? undefined),
      aliases,
      priority,
      timingLabel,
      queueSortKey: requestQueueSortKey(
        request.origin,
        priority,
        request.createdAt
      ),
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "content_request.updated",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion,
      inputFingerprint,
    })
    await refreshOperatorWorkspaceProjection(ctx, request._id)
    const updated = await ctx.db.get(request._id)
    if (!updated) throw new ConvexError({ code: "WRITE_FAILED" })
    return toPublicRequest(ctx, updated)
  },
})

export const getByHumanId = query({
  args: { humanId: v.string() },
  returns: v.union(contentRequestValidator, v.null()),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", args.humanId.trim().toUpperCase())
      )
      .unique()
    if (
      request &&
      principal.role === "founder" &&
      (request.assigneePrincipalId ?? request.createdByPrincipalId) !==
        principal._id
    ) {
      throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED" })
    }
    return request ? toPublicRequest(ctx, request) : null
  },
})

export const list = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(contentRequestValidator),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 100)
    const requests =
      principal.role === "founder"
        ? (
            await ctx.db
              .query("contentRequests")
              .withIndex("by_organization_assignee_queue_sort", (index) =>
                index
                  .eq("organizationId", principal.organizationId)
                  .eq("assigneePrincipalId", principal._id)
              )
              .order("asc")
              .collect()
          )
            .filter(
              (request) =>
                request.retention === "active" &&
                request.disposition === "active" &&
                ["pending", "in_progress"].includes(request.lifecycle)
            )
            .slice(0, limit)
        : await ctx.db
            .query("contentRequests")
            .withIndex("by_organization_queue_sort", (index) =>
              index.eq("organizationId", principal.organizationId)
            )
            .order("asc")
            .take(limit)
    return Promise.all(requests.map((request) => toPublicRequest(ctx, request)))
  },
})

export const listFounderWorkspace = query({
  args: { founderEmail: v.string(), limit: v.optional(v.number()) },
  returns: v.array(contentRequestValidator),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    if (principal.role !== "administrator") {
      throw new ConvexError({ code: "ROLE_ACCESS_DENIED" })
    }
    const founderEmail = args.founderEmail.trim().toLowerCase()
    if (!founderEmail) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "founderEmail",
      })
    }
    const principals = await ctx.db
      .query("principals")
      .withIndex("by_organization_subject", (index) =>
        index.eq("organizationId", principal.organizationId)
      )
      .collect()
    const founder = principals.find(
      (candidate) =>
        candidate.role === "founder" &&
        candidate.kind !== "system" &&
        candidate.email?.trim().toLowerCase() === founderEmail
    )
    if (!founder) {
      throw new ConvexError({ code: "FOUNDER_WORKSPACE_NOT_FOUND" })
    }
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 100)
    const requests = (
      await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_assignee_queue_sort", (index) =>
          index
            .eq("organizationId", principal.organizationId)
            .eq("assigneePrincipalId", founder._id)
        )
        .order("asc")
        .collect()
    )
      .filter(
        (request) =>
          request.retention === "active" &&
          request.disposition === "active" &&
          ["pending", "in_progress"].includes(request.lifecycle)
      )
      .slice(0, limit)
    return Promise.all(requests.map((request) => toPublicRequest(ctx, request)))
  },
})

export const listPage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(contentRequestValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const requests = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_queue_sort", (index) =>
        index.eq("organizationId", principal.organizationId)
      )
      .order("asc")
      .paginate(args.paginationOpts)
    return {
      isDone: requests.isDone,
      continueCursor: requests.continueCursor,
      page: await Promise.all(
        requests.page.map((request) => toPublicRequest(ctx, request))
      ),
    }
  },
})

export const resolve = query({
  args: { query: v.string() },
  returns: resolutionValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const rawQuery = cleanRequiredText(args.query, "query")
    const exactId = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", rawQuery.toUpperCase())
      )
      .unique()
    if (exactId) {
      return {
        kind: "resolved" as const,
        matchedBy: "exact_id" as const,
        request: await toPublicRequest(ctx, exactId),
      }
    }

    const normalizedQuery = normalizeText(rawQuery)
    const exactTitles = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_normalized_title", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("normalizedTitle", normalizedQuery)
      )
      .collect()
    if (exactTitles.length === 1) {
      return {
        kind: "resolved" as const,
        matchedBy: "exact_title" as const,
        request: await toPublicRequest(ctx, exactTitles[0]),
      }
    }

    const requests = await ctx.db
      .query("contentRequests")
      .withSearchIndex("search_content", (search) =>
        search
          .search("searchText", rawQuery)
          .eq("organizationId", principal.organizationId)
      )
      .take(50)
    const scored = await Promise.all(
      requests.map(async (request) => {
        const source = request.sourceSnapshotId
          ? await ctx.db.get(request.sourceSnapshotId)
          : null
        return { request, score: fuzzyScore(request, source, rawQuery) }
      })
    )
    const candidates = scored
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.request.createdAt - right.request.createdAt
      )
      .slice(0, 10)
      .map(({ request, score }) => ({
        requestId: request._id,
        humanId: request.humanId,
        title: request.title,
        origin: request.origin,
        priority: request.priority,
        lifecycle: request.lifecycle,
        score,
      }))
    if (candidates.length === 0) {
      return { kind: "not_found" as const, candidates: [] }
    }
    return { kind: "candidates" as const, candidates }
  },
})

export const listAssignablePrincipals = query({
  args: {},
  returns: v.array(principalSummaryValidator),
  handler: async (ctx) => {
    const principal = await requirePrincipal(ctx)
    if (principal.role === "founder") return []
    const principals = await ctx.db
      .query("principals")
      .withIndex("by_organization_subject", (index) =>
        index.eq("organizationId", principal.organizationId)
      )
      .collect()
    return principals
      .filter((candidate) => candidate.kind !== "system")
      .map((candidate) => ({
        principalId: candidate._id,
        subject: candidate.subject,
        role: candidate.role,
      }))
  },
})

export const assign = internalMutation({
  args: {
    humanId: v.string(),
    assigneePrincipalId: v.id("principals"),
    watcherPrincipalIds: v.optional(v.array(v.id("principals"))),
    reason: v.optional(v.string()),
    correlationId: v.string(),
  },
  returns: contentRequestValidator,
  handler: async (ctx, args) => {
    const actor = await requirePrincipal(ctx)
    requireEditor(actor)
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", actor.organizationId)
          .eq("humanId", args.humanId.trim().toUpperCase())
      )
      .unique()
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    requireActiveRequest(request)
    const assignee = await ctx.db.get(args.assigneePrincipalId)
    if (
      !assignee ||
      assignee.organizationId !== actor.organizationId ||
      assignee.kind === "system"
    ) {
      throw new ConvexError({ code: "ASSIGNEE_NOT_FOUND" })
    }
    if (assignee.role === "founder") {
      const founderInput = await ctx.db
        .query("founderInputDocuments")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .unique()
      if (founderInput && founderInput.founderPrincipalId !== assignee._id) {
        throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
      }
    }
    const watcherPrincipalIds = [
      ...new Set(args.watcherPrincipalIds ?? request.watcherPrincipalIds ?? []),
    ].filter((principalId) => principalId !== assignee._id)
    const watchers = await Promise.all(
      watcherPrincipalIds.map((principalId) => ctx.db.get(principalId))
    )
    if (
      watchers.some(
        (watcher) =>
          !watcher ||
          watcher.organizationId !== actor.organizationId ||
          watcher.kind === "system"
      )
    ) {
      throw new ConvexError({ code: "WATCHER_NOT_FOUND" })
    }
    const now = Date.now()
    const afterVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      assigneePrincipalId: assignee._id,
      watcherPrincipalIds,
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await ctx.db.insert("assignmentEvents", {
      organizationId: actor.organizationId,
      requestId: request._id,
      previousAssigneePrincipalId:
        request.assigneePrincipalId ?? request.createdByPrincipalId,
      newAssigneePrincipalId: assignee._id,
      watcherPrincipalIds,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      reason: cleanOptionalText(args.reason),
      correlationId: cleanRequiredText(args.correlationId, "correlationId"),
      occurredAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: actor.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      operation: "content_request.assigned",
      correlationId: args.correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion,
    })
    if (
      (request.assigneePrincipalId ?? request.createdByPrincipalId) !==
      assignee._id
    ) {
      await enqueueNotification(ctx, request, assignee, "request_assigned", now)
      if (request.priority === "critical") {
        await enqueueNotification(
          ctx,
          request,
          assignee,
          "critical_escalation",
          now
        )
      }
    }
    const updated = await ctx.db.get(request._id)
    if (!updated) throw new ConvexError({ code: "WRITE_FAILED" })
    await refreshOperatorWorkspaceProjection(ctx, request._id)
    return toPublicRequest(ctx, updated)
  },
})

export const open = mutation({
  args: { humanId: v.string(), correlationId: v.string() },
  returns: contentRequestValidator,
  handler: async (ctx, args) => {
    const actor = await requirePrincipal(ctx)
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", actor.organizationId)
          .eq("humanId", args.humanId.trim().toUpperCase())
      )
      .unique()
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    if (
      actor.role === "founder" &&
      (request.assigneePrincipalId ?? request.createdByPrincipalId) !==
        actor._id
    ) {
      throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED" })
    }
    const correlationId = cleanRequiredText(args.correlationId, "correlationId")
    const existingOpen = await ctx.db
      .query("auditEvents")
      .withIndex("by_request_operation_correlation", (index) =>
        index
          .eq("requestId", request._id)
          .eq("operation", "content_request.opened")
          .eq("correlationId", correlationId)
      )
      .first()
    if (existingOpen) return toPublicRequest(ctx, request)
    const now = Date.now()
    const afterVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      firstOpenedAt: request.firstOpenedAt ?? now,
      latestOpenedAt: now,
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: actor.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      operation: "content_request.opened",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion,
    })
    const updated = await ctx.db.get(request._id)
    if (!updated) throw new ConvexError({ code: "WRITE_FAILED" })
    return toPublicRequest(ctx, updated)
  },
})

export const listAssignmentEvents = query({
  args: { humanId: v.string() },
  returns: v.array(assignmentEventValidator),
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
    if (!request) return []
    const events = await ctx.db
      .query("assignmentEvents")
      .withIndex("by_request_occurred_at", (index) =>
        index.eq("requestId", request._id)
      )
      .collect()
    return events.map((event) => ({
      eventId: event._id,
      previousAssigneePrincipalId: event.previousAssigneePrincipalId,
      newAssigneePrincipalId: event.newAssigneePrincipalId,
      watcherPrincipalIds: event.watcherPrincipalIds,
      actorPrincipalId: event.actorPrincipalId,
      credentialId: event.credentialId,
      reason: event.reason ?? null,
      correlationId: event.correlationId,
      occurredAt: event.occurredAt,
    }))
  },
})

export const listMyNotifications = query({
  args: {},
  returns: v.array(notificationValidator),
  handler: async (ctx) => {
    const principal = await requirePrincipal(ctx)
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_created_at", (index) =>
        index.eq("recipientPrincipalId", principal._id)
      )
      .order("desc")
      .take(50)
    return Promise.all(
      notifications.map(async (notification) => {
        const request = await ctx.db.get(notification.requestId)
        if (!request) throw new ConvexError({ code: "NOT_FOUND" })
        return {
          notificationId: notification._id,
          requestHumanId: request.humanId,
          type: notification.type,
          emailQueued: notification.emailQueued,
          emailStatus: notification.emailStatus,
          createdAt: notification.createdAt,
          readAt: notification.readAt ?? null,
          deepLink: `/app/requests/${request.humanId}`,
        }
      })
    )
  },
})

export const listMyNotificationsPage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(notificationValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_created_at", (index) =>
        index.eq("recipientPrincipalId", principal._id)
      )
      .order("desc")
      .paginate(args.paginationOpts)
    return {
      isDone: notifications.isDone,
      continueCursor: notifications.continueCursor,
      page: await Promise.all(
        notifications.page.map(async (notification) => {
          const request = await ctx.db.get(notification.requestId)
          if (!request) throw new ConvexError({ code: "NOT_FOUND" })
          return {
            notificationId: notification._id,
            requestHumanId: request.humanId,
            type: notification.type,
            emailQueued: notification.emailQueued,
            emailStatus: notification.emailStatus,
            createdAt: notification.createdAt,
            readAt: notification.readAt ?? null,
            deepLink: `/app/requests/${request.humanId}`,
          }
        })
      ),
    }
  },
})

export const markNotificationRead = mutation({
  args: {
    notificationId: v.id("notifications"),
    correlationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    const notification = await ctx.db.get(args.notificationId)
    if (
      !notification ||
      notification.organizationId !== principal.organizationId ||
      notification.recipientPrincipalId !== principal._id
    ) {
      throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED" })
    }
    const request = await ctx.db.get(notification.requestId)
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const correlationId = args.correlationId.trim()
    if (!correlationId)
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "correlationId",
      })
    const inputFingerprint = `notification:${notification._id}`
    const priorAudit = await ctx.db
      .query("auditEvents")
      .withIndex("by_organization_actor_operation_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("operation", "notification.read")
          .eq("correlationId", correlationId)
      )
      .unique()
    if (priorAudit) {
      if (
        priorAudit.requestId !== request._id ||
        priorAudit.inputFingerprint !== inputFingerprint
      )
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return null
    }
    const now = Date.now()
    if (!notification.readAt) {
      await ctx.db.patch(notification._id, { readAt: now })
    }
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "notification.read",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: request.aggregateVersion,
      inputFingerprint,
    })
    return null
  },
})

export const listAuditEvents = query({
  args: { humanId: v.string() },
  returns: v.array(auditEventValidator),
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
    if (!request) return []
    const events = await ctx.db
      .query("auditEvents")
      .withIndex("by_request_occurred_at", (index) =>
        index.eq("requestId", request._id)
      )
      .collect()
    return events.map((event) => ({
      eventId: event._id,
      operation: event.operation,
      correlationId: event.correlationId,
      requestHumanId: event.requestHumanId,
      actorPrincipalId: event.actorPrincipalId,
      credentialId: event.credentialId,
      occurredAt: event.occurredAt,
      beforeVersion: event.beforeVersion ?? null,
      afterVersion: event.afterVersion,
    }))
  },
})

export const listAuditEventsPage = query({
  args: { humanId: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(auditEventValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
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
    if (!request) return { page: [], isDone: true, continueCursor: "" }
    const events = await ctx.db
      .query("auditEvents")
      .withIndex("by_request_occurred_at", (index) =>
        index.eq("requestId", request._id)
      )
      .order("desc")
      .paginate(args.paginationOpts)
    return {
      isDone: events.isDone,
      continueCursor: events.continueCursor,
      page: events.page.map((event) => ({
        eventId: event._id,
        operation: event.operation,
        correlationId: event.correlationId,
        requestHumanId: event.requestHumanId,
        actorPrincipalId: event.actorPrincipalId,
        credentialId: event.credentialId,
        occurredAt: event.occurredAt,
        beforeVersion: event.beforeVersion ?? null,
        afterVersion: event.afterVersion,
      })),
    }
  },
})
