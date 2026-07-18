import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export const workspaceRoleValidator = v.union(
  v.literal("founder"),
  v.literal("operator_editor"),
  v.literal("agent_editor"),
  v.literal("administrator")
)

export const requestOriginValidator = v.union(
  v.literal("manual"),
  v.literal("automated_scout"),
  v.literal("chatgpt_app"),
  v.literal("cli"),
  v.literal("http_api")
)

export const requestPriorityValidator = v.union(
  v.literal("critical"),
  v.literal("high"),
  v.literal("normal"),
  v.literal("low")
)

export const requestLifecycleValidator = v.union(
  v.literal("pending"),
  v.literal("in_progress"),
  v.literal("founder_complete"),
  v.literal("ready_to_respond"),
  v.literal("responded")
)

export const requestDispositionValidator = v.union(
  v.literal("active"),
  v.literal("expired")
)

export const requestRetentionValidator = v.union(
  v.literal("active"),
  v.literal("archived")
)

export default defineSchema({
  principals: defineTable({
    subject: v.string(),
    organizationId: v.string(),
    role: workspaceRoleValidator,
    updatedAt: v.number(),
  }).index("by_organization_subject", ["organizationId", "subject"]),
  contentRequests: defineTable({
    humanId: v.string(),
    organizationId: v.string(),
    title: v.string(),
    normalizedTitle: v.string(),
    searchText: v.string(),
    aliases: v.array(v.string()),
    origin: requestOriginValidator,
    priority: requestPriorityValidator,
    lifecycle: requestLifecycleValidator,
    disposition: requestDispositionValidator,
    retention: requestRetentionValidator,
    aggregateVersion: v.number(),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    createdByPrincipalId: v.id("principals"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_human_id", ["organizationId", "humanId"])
    .index("by_organization_normalized_title", [
      "organizationId",
      "normalizedTitle",
    ])
    .index("by_organization_created_at", ["organizationId", "createdAt"])
    .searchIndex("search_content", {
      searchField: "searchText",
      filterFields: ["organizationId"],
    }),
  sourceSnapshots: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    question: v.optional(v.string()),
    body: v.optional(v.string()),
    url: v.optional(v.string()),
    name: v.optional(v.string()),
    channel: v.optional(v.string()),
    capturedByPrincipalId: v.id("principals"),
    capturedAt: v.number(),
  }).index("by_request", ["requestId"]),
  auditEvents: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    requestHumanId: v.string(),
    actorPrincipalId: v.id("principals"),
    credentialId: v.string(),
    operation: v.string(),
    correlationId: v.string(),
    occurredAt: v.number(),
    beforeVersion: v.optional(v.number()),
    afterVersion: v.number(),
  })
    .index("by_request_occurred_at", ["requestId", "occurredAt"])
    .index("by_organization_occurred_at", ["organizationId", "occurredAt"]),
})
