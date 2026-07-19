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
    email: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_organization_subject", ["organizationId", "subject"]),
  contentRequests: defineTable({
    humanId: v.string(),
    organizationId: v.string(),
    title: v.string(),
    normalizedTitle: v.string(),
    searchText: v.string(),
    queueSortKey: v.optional(v.string()),
    aliases: v.array(v.string()),
    origin: requestOriginValidator,
    priority: requestPriorityValidator,
    lifecycle: requestLifecycleValidator,
    disposition: requestDispositionValidator,
    retention: requestRetentionValidator,
    aggregateVersion: v.number(),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    assigneePrincipalId: v.optional(v.id("principals")),
    watcherPrincipalIds: v.optional(v.array(v.id("principals"))),
    firstOpenedAt: v.optional(v.number()),
    latestOpenedAt: v.optional(v.number()),
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
    .index("by_organization_queue_sort", ["organizationId", "queueSortKey"])
    .index("by_organization_assignee_created_at", [
      "organizationId",
      "assigneePrincipalId",
      "createdAt",
    ])
    .index("by_organization_assignee_queue_sort", [
      "organizationId",
      "assigneePrincipalId",
      "queueSortKey",
    ])
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
    .index("by_request_operation_correlation", [
      "requestId",
      "operation",
      "correlationId",
    ])
    .index("by_organization_occurred_at", ["organizationId", "occurredAt"]),
  assignmentEvents: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    previousAssigneePrincipalId: v.id("principals"),
    newAssigneePrincipalId: v.id("principals"),
    watcherPrincipalIds: v.array(v.id("principals")),
    actorPrincipalId: v.id("principals"),
    credentialId: v.string(),
    reason: v.optional(v.string()),
    correlationId: v.string(),
    occurredAt: v.number(),
  }).index("by_request_occurred_at", ["requestId", "occurredAt"]),
  notifications: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    recipientPrincipalId: v.id("principals"),
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
    readAt: v.optional(v.number()),
  })
    .index("by_recipient_created_at", ["recipientPrincipalId", "createdAt"])
    .index("by_request_created_at", ["requestId", "createdAt"]),
  notificationEmailOutbox: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    notificationId: v.id("notifications"),
    recipientPrincipalId: v.id("principals"),
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
    leaseExpiresAt: v.optional(v.number()),
    claimToken: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastErrorCode: v.optional(v.string()),
  })
    .index("by_status_updated_at", ["status", "updatedAt"])
    .index("by_status_next_attempt", ["status", "nextAttemptAt"])
    .index("by_status_lease_expiry", ["status", "leaseExpiresAt"])
    .index("by_notification", ["notificationId"]),
})
