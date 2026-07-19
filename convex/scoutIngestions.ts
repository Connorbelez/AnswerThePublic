import { ConvexError, v } from "convex/values"

import type { Id } from "./_generated/dataModel"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { requireEditor, requirePrincipal } from "./lib/authorization"
import { requestQueueSortKey } from "./lib/requestOrdering"
import { parseScoutReport } from "../src/domain/scout-report"

const citationValidator = v.object({
  label: v.string(),
  url: v.string(),
  supports: v.string(),
})

const resultValidator = v.object({
  ingestionRunId: v.id("ingestionRuns"),
  status: v.union(v.literal("applied"), v.literal("idempotent_replay")),
  created: v.number(),
  updated: v.number(),
  manualPreserved: v.number(),
  requestHumanIds: v.array(v.string()),
})

const contextKindValidator = v.union(
  v.literal("source_metadata"),
  v.literal("source_summary"),
  v.literal("talking_points"),
  v.literal("research_requirements"),
  v.literal("missing_research"),
  v.literal("citations"),
  v.literal("guardrails"),
  v.literal("operator_cue"),
  v.literal("delivery_hint")
)

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase("en-CA").replace(/\s+/g, " ")
}

function humanIdFor(requestId: Id<"contentRequests">) {
  return `CR-${requestId.slice(0, 17).toUpperCase()}`
}

function priorityFor(score: number) {
  if (score >= 90) return "high" as const
  if (score >= 75) return "normal" as const
  return "low" as const
}

function contentChecksum(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`
}

export const authorizeEditor = query({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    return null
  },
})

export const apply = mutation({
  args: {
    idempotencyKey: v.string(),
    markdown: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const idempotencyKey = args.idempotencyKey.trim()
    if (!idempotencyKey)
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "idempotencyKey",
      })
    const parsed = parseScoutReport(args.markdown)
    if (!parsed.ok) {
      throw new ConvexError({
        code: "INVALID_SCOUT_REPORT",
        diagnostics: parsed.diagnostics,
      })
    }
    const report = parsed.report
    const reportHash = contentChecksum(args.markdown)
    const existingRun = await ctx.db
      .query("ingestionRuns")
      .withIndex("by_organization_idempotency", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("idempotencyKey", idempotencyKey)
      )
      .unique()
    if (existingRun) {
      if (existingRun.rawMarkdown !== args.markdown)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return {
        ingestionRunId: existingRun._id,
        status: "idempotent_replay" as const,
        ...existingRun.result,
      }
    }

    const now = Date.now()
    const ingestionRunId = await ctx.db.insert("ingestionRuns", {
      organizationId: principal.organizationId,
      reportIdentity: report.reportIdentity,
      idempotencyKey,
      reportHash,
      rawMarkdown: args.markdown,
      demandLedgerMarkdown: report.demandLedgerMarkdown,
      parserVersion: report.parserVersion,
      status: "applied",
      createdByPrincipalId: principal._id,
      createdAt: now,
      result: {
        created: 0,
        updated: 0,
        manualPreserved: 0,
        requestHumanIds: [],
      },
    })
    let created = 0
    let updated = 0
    let manualPreserved = 0
    const requestHumanIds: Array<string> = []

    for (const opportunity of report.opportunities) {
      const sourceMatches = await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_normalized_source_url", (index) =>
          index
            .eq("organizationId", principal.organizationId)
            .eq("normalizedSourceUrl", opportunity.normalizedSourceUrl)
        )
        .collect()
      if (sourceMatches.length > 1) {
        throw new ConvexError({
          code: "SOURCE_COLLISION_REQUIRES_REMEDIATION",
          normalizedSourceUrl: opportunity.normalizedSourceUrl,
          requestHumanIds: sourceMatches.map((request) => request.humanId),
        })
      }
      const existing = sourceMatches[0]
      let requestId: Id<"contentRequests">
      let humanId: string
      let action: "created" | "updated" | "manual_preserved"
      if (existing) {
        requestId = existing._id
        humanId = existing.humanId
        action =
          existing.origin === "automated_scout" ? "updated" : "manual_preserved"
        if (action === "updated") updated += 1
        else manualPreserved += 1
        if (existing.origin === "automated_scout") {
          const priority = priorityFor(opportunity.score)
          await ctx.db.patch(requestId, {
            title: opportunity.title,
            normalizedTitle: normalizeText(opportunity.title),
            searchText: `${opportunity.title} ${existing.aliases.join(" ")} ${opportunity.question ?? ""} ${opportunity.normalizedSourceUrl}`,
            priority,
            timingLabel: opportunity.timingLabel,
            latestIngestionRunId: ingestionRunId,
            queueSortKey: requestQueueSortKey(
              "automated_scout",
              priority,
              existing.createdAt
            ),
            aggregateVersion: existing.aggregateVersion + 1,
            updatedAt: now,
          })
        } else {
          await ctx.db.patch(requestId, {
            timingLabel: opportunity.timingLabel,
            latestIngestionRunId: ingestionRunId,
            priority: "critical",
            aggregateVersion: existing.aggregateVersion + 1,
            updatedAt: now,
          })
        }
      } else {
        const priority = priorityFor(opportunity.score)
        requestId = await ctx.db.insert("contentRequests", {
          humanId: "pending",
          organizationId: principal.organizationId,
          title: opportunity.title,
          normalizedTitle: normalizeText(opportunity.title),
          searchText: `${opportunity.title} ${opportunity.question ?? ""} ${opportunity.normalizedSourceUrl}`,
          aliases: [],
          origin: "automated_scout",
          priority,
          lifecycle: "pending",
          disposition: "active",
          retention: "active",
          aggregateVersion: 1,
          normalizedSourceUrl: opportunity.normalizedSourceUrl,
          latestIngestionRunId: ingestionRunId,
          timingLabel: opportunity.timingLabel,
          queueSortKey: requestQueueSortKey("automated_scout", priority, now),
          assigneePrincipalId: principal._id,
          watcherPrincipalIds: [],
          createdByPrincipalId: principal._id,
          createdAt: now,
          updatedAt: now,
        })
        humanId = humanIdFor(requestId)
        const sourceSnapshotId = await ctx.db.insert("sourceSnapshots", {
          organizationId: principal.organizationId,
          requestId,
          question: opportunity.question,
          body: opportunity.rawMarkdown,
          url: opportunity.sourceUrl,
          name: opportunity.title,
          channel: opportunity.section,
          rawOpportunityMarkdown: opportunity.rawMarkdown,
          captureKind: "automated_primary",
          capturedByPrincipalId: principal._id,
          capturedAt: now,
        })
        await ctx.db.patch(requestId, { humanId, sourceSnapshotId })
        action = "created"
        created += 1
      }

      const contexts = [
        {
          kind: "source_metadata" as const,
          title: "Source metadata",
          bulletPoints: opportunity.sourceMetadata,
          citations: [],
        },
        {
          kind: "talking_points" as const,
          title: "Talking points",
          bulletPoints: opportunity.talkingPoints,
          citations: [],
        },
        {
          kind: "research_requirements" as const,
          title: "Research required",
          bulletPoints: opportunity.researchRequirements,
          citations: [],
        },
        {
          kind: "citations" as const,
          title: "Citations",
          bulletPoints: [],
          citations: opportunity.citations,
        },
        {
          kind: "guardrails" as const,
          title: "Guardrails",
          bulletPoints: opportunity.guardrails,
          citations: [],
        },
        {
          kind: "operator_cue" as const,
          title: "Operator cue",
          bulletPoints: opportunity.operatorCue
            ? [opportunity.operatorCue]
            : [],
          citations: [],
        },
        {
          kind: "delivery_hint" as const,
          title: "Suggested delivery",
          bulletPoints: opportunity.deliveryHints,
          citations: [],
        },
      ]
      const existingContexts = await ctx.db
        .query("contextItems")
        .withIndex("by_request_kind", (index) =>
          index.eq("requestId", requestId)
        )
        .collect()
      for (const context of contexts) {
        const existingContext = existingContexts.find(
          (item) => item.kind === context.kind
        )
        if (existingContext) {
          await ctx.db.patch(existingContext._id, {
            ...context,
            ingestionRunId,
            updatedAt: now,
          })
        } else {
          await ctx.db.insert("contextItems", {
            organizationId: principal.organizationId,
            requestId,
            ...context,
            ingestionRunId,
            createdAt: now,
            updatedAt: now,
          })
        }
      }
      await ctx.db.insert("ingestionItems", {
        organizationId: principal.organizationId,
        ingestionRunId,
        requestId,
        sourceKey: opportunity.normalizedSourceUrl,
        itemId: opportunity.itemId,
        action,
        createdAt: now,
      })
      await ctx.db.insert("auditEvents", {
        organizationId: principal.organizationId,
        requestId,
        requestHumanId: humanId,
        actorPrincipalId: principal._id,
        credentialId: principal.credentialId,
        operation: `scout_ingestion.${action}`,
        correlationId: idempotencyKey,
        occurredAt: now,
        afterVersion: existing ? existing.aggregateVersion + 1 : 1,
        beforeVersion: existing?.aggregateVersion,
      })
      requestHumanIds.push(humanId)
    }
    const result = { created, updated, manualPreserved, requestHumanIds }
    await ctx.db.patch(ingestionRunId, { result })
    return { ingestionRunId, status: "applied" as const, ...result }
  },
})

export const listContext = query({
  args: { humanId: v.string() },
  returns: v.array(
    v.object({
      contextId: v.string(),
      kind: contextKindValidator,
      title: v.string(),
      bulletPoints: v.array(v.string()),
      citations: v.array(citationValidator),
    })
  ),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", args.humanId)
      )
      .unique()
    if (!request) return []
    if (
      principal.role === "founder" &&
      (request.assigneePrincipalId ?? request.createdByPrincipalId) !==
        principal._id
    ) {
      throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED" })
    }
    const items = await ctx.db
      .query("contextItems")
      .withIndex("by_request_kind", (index) =>
        index.eq("requestId", request._id)
      )
      .collect()
    return items.map((item) => ({
      contextId: item._id,
      kind: item.kind,
      title: item.title,
      bulletPoints: item.bulletPoints,
      citations: item.citations,
    }))
  },
})

const contextDeckPreferencesValidator = v.object({
  visibleContextIds: v.array(v.string()),
  pinnedContextIds: v.array(v.string()),
  knownContextIds: v.array(v.string()),
})

async function contextRequestForPrincipal(
  ctx: QueryCtx | MutationCtx,
  humanId: string
) {
  const principal = await requirePrincipal(ctx)
  const request = await ctx.db
    .query("contentRequests")
    .withIndex("by_organization_human_id", (index) =>
      index
        .eq("organizationId", principal.organizationId)
        .eq("humanId", humanId)
    )
    .unique()
  if (!request) throw new ConvexError({ code: "NOT_FOUND" })
  if (
    principal.role === "founder" &&
    (request.assigneePrincipalId ?? request.createdByPrincipalId) !==
      principal._id
  ) {
    throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED" })
  }
  return { principal, request }
}

export const getContextDeckPreferences = query({
  args: { humanId: v.string() },
  returns: v.union(contextDeckPreferencesValidator, v.null()),
  handler: async (ctx, args) => {
    const { principal, request } = await contextRequestForPrincipal(
      ctx,
      args.humanId
    )
    const preferences = await ctx.db
      .query("contextDeckPreferences")
      .withIndex("by_request_principal", (index) =>
        index.eq("requestId", request._id).eq("principalId", principal._id)
      )
      .unique()
    return preferences
      ? {
          visibleContextIds: preferences.visibleContextIds,
          pinnedContextIds: preferences.pinnedContextIds,
          knownContextIds: preferences.knownContextIds,
        }
      : null
  },
})

export const saveContextDeckPreferences = mutation({
  args: {
    humanId: v.string(),
    visibleContextIds: v.array(v.string()),
    pinnedContextIds: v.array(v.string()),
    knownContextIds: v.array(v.string()),
    correlationId: v.string(),
  },
  returns: contextDeckPreferencesValidator,
  handler: async (ctx, args) => {
    const { principal, request } = await contextRequestForPrincipal(
      ctx,
      args.humanId
    )
    const context = await ctx.db
      .query("contextItems")
      .withIndex("by_request_kind", (index) =>
        index.eq("requestId", request._id)
      )
      .collect()
    const source = request.sourceSnapshotId
      ? await ctx.db.get(request.sourceSnapshotId)
      : null
    const allowed = new Set(context.map((item) => String(item._id)))
    if (source?.question) allowed.add("original-question")
    if (source?.body) allowed.add("original-source-body")
    if (source?.url && !source.body) allowed.add("original-source-link")
    const sanitize = (ids: Array<string>) => [
      ...new Set(ids.filter((id) => allowed.has(id))),
    ]
    const value = {
      visibleContextIds: sanitize(args.visibleContextIds),
      pinnedContextIds: sanitize(args.pinnedContextIds),
      knownContextIds: sanitize(args.knownContextIds),
    }
    const inputFingerprint = contentChecksum(
      JSON.stringify({
        visibleContextIds: [...value.visibleContextIds].sort(),
        pinnedContextIds: [...value.pinnedContextIds].sort(),
        knownContextIds: [...value.knownContextIds].sort(),
      })
    )
    const existing = await ctx.db
      .query("contextDeckPreferences")
      .withIndex("by_request_principal", (index) =>
        index.eq("requestId", request._id).eq("principalId", principal._id)
      )
      .unique()
    const correlationId = args.correlationId.trim()
    if (!correlationId) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "correlationId",
      })
    }
    const priorAudit = await ctx.db
      .query("auditEvents")
      .withIndex("by_organization_actor_operation_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("operation", "context_deck.preferences_saved")
          .eq("correlationId", correlationId)
      )
      .unique()
    if (priorAudit) {
      if (
        priorAudit.requestId !== request._id ||
        priorAudit.inputFingerprint !== inputFingerprint
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      }
      return value
    }
    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, { ...value, updatedAt: now })
    } else {
      await ctx.db.insert("contextDeckPreferences", {
        organizationId: principal.organizationId,
        requestId: request._id,
        principalId: principal._id,
        ...value,
        updatedAt: now,
      })
    }
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "context_deck.preferences_saved",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: request.aggregateVersion,
      inputFingerprint,
    })
    return value
  },
})
