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

export const contentRequestTypeValidator = v.union(
  v.literal("standard"),
  v.literal("expert_interview")
)

export const expertInterviewFramingValidator = v.union(
  v.literal("educational"),
  v.literal("how_to"),
  v.literal("insider_knowledge"),
  v.literal("fairlend_sales")
)

export const expertInterviewCitationValidator = v.object({
  label: v.string(),
  url: v.string(),
  supports: v.string(),
})

export const expertInterviewGapValidator = v.object({
  id: v.string(),
  kind: v.union(
    v.literal("confusing_coverage"),
    v.literal("local_specific"),
    v.literal("reality_on_the_ground"),
    v.literal("practitioner_best_practice"),
    v.literal("fragmented_how_to"),
    v.literal("missing_evidence"),
    v.literal("other")
  ),
  title: v.string(),
  existingCoverage: v.string(),
  whyItFallsShort: v.string(),
  expertOpportunity: v.string(),
  citations: v.array(expertInterviewCitationValidator),
})

export const expertInterviewQuestionValidator = v.object({
  id: v.string(),
  question: v.string(),
  motivation: v.string(),
  gapIds: v.array(v.string()),
})

export const expertInterviewBriefValidator = v.object({
  topic: v.string(),
  summary: v.string(),
  audience: v.string(),
  framing: expertInterviewFramingValidator,
  fairlendPosture: v.string(),
  founderContribution: v.string(),
})

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

export const guestAccessOperationGrantResultValidator = v.object({
  grantId: v.id("guestAccessGrants"),
  requestHumanId: v.string(),
  person: v.object({
    personId: v.id("people"),
    displayName: v.string(),
    email: v.string(),
    principalId: v.union(v.id("principals"), v.null()),
    isFounder: v.boolean(),
  }),
  state: v.union(
    v.literal("generated"),
    v.literal("opened"),
    v.literal("in_progress"),
    v.literal("submitted"),
    v.literal("expired"),
    v.literal("revoked")
  ),
  tokenVersion: v.number(),
  expiresAt: v.number(),
  createdAt: v.number(),
  firstOpenedAt: v.union(v.number(), v.null()),
  latestActivityAt: v.number(),
  progress: v.object({ completed: v.number(), total: v.number() }),
  submitted: v.boolean(),
  events: v.array(
    v.object({
      kind: v.union(
        v.literal("generated"),
        v.literal("opened"),
        v.literal("first_progress"),
        v.literal("submitted"),
        v.literal("expired"),
        v.literal("revoked"),
        v.literal("renewed"),
        v.literal("reopened"),
        v.literal("taken_over")
      ),
      occurredAt: v.number(),
      actor: v.union(
        v.literal("guest"),
        v.literal("administrator"),
        v.literal("system")
      ),
      actorName: v.string(),
      tokenVersion: v.union(v.number(), v.null()),
    })
  ),
})

export const founderHandoffFormatValidator = v.union(
  v.literal("original_response"),
  v.literal("blog_article"),
  v.literal("linkedin_post"),
  v.literal("x_thread"),
  v.literal("youtube_short"),
  v.literal("instagram_post"),
  v.literal("infographic")
)

export const founderHandoffStageValidator = v.union(
  v.literal("delivered"),
  v.literal("opened"),
  v.literal("draft_in_progress"),
  v.literal("founder_complete"),
  v.literal("agent_drafting"),
  v.literal("ready"),
  v.literal("attention_required")
)

export const founderHandoffStatusValidator = v.object({
  handoffId: v.id("founderHandoffs"),
  recipient: v.object({
    principalId: v.id("principals"),
    subject: v.string(),
    role: workspaceRoleValidator,
  }),
  selectedFormats: v.array(founderHandoffFormatValidator),
  note: v.union(v.string(), v.null()),
  stage: founderHandoffStageValidator,
  deliveredAt: v.number(),
  openedAt: v.union(v.number(), v.null()),
  emailStatus: v.union(
    v.literal("queued"),
    v.literal("sent"),
    v.literal("failed"),
    v.null()
  ),
})

export default defineSchema({
  principals: defineTable({
    subject: v.string(),
    organizationId: v.string(),
    role: workspaceRoleValidator,
    kind: v.optional(
      v.union(v.literal("human"), v.literal("agent"), v.literal("system"))
    ),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_organization_subject", ["organizationId", "subject"])
    .index("by_organization_role", ["organizationId", "role"]),
  people: defineTable({
    organizationId: v.string(),
    displayName: v.string(),
    normalizedDisplayName: v.string(),
    email: v.string(),
    normalizedEmail: v.string(),
    searchText: v.string(),
    principalId: v.optional(v.id("principals")),
    isFounder: v.boolean(),
    createdByPrincipalId: v.optional(v.id("principals")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_email", ["organizationId", "normalizedEmail"])
    .index("by_organization_created_at", ["organizationId", "createdAt"])
    .index("by_organization_founder_created_at", [
      "organizationId",
      "isFounder",
      "createdAt",
    ])
    .index("by_principal", ["principalId"])
    .searchIndex("search_directory", {
      searchField: "searchText",
      filterFields: ["organizationId"],
    }),
  personOperations: defineTable({
    organizationId: v.string(),
    actorPrincipalId: v.id("principals"),
    correlationId: v.string(),
    inputFingerprint: v.string(),
    personId: v.id("people"),
    createdAt: v.number(),
  }).index("by_organization_actor_correlation", [
    "organizationId",
    "actorPrincipalId",
    "correlationId",
  ]),
  contentRequests: defineTable({
    humanId: v.string(),
    organizationId: v.string(),
    title: v.string(),
    normalizedTitle: v.string(),
    searchText: v.string(),
    queueSortKey: v.optional(v.string()),
    aliases: v.array(v.string()),
    requestType: v.optional(contentRequestTypeValidator),
    origin: requestOriginValidator,
    priority: requestPriorityValidator,
    lifecycle: requestLifecycleValidator,
    disposition: requestDispositionValidator,
    retention: requestRetentionValidator,
    expiresAt: v.optional(v.number()),
    autoExpirationDueAt: v.optional(v.number()),
    expirationDispatchToken: v.optional(v.string()),
    expirationOriginalDueAt: v.optional(v.number()),
    expiredAt: v.optional(v.number()),
    expirationReason: v.optional(v.string()),
    expirationReviewRequiredAt: v.optional(v.number()),
    activeVoiceCaptureCount: v.optional(v.number()),
    voiceCaptureCountGeneration: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    archiveTransitionToken: v.optional(v.string()),
    archiveTransitionMode: v.optional(
      v.union(v.literal("archive"), v.literal("restore"))
    ),
    archiveTransitionMarker: v.optional(v.number()),
    archiveTransitionPendingResources: v.optional(v.number()),
    archiveTransitionHasOverflowTargets: v.optional(v.boolean()),
    parentRequestId: v.optional(v.id("contentRequests")),
    followUpReason: v.optional(v.string()),
    aggregateVersion: v.number(),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    normalizedSourceUrl: v.optional(v.string()),
    latestIngestionRunId: v.optional(v.id("ingestionRuns")),
    timingLabel: v.optional(v.string()),
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
    .index("by_auto_expiration_due_at", ["autoExpirationDueAt"])
    .index("by_parent_created_at", ["parentRequestId", "createdAt"])
    .index("by_organization_normalized_source_url", [
      "organizationId",
      "normalizedSourceUrl",
    ])
    .index("by_organization_queue_sort", ["organizationId", "queueSortKey"])
    .index("by_organization_retention_disposition_queue_sort", [
      "organizationId",
      "retention",
      "disposition",
      "queueSortKey",
    ])
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
  expertInterviews: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    brief: expertInterviewBriefValidator,
    gaps: v.array(expertInterviewGapValidator),
    questions: v.array(expertInterviewQuestionValidator),
    operatorInstructions: v.optional(v.string()),
    createdByPrincipalId: v.id("principals"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_request", ["requestId"]),
  sourceSnapshots: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    question: v.optional(v.string()),
    body: v.optional(v.string()),
    url: v.optional(v.string()),
    name: v.optional(v.string()),
    channel: v.optional(v.string()),
    rawOpportunityMarkdown: v.optional(v.string()),
    captureKind: v.optional(
      v.union(v.literal("automated_primary"), v.literal("manual_supplemental"))
    ),
    capturedByPrincipalId: v.id("principals"),
    capturedAt: v.number(),
  }).index("by_request", ["requestId"]),
  ingestionRuns: defineTable({
    organizationId: v.string(),
    reportIdentity: v.string(),
    idempotencyKey: v.string(),
    reportHash: v.string(),
    rawMarkdown: v.string(),
    demandLedgerMarkdown: v.string(),
    parserVersion: v.string(),
    status: v.literal("applied"),
    createdByPrincipalId: v.id("principals"),
    createdAt: v.number(),
    result: v.object({
      created: v.number(),
      updated: v.number(),
      manualPreserved: v.number(),
      requestHumanIds: v.array(v.string()),
    }),
  })
    .index("by_organization_idempotency", ["organizationId", "idempotencyKey"])
    .index("by_organization_report_identity", [
      "organizationId",
      "reportIdentity",
    ]),
  ingestionItems: defineTable({
    organizationId: v.string(),
    ingestionRunId: v.id("ingestionRuns"),
    requestId: v.id("contentRequests"),
    sourceKey: v.string(),
    itemId: v.string(),
    action: v.union(
      v.literal("created"),
      v.literal("updated"),
      v.literal("manual_preserved")
    ),
    createdAt: v.number(),
  })
    .index("by_ingestion_run", ["ingestionRunId"])
    .index("by_request", ["requestId"]),
  contextItems: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    kind: v.union(
      v.literal("source_metadata"),
      v.literal("source_summary"),
      v.literal("talking_points"),
      v.literal("research_requirements"),
      v.literal("missing_research"),
      v.literal("citations"),
      v.literal("guardrails"),
      v.literal("operator_cue"),
      v.literal("delivery_hint")
    ),
    title: v.string(),
    bulletPoints: v.array(v.string()),
    citations: v.array(
      v.object({ label: v.string(), url: v.string(), supports: v.string() })
    ),
    ingestionRunId: v.optional(v.id("ingestionRuns")),
    updatedByPrincipalId: v.optional(v.id("principals")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_request_kind", ["requestId", "kind"]),
  contextItemVersions: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    contextItemId: v.id("contextItems"),
    ordinal: v.number(),
    kind: v.union(
      v.literal("source_metadata"),
      v.literal("source_summary"),
      v.literal("talking_points"),
      v.literal("research_requirements"),
      v.literal("missing_research"),
      v.literal("citations"),
      v.literal("guardrails"),
      v.literal("operator_cue"),
      v.literal("delivery_hint")
    ),
    title: v.string(),
    bulletPoints: v.array(v.string()),
    citations: v.array(
      v.object({ label: v.string(), url: v.string(), supports: v.string() })
    ),
    actorPrincipalId: v.id("principals"),
    credentialId: v.string(),
    correlationId: v.string(),
    createdAt: v.number(),
  }).index("by_context_ordinal", ["contextItemId", "ordinal"]),
  contextOperations: defineTable({
    organizationId: v.string(),
    actorPrincipalId: v.id("principals"),
    requestId: v.id("contentRequests"),
    correlationId: v.string(),
    inputFingerprint: v.string(),
    contextItemId: v.id("contextItems"),
    versionId: v.id("contextItemVersions"),
  }).index("by_organization_actor_correlation", [
    "organizationId",
    "actorPrincipalId",
    "correlationId",
  ]),
  contextDeckPreferences: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    principalId: v.id("principals"),
    visibleContextIds: v.array(v.string()),
    pinnedContextIds: v.array(v.string()),
    knownContextIds: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_request_principal", ["requestId", "principalId"]),
  founderInputDocuments: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    founderPrincipalId: v.id("principals"),
    text: v.string(),
    revision: v.number(),
    hasMeaningfulDraft: v.boolean(),
    automergeDocumentId: v.optional(v.string()),
    durableHeads: v.optional(v.array(v.string())),
    lastSyncedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_request", ["requestId"]),
  automergeChanges: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    documentId: v.string(),
    hash: v.string(),
    data: v.string(),
    actorPrincipalId: v.id("principals"),
    correlationId: v.string(),
    createdAt: v.number(),
  })
    .index("by_document_created_at", ["documentId", "createdAt"])
    .index("by_document_hash", ["documentId", "hash"]),
  automergeDocuments: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    founderPrincipalId: v.id("principals"),
    documentId: v.string(),
    createdAt: v.number(),
  })
    .index("by_document_id", ["documentId"])
    .index("by_request", ["requestId"]),
  founderInputSaveOperations: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    actorPrincipalId: v.id("principals"),
    correlationId: v.string(),
    inputFingerprint: v.string(),
    createdAt: v.number(),
  }).index("by_organization_actor_correlation", [
    "organizationId",
    "actorPrincipalId",
    "correlationId",
  ]),
  founderInputTimelineOperations: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    documentId: v.id("founderInputDocuments"),
    actorPrincipalId: v.id("principals"),
    direction: v.union(v.literal("undo"), v.literal("redo")),
    correlationId: v.string(),
    result: v.object({
      text: v.string(),
      revision: v.number(),
      hasMeaningfulDraft: v.boolean(),
      automergeDocumentId: v.optional(v.string()),
      durableHeads: v.array(v.string()),
      lastSyncedAt: v.optional(v.number()),
      updatedAt: v.number(),
    }),
    createdAt: v.number(),
  }).index("by_organization_actor_correlation", [
    "organizationId",
    "actorPrincipalId",
    "correlationId",
  ]),
  founderInputVersions: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    documentId: v.id("founderInputDocuments"),
    text: v.string(),
    heads: v.array(v.string()),
    revision: v.number(),
    actorPrincipalId: v.id("principals"),
    actorSubject: v.string(),
    correlationId: v.string(),
    occurredAt: v.number(),
  })
    .index("by_request_occurred_at", ["requestId", "occurredAt"])
    .index("by_request_correlation", ["requestId", "correlationId"]),
  founderSubmissions: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    documentId: v.id("founderInputDocuments"),
    founderVersionId: v.id("founderInputVersions"),
    founderPrincipalId: v.id("principals"),
    correlationId: v.string(),
    submittedAt: v.number(),
  }).index("by_request", ["requestId"]),
  founderExpertSubmissions: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    requestHumanId: v.string(),
    founderPrincipalId: v.id("principals"),
    founderVersionId: v.id("founderInputVersions"),
    canonicalSubmissionId: v.optional(v.string()),
    respondentDisplayName: v.string(),
    respondentEmail: v.string(),
    workspaceRevision: v.number(),
    batchText: v.string(),
    questions: v.array(
      v.object({
        questionId: v.string(),
        question: v.string(),
        motivation: v.string(),
        position: v.number(),
        version: v.number(),
      })
    ),
    correlationId: v.string(),
    submittedAt: v.number(),
  })
    .index("by_request_submitted_at", ["requestId", "submittedAt"])
    .index("by_founder_version", ["founderVersionId"]),
  agentJobs: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    requestTitle: v.string(),
    type: v.literal("primary_response"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("retry_wait"),
      v.literal("failed"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    founderVersionId: v.id("founderInputVersions"),
    contextSnapshot: v.array(
      v.object({
        kind: v.string(),
        title: v.string(),
        bulletPoints: v.array(v.string()),
        citations: v.array(
          v.object({ label: v.string(), url: v.string(), supports: v.string() })
        ),
      })
    ),
    attempts: v.number(),
    maxAttempts: v.number(),
    leaseGeneration: v.number(),
    nextAttemptAt: v.optional(v.number()),
    claimableAt: v.optional(v.number()),
    reapableAt: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    claimedByPrincipalId: v.optional(v.id("principals")),
    resultVersionId: v.optional(v.id("deliverableVersions")),
    lastErrorCode: v.optional(v.string()),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancellationReason: v.optional(v.string()),
    pausedJobStatus: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("retry_wait")
      )
    ),
    pausedWithRequestAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_organization_status_created_at", [
      "organizationId",
      "status",
      "createdAt",
    ])
    .index("by_organization_created_at", ["organizationId", "createdAt"])
    .index("by_status_created_at", ["status", "createdAt"])
    .index("by_status_reapable_at", ["status", "reapableAt"])
    .index("by_organization_claimable_at_created_at", [
      "organizationId",
      "claimableAt",
      "createdAt",
    ])
    .index("by_organization_lease_token", ["organizationId", "leaseToken"])
    .index("by_request", ["requestId"])
    .index("by_request_created_at", ["requestId", "createdAt"]),
  agentJobLeaseEvents: defineTable({
    organizationId: v.string(),
    jobId: v.id("agentJobs"),
    requestId: v.id("contentRequests"),
    actorPrincipalId: v.id("principals"),
    event: v.union(
      v.literal("claimed"),
      v.literal("reclaimed"),
      v.literal("heartbeat"),
      v.literal("expired_failure")
    ),
    leaseGeneration: v.number(),
    leaseExpiresAt: v.optional(v.number()),
    occurredAt: v.number(),
  }).index("by_job_occurred_at", ["jobId", "occurredAt"]),
  agentJobFailureOperations: defineTable({
    organizationId: v.string(),
    jobId: v.id("agentJobs"),
    actorPrincipalId: v.id("principals"),
    correlationId: v.string(),
    inputFingerprint: v.string(),
    resultStatus: v.union(v.literal("retry_wait"), v.literal("failed")),
    createdAt: v.number(),
  }).index("by_organization_actor_correlation", [
    "organizationId",
    "actorPrincipalId",
    "correlationId",
  ]),
  deliverables: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    kind: v.string(),
    name: v.string(),
    isPrimary: v.boolean(),
    retention: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    archivedWithRequestAt: v.optional(v.number()),
    currentCandidateVersionId: v.optional(v.id("deliverableVersions")),
    promotedVersionId: v.optional(v.id("deliverableVersions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_request", ["requestId"]),
  deliverableVersions: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    deliverableId: v.id("deliverables"),
    body: v.string(),
    ordinal: v.number(),
    createdByPrincipalId: v.id("principals"),
    sourceJobId: v.optional(v.id("agentJobs")),
    correlationId: v.optional(v.string()),
    changeSummary: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_deliverable_ordinal", ["deliverableId", "ordinal"])
    .index("by_source_job", ["sourceJobId"]),
  deliverablePromotionEvents: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    deliverableId: v.id("deliverables"),
    versionId: v.id("deliverableVersions"),
    previousVersionId: v.optional(v.id("deliverableVersions")),
    expectedPromotedVersionId: v.optional(v.id("deliverableVersions")),
    actorPrincipalId: v.id("principals"),
    credentialId: v.string(),
    operation: v.union(v.literal("promoted"), v.literal("auto_promoted")),
    correlationId: v.string(),
    occurredAt: v.number(),
  })
    .index("by_deliverable_occurred_at", ["deliverableId", "occurredAt"])
    .index("by_organization_actor_correlation", [
      "organizationId",
      "actorPrincipalId",
      "correlationId",
    ]),
  deliverableOperations: defineTable({
    organizationId: v.string(),
    actorPrincipalId: v.id("principals"),
    requestId: v.id("contentRequests"),
    operation: v.union(
      v.literal("create_derivative"),
      v.literal("create_version"),
      v.literal("set_primary")
    ),
    correlationId: v.string(),
    inputFingerprint: v.string(),
    deliverableId: v.id("deliverables"),
    versionId: v.optional(v.id("deliverableVersions")),
    createdAt: v.number(),
  }).index("by_organization_actor_operation_correlation", [
    "organizationId",
    "actorPrincipalId",
    "operation",
    "correlationId",
  ]),
  primaryDeliverableEvents: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    previousDeliverableId: v.id("deliverables"),
    newDeliverableId: v.id("deliverables"),
    actorPrincipalId: v.id("principals"),
    credentialId: v.string(),
    correlationId: v.string(),
    occurredAt: v.number(),
  }).index("by_request_occurred_at", ["requestId", "occurredAt"]),
  followUpOperations: defineTable({
    organizationId: v.string(),
    parentRequestId: v.id("contentRequests"),
    childRequestId: v.id("contentRequests"),
    actorPrincipalId: v.id("principals"),
    correlationId: v.string(),
    inputFingerprint: v.string(),
    createdAt: v.number(),
  }).index("by_organization_actor_correlation", [
    "organizationId",
    "actorPrincipalId",
    "correlationId",
  ]),
  deliveryTargets: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    deliverableId: v.id("deliverables"),
    channel: v.string(),
    destinationLabel: v.string(),
    destinationUrl: v.optional(v.string()),
    isOriginal: v.boolean(),
    isRequired: v.boolean(),
    retention: v.union(v.literal("active"), v.literal("archived")),
    archivedWithRequestAt: v.optional(v.number()),
    currentReceiptId: v.optional(v.id("deliveryReceipts")),
    hasHistoricalReceipt: v.optional(v.boolean()),
    createdByPrincipalId: v.id("principals"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_request", ["requestId"])
    .index("by_request_retention", ["requestId", "retention"])
    .index("by_deliverable", ["deliverableId"]),
  founderHandoffs: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    recipientPrincipalId: v.id("principals"),
    selectedFormats: v.array(founderHandoffFormatValidator),
    note: v.optional(v.string()),
    state: v.union(v.literal("active"), v.literal("ended")),
    notificationId: v.optional(v.id("notifications")),
    createdByPrincipalId: v.id("principals"),
    correlationId: v.string(),
    deliveredAt: v.number(),
    openedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_request_state", ["requestId", "state"])
    .index("by_request_created_at", ["requestId", "createdAt"])
    .index("by_organization_creator_correlation", [
      "organizationId",
      "createdByPrincipalId",
      "correlationId",
    ]),
  operatorWorkspaceItems: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    humanId: v.string(),
    normalizedTitle: v.string(),
    searchText: v.string(),
    active: v.boolean(),
    retained: v.boolean(),
    manualCritical: v.boolean(),
    orderBucket: v.string(),
    queue: v.union(
      v.literal("needs_elie"),
      v.literal("agent_drafting"),
      v.literal("needs_operator"),
      v.literal("delivered"),
      v.literal("attention_required")
    ),
    priority: requestPriorityValidator,
    origin: requestOriginValidator,
    lifecycle: requestLifecycleValidator,
    disposition: requestDispositionValidator,
    assigneePrincipalId: v.id("principals"),
    founderHandoff: v.optional(founderHandoffStatusValidator),
    agentJobStatus: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("retry_wait"),
        v.literal("failed"),
        v.literal("completed"),
        v.literal("cancelled")
      )
    ),
    requiredDeliveryConfirmed: v.number(),
    requiredDeliveryTotal: v.number(),
    openConflictCount: v.number(),
    attentionReasonCount: v.number(),
    attentionReasons: v.array(v.string()),
    deliveryChannels: v.array(v.string()),
    searchRepairGeneration: v.optional(v.number()),
    sortKey: v.string(),
    nextActionChangedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_request", ["requestId"])
    .index("by_organization_human_id", ["organizationId", "humanId"])
    .index("by_organization_normalized_title", [
      "organizationId",
      "normalizedTitle",
    ])
    .index("by_organization_normalized_title_retained_disposition_sort", [
      "organizationId",
      "normalizedTitle",
      "retained",
      "disposition",
      "sortKey",
    ])
    .index("by_organization_active_sort", [
      "organizationId",
      "active",
      "sortKey",
    ])
    .index("by_organization_active_queue_sort", [
      "organizationId",
      "active",
      "queue",
      "sortKey",
    ])
    .searchIndex("search_workspace", {
      searchField: "searchText",
      filterFields: [
        "organizationId",
        "active",
        "retained",
        "manualCritical",
        "orderBucket",
        "queue",
        "priority",
        "origin",
        "lifecycle",
        "disposition",
        "assigneePrincipalId",
      ],
    }),
  operatorWorkspaceSearchRows: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    humanId: v.string(),
    normalizedTitle: v.string(),
    searchText: v.string(),
    channelKey: v.string(),
    active: v.boolean(),
    retained: v.boolean(),
    manualCritical: v.boolean(),
    orderBucket: v.string(),
    queue: v.union(
      v.literal("needs_elie"),
      v.literal("agent_drafting"),
      v.literal("needs_operator"),
      v.literal("delivered"),
      v.literal("attention_required")
    ),
    priority: requestPriorityValidator,
    origin: requestOriginValidator,
    lifecycle: requestLifecycleValidator,
    disposition: requestDispositionValidator,
    assigneePrincipalId: v.id("principals"),
    sortKey: v.string(),
    updatedAt: v.number(),
  })
    .index("by_request", ["requestId"])
    .searchIndex("search_workspace_rows", {
      searchField: "searchText",
      filterFields: [
        "organizationId",
        "channelKey",
        "active",
        "retained",
        "manualCritical",
        "orderBucket",
        "queue",
        "priority",
        "origin",
        "lifecycle",
        "disposition",
        "assigneePrincipalId",
        "normalizedTitle",
      ],
    }),
  deliveryReceipts: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    targetId: v.id("deliveryTargets"),
    deliverableId: v.id("deliverables"),
    versionId: v.id("deliverableVersions"),
    channel: v.string(),
    destinationLabel: v.string(),
    destinationUrl: v.optional(v.string()),
    note: v.optional(v.string()),
    confirmedByPrincipalId: v.id("principals"),
    credentialId: v.string(),
    confirmationMethod: v.union(v.literal("human"), v.literal("integration")),
    integrationIdentity: v.optional(v.string()),
    externalReceiptId: v.optional(v.string()),
    respondedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_target_responded_at", ["targetId", "respondedAt"])
    .index("by_request_responded_at", ["requestId", "respondedAt"]),
  deliveryReceiptEvents: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    targetId: v.id("deliveryTargets"),
    receiptId: v.id("deliveryReceipts"),
    event: v.union(v.literal("confirmed"), v.literal("reopened")),
    actorPrincipalId: v.id("principals"),
    credentialId: v.string(),
    correlationId: v.string(),
    occurredAt: v.number(),
  }).index("by_target_occurred_at", ["targetId", "occurredAt"]),
  integrationDeliverySuccesses: defineTable({
    organizationId: v.string(),
    targetId: v.id("deliveryTargets"),
    versionId: v.id("deliverableVersions"),
    provider: v.string(),
    integrationIdentity: v.string(),
    externalReceiptId: v.string(),
    succeededAt: v.number(),
    recordedAt: v.number(),
    consumedByReceiptId: v.optional(v.id("deliveryReceipts")),
  }).index("by_target_external_receipt", ["targetId", "externalReceiptId"]),
  deliveryOperations: defineTable({
    organizationId: v.string(),
    actorPrincipalId: v.id("principals"),
    operation: v.union(
      v.literal("create_target"),
      v.literal("set_required"),
      v.literal("set_retention"),
      v.literal("confirm"),
      v.literal("reopen")
    ),
    correlationId: v.string(),
    inputFingerprint: v.string(),
    targetId: v.id("deliveryTargets"),
    receiptId: v.optional(v.id("deliveryReceipts")),
    createdAt: v.number(),
  }).index("by_organization_actor_operation_correlation", [
    "organizationId",
    "actorPrincipalId",
    "operation",
    "correlationId",
  ]),
  publicShares: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    tokenHash: v.string(),
    requestSnapshot: v.object({
      humanId: v.string(),
      title: v.string(),
      priority: v.string(),
      createdAt: v.number(),
    }),
    briefSections: v.array(
      v.object({
        contextItemId: v.id("contextItems"),
        kind: v.string(),
        title: v.string(),
        bulletPoints: v.array(v.string()),
        citations: v.array(
          v.object({ label: v.string(), url: v.string(), supports: v.string() })
        ),
      })
    ),
    deliverables: v.array(
      v.object({
        deliverableId: v.id("deliverables"),
        versionId: v.id("deliverableVersions"),
        kind: v.string(),
        name: v.string(),
        body: v.string(),
      })
    ),
    expiresAt: v.optional(v.number()),
    active: v.boolean(),
    revokedAt: v.optional(v.number()),
    createdByPrincipalId: v.id("principals"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_request_active_created_at", ["requestId", "active", "createdAt"])
    .index("by_request_created_at", ["requestId", "createdAt"]),
  publicShareAccesses: defineTable({
    shareId: v.id("publicShares"),
    hourBucket: v.number(),
    count: v.number(),
    firstAccessedAt: v.number(),
    lastAccessedAt: v.number(),
  }).index("by_share_hour_bucket", ["shareId", "hourBucket"]),
  publicShareOperations: defineTable({
    organizationId: v.string(),
    actorPrincipalId: v.id("principals"),
    correlationId: v.string(),
    inputFingerprint: v.string(),
    shareId: v.id("publicShares"),
    createdAt: v.number(),
  }).index("by_organization_actor_correlation", [
    "organizationId",
    "actorPrincipalId",
    "correlationId",
  ]),
  guestAccessGrants: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    assignedPersonId: v.id("people"),
    currentTokenHash: v.string(),
    tokenVersion: v.number(),
    expiresAt: v.number(),
    state: v.union(
      v.literal("generated"),
      v.literal("opened"),
      v.literal("in_progress"),
      v.literal("submitted"),
      v.literal("revoked")
    ),
    createdByPrincipalId: v.id("principals"),
    createdAt: v.number(),
    updatedAt: v.number(),
    latestActivityAt: v.number(),
    firstOpenedAt: v.optional(v.number()),
    firstProgressAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token_hash", ["currentTokenHash"])
    .index("by_request_created_at", ["requestId", "createdAt"])
    .index("by_person_created_at", ["assignedPersonId", "createdAt"])
    .index("by_state_expiry", ["state", "expiresAt"]),
  guestAccessLifecycleOperations: defineTable({
    organizationId: v.string(),
    actorPrincipalId: v.id("principals"),
    grantId: v.id("guestAccessGrants"),
    operation: v.union(v.literal("revoke"), v.literal("renew")),
    correlationId: v.string(),
    inputFingerprint: v.string(),
    resultTokenVersion: v.number(),
    resultExpiresAt: v.number(),
    resultGrant: v.optional(guestAccessOperationGrantResultValidator),
    createdAt: v.number(),
  }).index("by_organization_actor_correlation", [
    "organizationId",
    "actorPrincipalId",
    "correlationId",
  ]),
  guestAccessEvents: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    grantId: v.id("guestAccessGrants"),
    kind: v.union(
      v.literal("expired"),
      v.literal("revoked"),
      v.literal("renewed")
    ),
    actorPrincipalId: v.optional(v.id("principals")),
    credentialId: v.optional(v.string()),
    tokenVersion: v.number(),
    correlationId: v.string(),
    occurredAt: v.number(),
  }).index("by_grant_occurred_at", ["grantId", "occurredAt"]),
  responseWorkspaces: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    grantId: v.id("guestAccessGrants"),
    answerMode: v.union(v.literal("batch"), v.literal("one_by_one")),
    batchText: v.string(),
    questionAnswers: v.array(
      v.object({ questionId: v.string(), text: v.string() })
    ),
    retiredQuestionAnswers: v.optional(
      v.array(
        v.object({
          questionId: v.string(),
          text: v.string(),
          retiredAt: v.number(),
        })
      )
    ),
    revision: v.number(),
    leaseHolderHash: v.optional(v.string()),
    leaseGeneration: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    lockedAt: v.optional(v.number()),
    latestSubmissionId: v.optional(v.id("responseSubmissions")),
    pendingRequiredOperationIds: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_grant", ["grantId"])
    .index("by_request_updated_at", ["requestId", "updatedAt"]),
  responseWorkspaceOperations: defineTable({
    workspaceId: v.id("responseWorkspaces"),
    operationId: v.string(),
    inputFingerprint: v.string(),
    resultRevision: v.number(),
    resultJson: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_workspace_operation", ["workspaceId", "operationId"]),
  responseWorkspaceLeaseOperations: defineTable({
    workspaceId: v.id("responseWorkspaces"),
    operationId: v.string(),
    kind: v.union(
      v.literal("acquire"),
      v.literal("heartbeat"),
      v.literal("takeover")
    ),
    inputFingerprint: v.string(),
    resultStatus: v.union(v.literal("editing"), v.literal("conflict")),
    resultGeneration: v.number(),
    resultExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_workspace_operation", ["workspaceId", "operationId"]),
  responseWorkspaceEvents: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    grantId: v.id("guestAccessGrants"),
    workspaceId: v.id("responseWorkspaces"),
    kind: v.union(
      v.literal("lease_acquired"),
      v.literal("lease_taken_over"),
      v.literal("first_progress"),
      v.literal("submitted"),
      v.literal("feedback_added"),
      v.literal("reopened")
    ),
    leaseGeneration: v.number(),
    operationId: v.string(),
    actorGrantId: v.optional(v.id("guestAccessGrants")),
    actorPrincipalId: v.optional(v.id("principals")),
    credentialId: v.optional(v.string()),
    submissionId: v.optional(v.id("responseSubmissions")),
    feedbackId: v.optional(v.id("responseFeedback")),
    occurredAt: v.number(),
  }).index("by_grant_occurred_at", ["grantId", "occurredAt"]),
  responseSubmissions: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    requestHumanId: v.string(),
    grantId: v.id("guestAccessGrants"),
    workspaceId: v.id("responseWorkspaces"),
    assignedPersonId: v.id("people"),
    respondentDisplayName: v.string(),
    respondentEmail: v.string(),
    workspaceRevision: v.number(),
    answerMode: v.union(v.literal("batch"), v.literal("one_by_one")),
    selectedAnswerMode: v.optional(
      v.union(v.literal("batch"), v.literal("one_by_one"))
    ),
    selectionMethod: v.optional(
      v.union(
        v.literal("single_mode"),
        v.literal("respondent_choice"),
        v.literal("legacy_workspace_mode")
      )
    ),
    batchText: v.string(),
    questionAnswers: v.array(
      v.object({ questionId: v.string(), text: v.string() })
    ),
    questions: v.array(
      v.object({
        questionId: v.string(),
        question: v.string(),
        motivation: v.string(),
        position: v.number(),
        version: v.number(),
      })
    ),
    assetSnapshots: v.optional(
      v.array(
        v.object({
          assetId: v.id("responseAssets"),
          version: v.number(),
          transcriptVersion: v.number(),
          kind: v.union(v.literal("audio"), v.literal("attachment")),
          scope: v.union(
            v.object({ kind: v.literal("batch") }),
            v.object({
              kind: v.literal("question"),
              questionId: v.string(),
            })
          ),
        })
      )
    ),
    submittedAt: v.number(),
  })
    .index("by_workspace_submitted_at", ["workspaceId", "submittedAt"])
    .index("by_request_submitted_at", ["requestId", "submittedAt"]),
  expertSynthesisSelectionDecisions: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    submissionId: v.string(),
    included: v.boolean(),
    actorPrincipalId: v.id("principals"),
    actorDisplayName: v.string(),
    credentialId: v.string(),
    correlationId: v.string(),
    inputFingerprint: v.string(),
    decidedAt: v.number(),
  })
    .index("by_request_decided_at", ["requestId", "decidedAt"])
    .index("by_submission_decided_at", ["submissionId", "decidedAt"])
    .index("by_organization_actor_correlation", [
      "organizationId",
      "actorPrincipalId",
      "correlationId",
    ]),
  expertSynthesisProcessingSnapshots: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    requestHumanId: v.string(),
    submissionIds: v.array(v.string()),
    contextVersionIds: v.array(v.id("contextItemVersions")),
    expertInterviewUpdatedAt: v.number(),
    synthesisInstructions: v.optional(v.string()),
    canonicalBundle: v.string(),
    payloadDigest: v.string(),
    actorPrincipalId: v.id("principals"),
    credentialId: v.string(),
    correlationId: v.optional(v.string()),
    inputFingerprint: v.optional(v.string()),
    issuedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_request_issued_at", ["requestId", "issuedAt"])
    .index("by_request_digest", ["requestId", "payloadDigest"])
    .index("by_organization_actor_correlation", [
      "organizationId",
      "actorPrincipalId",
      "correlationId",
    ]),
  expertSynthesisProvenance: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    deliverableId: v.id("deliverables"),
    versionId: v.id("deliverableVersions"),
    processingSnapshotId: v.id("expertSynthesisProcessingSnapshots"),
    submissionIds: v.array(v.string()),
    contextVersionIds: v.array(v.id("contextItemVersions")),
    payloadDigest: v.string(),
    canonicalBundle: v.string(),
    completionDeliverable: v.object({
      deliverableId: v.id("deliverables"),
      requestHumanId: v.string(),
      kind: v.string(),
      name: v.string(),
      isPrimary: v.boolean(),
      currentCandidateVersionId: v.union(v.id("deliverableVersions"), v.null()),
      promotedVersionId: v.union(v.id("deliverableVersions"), v.null()),
      versions: v.array(
        v.object({
          versionId: v.id("deliverableVersions"),
          bodyDigest: v.string(),
          ordinal: v.number(),
          createdByPrincipalId: v.id("principals"),
          sourceJobId: v.union(v.id("agentJobs"), v.null()),
          changeSummary: v.union(v.string(), v.null()),
          createdAt: v.number(),
        })
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    actorPrincipalId: v.id("principals"),
    credentialId: v.string(),
    correlationId: v.string(),
    inputFingerprint: v.string(),
    createdAt: v.number(),
  })
    .index("by_version", ["versionId"])
    .index("by_request_created_at", ["requestId", "createdAt"])
    .index("by_organization_actor_correlation", [
      "organizationId",
      "actorPrincipalId",
      "correlationId",
    ]),
  responseFeedback: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    grantId: v.id("guestAccessGrants"),
    workspaceId: v.id("responseWorkspaces"),
    scope: v.union(
      v.object({ kind: v.literal("workspace") }),
      v.object({
        kind: v.literal("question"),
        questionId: v.string(),
      }),
      v.object({
        kind: v.literal("asset"),
        assetId: v.id("responseAssets"),
      })
    ),
    body: v.string(),
    authorPrincipalId: v.id("principals"),
    authorDisplayName: v.string(),
    credentialId: v.string(),
    createdAt: v.number(),
  }).index("by_workspace_created_at", ["workspaceId", "createdAt"]),
  responseAssets: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    grantId: v.id("guestAccessGrants"),
    workspaceId: v.id("responseWorkspaces"),
    clientAssetId: v.string(),
    kind: v.union(v.literal("audio"), v.literal("attachment")),
    scope: v.union(
      v.object({ kind: v.literal("batch") }),
      v.object({
        kind: v.literal("question"),
        questionId: v.string(),
      })
    ),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    storageId: v.optional(v.id("_storage")),
    uploadState: v.union(
      v.literal("uploading"),
      v.literal("uploaded"),
      v.literal("failed"),
      v.literal("discarded")
    ),
    transcriptionState: v.union(
      v.literal("not_applicable"),
      v.literal("queued"),
      v.literal("transcribing"),
      v.literal("transcribed"),
      v.literal("failed"),
      v.literal("discarded")
    ),
    transcript: v.optional(v.string()),
    transcriptVersion: v.number(),
    failureCode: v.optional(v.string()),
    transcriptionAttempt: v.number(),
    transcriptionLeaseExpiresAt: v.optional(v.number()),
    retryHistory: v.array(
      v.object({
        stage: v.union(v.literal("upload"), v.literal("transcription")),
        attempt: v.number(),
        outcome: v.union(
          v.literal("started"),
          v.literal("succeeded"),
          v.literal("failed")
        ),
        code: v.optional(v.string()),
        at: v.number(),
      })
    ),
    version: v.number(),
    submittedAt: v.optional(v.number()),
    discardedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_created_at", ["workspaceId", "createdAt"])
    .index("by_grant_created_at", ["grantId", "createdAt"])
    .index("by_grant_client_asset", ["grantId", "clientAssetId"])
    .index("by_storage", ["storageId"]),
  responseAssetUploadSessions: defineTable({
    workspaceId: v.id("responseWorkspaces"),
    assetId: v.id("responseAssets"),
    leaseGeneration: v.optional(v.number()),
    leaseHolderHash: v.optional(v.string()),
    operationId: v.string(),
    inputFingerprint: v.string(),
    uploadUrl: v.optional(v.string()),
    state: v.union(
      v.literal("issued"),
      v.literal("finalized"),
      v.literal("failed")
    ),
    storageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_asset_operation", ["assetId", "operationId"])
    .index("by_storage", ["storageId"]),
  responseAssetOperations: defineTable({
    workspaceId: v.id("responseWorkspaces"),
    assetId: v.id("responseAssets"),
    operationId: v.string(),
    kind: v.union(v.literal("retry_transcription"), v.literal("discard")),
    inputFingerprint: v.string(),
    resultVersion: v.number(),
    createdAt: v.number(),
  }).index("by_workspace_operation", ["workspaceId", "operationId"]),
  storageObjectClaims: defineTable({
    storageId: v.id("_storage"),
    ownerKind: v.union(v.literal("guest_evidence"), v.literal("founder_voice")),
    ownerId: v.string(),
    claimedAt: v.number(),
    deletedAt: v.optional(v.number()),
  }).index("by_storage", ["storageId"]),
  responseLifecycleOperations: defineTable({
    workspaceId: v.id("responseWorkspaces"),
    operationId: v.string(),
    kind: v.union(
      v.literal("submit"),
      v.literal("feedback"),
      v.literal("reopen")
    ),
    inputFingerprint: v.string(),
    resultRevision: v.number(),
    submissionId: v.optional(v.id("responseSubmissions")),
    feedbackId: v.optional(v.id("responseFeedback")),
    createdAt: v.number(),
  }).index("by_workspace_operation", ["workspaceId", "operationId"]),
  guestAccessOperations: defineTable({
    organizationId: v.string(),
    actorPrincipalId: v.id("principals"),
    correlationId: v.string(),
    inputFingerprint: v.string(),
    grantId: v.id("guestAccessGrants"),
    resultGrant: v.optional(guestAccessOperationGrantResultValidator),
    createdAt: v.number(),
  }).index("by_organization_actor_correlation", [
    "organizationId",
    "actorPrincipalId",
    "correlationId",
  ]),
  guestAccessAttempts: defineTable({
    tokenFingerprint: v.string(),
    networkSourceHash: v.string(),
    hourBucket: v.number(),
    count: v.number(),
    firstAttemptedAt: v.number(),
    lastAttemptedAt: v.number(),
  })
    .index("by_fingerprint_source_hour", [
      "tokenFingerprint",
      "networkSourceHash",
      "hourBucket",
    ])
    .index("by_fingerprint_hour", ["tokenFingerprint", "hourBucket"])
    .index("by_source_hour", ["networkSourceHash", "hourBucket"]),
  founderInputVersionRestoreOperations: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    documentId: v.id("founderInputDocuments"),
    versionId: v.id("founderInputVersions"),
    actorPrincipalId: v.id("principals"),
    correlationId: v.string(),
    result: v.object({
      text: v.string(),
      revision: v.number(),
      hasMeaningfulDraft: v.boolean(),
      automergeDocumentId: v.optional(v.string()),
      durableHeads: v.array(v.string()),
      lastSyncedAt: v.optional(v.number()),
      updatedAt: v.number(),
    }),
    createdAt: v.number(),
  }).index("by_organization_actor_correlation", [
    "organizationId",
    "actorPrincipalId",
    "correlationId",
  ]),
  founderVoiceCaptures: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    documentId: v.id("founderInputDocuments"),
    founderPrincipalId: v.id("principals"),
    clientCaptureId: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    sizeBytes: v.number(),
    durationMs: v.number(),
    recordedAt: v.optional(v.number()),
    status: v.union(
      v.literal("uploaded"),
      v.literal("transcribing"),
      v.literal("transcribed"),
      v.literal("failed")
    ),
    transcript: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    transcriptionLeaseExpiresAt: v.optional(v.number()),
    attempts: v.number(),
    retryAttemptCount: v.optional(v.number()),
    transcriptMergedAt: v.optional(v.number()),
    discardedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_document_created_at", ["documentId", "createdAt"])
    .index("by_request_created_at", ["requestId", "createdAt"])
    .index("by_storage", ["storageId"])
    .index("by_organization_founder_client", [
      "organizationId",
      "founderPrincipalId",
      "clientCaptureId",
    ]),
  migrationConflicts: defineTable({
    organizationId: v.string(),
    type: v.literal("normalized_source_url_collision"),
    requestId: v.id("contentRequests"),
    conflictingRequestId: v.id("contentRequests"),
    normalizedSourceUrl: v.string(),
    resolved: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_request_type", ["requestId", "type"])
    .index("by_request_resolved", ["requestId", "resolved"])
    .index("by_organization_resolved", ["organizationId", "resolved"]),
  semanticConflicts: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    field: v.union(
      v.literal("assigneePrincipalId"),
      v.literal("primaryDeliverableId"),
      v.literal("promotedVersionId")
    ),
    currentValue: v.string(),
    proposedValue: v.string(),
    expectedValue: v.string(),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdByPrincipalId: v.id("principals"),
    correlationId: v.string(),
    createdAt: v.number(),
    resolvedByPrincipalId: v.optional(v.id("principals")),
    resolvedValue: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_request_status", ["requestId", "status"])
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_organization_creator_correlation", [
      "organizationId",
      "createdByPrincipalId",
      "correlationId",
    ]),
  semanticConflictOperations: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    actorPrincipalId: v.id("principals"),
    operation: v.union(v.literal("propose_assignee"), v.literal("resolve")),
    correlationId: v.string(),
    expectedValue: v.optional(v.string()),
    proposedValue: v.optional(v.string()),
    selectedValue: v.optional(v.string()),
    sourceConflictId: v.optional(v.id("semanticConflicts")),
    watcherPrincipalIds: v.optional(v.array(v.id("principals"))),
    reason: v.optional(v.string()),
    conflictId: v.optional(v.id("semanticConflicts")),
    outcome: v.union(
      v.literal("applied"),
      v.literal("attention_required"),
      v.literal("resolved")
    ),
    createdAt: v.number(),
  }).index("by_organization_actor_correlation", [
    "organizationId",
    "actorPrincipalId",
    "correlationId",
  ]),
  auditEvents: defineTable({
    organizationId: v.string(),
    requestId: v.id("contentRequests"),
    requestHumanId: v.string(),
    actorPrincipalId: v.optional(v.id("principals")),
    actorGrantId: v.optional(v.id("guestAccessGrants")),
    credentialId: v.string(),
    operation: v.string(),
    correlationId: v.string(),
    occurredAt: v.number(),
    beforeVersion: v.optional(v.number()),
    afterVersion: v.number(),
    inputFingerprint: v.optional(v.string()),
    productMetric: v.optional(
      v.object({
        responseCompleted: v.boolean(),
        deliveryBeforeExpiration: v.optional(v.boolean()),
        agentDraftDelivered: v.boolean(),
        substantialOperatorRewrite: v.boolean(),
      })
    ),
  })
    .index("by_request_occurred_at", ["requestId", "occurredAt"])
    .index("by_request_operation_correlation", [
      "requestId",
      "operation",
      "correlationId",
    ])
    .index("by_organization_occurred_at", ["organizationId", "occurredAt"])
    .index("by_organization_actor_operation_correlation", [
      "organizationId",
      "actorPrincipalId",
      "operation",
      "correlationId",
    ]),
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
      v.literal("founder_handoff"),
      v.literal("critical_escalation"),
      v.literal("deadline_approaching"),
      v.literal("response_ready"),
      v.literal("drafting_failed"),
      v.literal("delivery_reopened"),
      v.literal("guest_submission"),
      v.literal("guest_expiry_approaching"),
      v.literal("guest_upload_failed")
    ),
    dedupeKey: v.optional(v.string()),
    grantId: v.optional(v.id("guestAccessGrants")),
    assetId: v.optional(v.id("responseAssets")),
    submissionId: v.optional(v.id("responseSubmissions")),
    deepLink: v.optional(v.string()),
    emailQueued: v.boolean(),
    emailStatus: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("failed")
    ),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
    suppressedAt: v.optional(v.number()),
  })
    .index("by_recipient_created_at", ["recipientPrincipalId", "createdAt"])
    .index("by_recipient_suppressed_created_at", [
      "recipientPrincipalId",
      "suppressedAt",
      "createdAt",
    ])
    .index("by_request_created_at", ["requestId", "createdAt"])
    .index("by_grant_type", ["grantId", "type"])
    .index("by_asset_type", ["assetId", "type"])
    .index("by_recipient_dedupe_key", ["recipientPrincipalId", "dedupeKey"]),
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
    sendCommittedAt: v.optional(v.number()),
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
