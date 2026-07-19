export type RequestOrigin =
  | "manual"
  | "automated_scout"
  | "chatgpt_app"
  | "cli"
  | "http_api"

export type RequestPriority = "critical" | "high" | "normal" | "low"

export type RequestLifecycle =
  | "pending"
  | "in_progress"
  | "founder_complete"
  | "ready_to_respond"
  | "responded"

export type RequestDisposition = "active" | "expired"
export type RequestRetention = "active" | "archived"

export type OriginalSource = {
  question?: string
  body?: string
  url?: string
  name?: string
  channel?: string
}

export type PrincipalSummary = {
  principalId: string
  subject: string
  role: "founder" | "operator_editor" | "agent_editor" | "administrator"
}

export type ContentRequest = {
  requestId: string
  humanId: string
  title: string
  aliases: Array<string>
  origin: RequestOrigin
  priority: RequestPriority
  timingLabel?: string | null
  lifecycle: RequestLifecycle
  disposition: RequestDisposition
  retention: RequestRetention
  retentionTransition?: "archiving" | "restoring" | null
  expiresAt: number | null
  expiredAt: number | null
  expirationReason: string | null
  expirationReviewRequiredAt: number | null
  archivedAt: number | null
  parentRequestHumanId: string | null
  aggregateVersion: number
  assignee: PrincipalSummary
  watchers: Array<PrincipalSummary>
  firstOpenedAt: number | null
  latestOpenedAt: number | null
  hasFounderDraft: boolean
  founderDraftUpdatedAt: number | null
  source: OriginalSource | null
  createdAt: number
  updatedAt: number
}

export type RequestCandidate = Pick<
  ContentRequest,
  "requestId" | "humanId" | "title" | "origin" | "priority" | "lifecycle"
> & { score: number }

export type RequestResolution =
  | {
      kind: "resolved"
      matchedBy: "exact_id" | "exact_title"
      request: ContentRequest
    }
  | { kind: "candidates"; candidates: Array<RequestCandidate> }
  | { kind: "not_found"; candidates: Array<never> }

export type CreateManualRequestInput = {
  title: string
  source?: OriginalSource
  aliases?: Array<string>
  correlationId: string
}

export type PersistManualRequestInput = CreateManualRequestInput & {
  origin: Exclude<RequestOrigin, "automated_scout">
}

export type AssignRequestInput = {
  humanId: string
  assigneePrincipalId: string
  watcherPrincipalIds?: Array<string>
  reason?: string
  correlationId: string
}

export type ContentNotification = {
  notificationId: string
  requestHumanId: string
  type:
    | "request_assigned"
    | "critical_escalation"
    | "deadline_approaching"
    | "response_ready"
    | "drafting_failed"
    | "delivery_reopened"
  emailQueued: boolean
  emailStatus: "queued" | "sent" | "failed"
  createdAt: number
  readAt: number | null
  deepLink: string
}

export type ContentContextKind =
  | "source_metadata"
  | "source_summary"
  | "talking_points"
  | "research_requirements"
  | "missing_research"
  | "citations"
  | "guardrails"
  | "operator_cue"
  | "delivery_hint"

export type ContentContextItem = {
  contextId: string
  kind: ContentContextKind
  title: string
  bulletPoints: Array<string>
  citations: Array<{ label: string; url: string; supports: string }>
}

export type ContextDeckPreferences = {
  visibleContextIds: Array<string>
  pinnedContextIds: Array<string>
  knownContextIds: Array<string>
}

export type FounderInputDocument = {
  documentId: string
  requestHumanId: string
  text: string
  revision: number
  hasMeaningfulDraft: boolean
  automergeDocumentId: string | null
  durableHeads: Array<string>
  lastSyncedAt: number | null
  updatedAt: number
}

export type FounderAutomergeChange = { hash: string; data: string }

export type FounderAutomergePull = {
  changes: Array<FounderAutomergeChange>
  durableHeads: Array<string>
  materializedText: string | null
}

export type FounderVersionHistory = {
  canUndo: boolean
  canRedo: boolean
  position: number | null
  length: number
  entries: Array<{
    position: number
    state: {
      actorPrincipalId: string
      actorSubject: string
      correlationId: string
      occurredAt: number
    }
  }>
}

export type FounderArchivedVersion = {
  versionId: string
  revision: number
  actorPrincipalId: string
  actorSubject: string
  correlationId: string
  occurredAt: number
}

export type FounderVersionArchivePage = {
  page: Array<FounderArchivedVersion>
  isDone: boolean
  continueCursor: string
}

export type FounderVoiceCapture = {
  captureId: string
  clientCaptureId: string
  mimeType: string
  sizeBytes: number
  durationMs: number
  recordedAt: number
  status: "uploaded" | "transcribing" | "transcribed" | "failed"
  transcript: string | null
  failureCode: string | null
  transcriptMergedAt: number | null
  discardedAt: number | null
  createdAt: number
  updatedAt: number
}

export type FinalizeFounderVoiceCaptureInput = {
  humanId: string
  clientCaptureId: string
  storageId: string
  mimeType: string
  sizeBytes: number
  durationMs: number
  recordedAt: number
  correlationId: string
}

export type AgentJob = {
  jobId: string
  requestHumanId: string
  status:
    | "queued"
    | "running"
    | "retry_wait"
    | "failed"
    | "completed"
    | "cancelled"
  attempts: number
  maxAttempts: number
  leaseGeneration: number
  leaseToken: string | null
  leaseExpiresAt: number | null
  sourceSnapshotId: string | null
  founderVersionId: string
  resultVersionId: string | null
  lastErrorCode: string | null
  createdAt: number
  updatedAt: number
}

export type AgentJobInput = {
  job: AgentJob
  source: {
    question: string | null
    body: string | null
    url: string | null
    name: string | null
    channel: string | null
  } | null
  founderInput: {
    versionId: string
    text: string
    heads: Array<string>
    revision: number
    occurredAt: number
  }
  context: Array<{
    kind: string
    title: string
    bulletPoints: Array<string>
    citations: Array<{ label: string; url: string; supports: string }>
  }>
}

export type DeliverableVersion = {
  versionId: string
  body: string
  ordinal: number
  createdByPrincipalId: string
  sourceJobId: string | null
  changeSummary: string | null
  createdAt: number
}

export type Deliverable = {
  deliverableId: string
  requestHumanId: string
  kind: string
  name: string
  isPrimary: boolean
  currentCandidateVersionId: string | null
  promotedVersionId: string | null
  versions: Array<DeliverableVersion>
  createdAt: number
  updatedAt: number
}

export type DeliveryReceipt = {
  receiptId: string
  versionId: string
  channel: string
  destinationLabel: string
  destinationUrl: string | null
  note: string | null
  confirmedByPrincipalId: string
  confirmationMethod: "human" | "integration"
  integrationIdentity: string | null
  externalReceiptId: string | null
  respondedAt: number
}

export type DeliveryTarget = {
  targetId: string
  requestHumanId: string
  deliverableId: string
  channel: string
  destinationLabel: string
  destinationUrl: string | null
  isOriginal: boolean
  isRequired: boolean
  retention: "active" | "archived"
  currentReceiptId: string | null
  currentReceipt: DeliveryReceipt | null
  receiptHistory: Array<DeliveryReceipt>
  createdAt: number
  updatedAt: number
}

export type DeliveryTargetPage = {
  page: Array<DeliveryTarget>
  nextCursor: string | null
}

export type PublicShareSummary = {
  shareId: string
  expiresAt: number | null
  revokedAt: number | null
  createdAt: number
  briefSectionCount: number
  deliverableCount: number
}

export type PublicShareView = {
  shareId: string
  request: {
    humanId: string
    title: string
    priority: string
    createdAt: number
  }
  briefSections: Array<{
    kind: string
    title: string
    bulletPoints: Array<string>
    citations: Array<{ label: string; url: string; supports: string }>
  }>
  deliverables: Array<{ kind: string; name: string; body: string }>
  expiresAt: number | null
  createdAt: number
}

export function toPublicShareResponse(view: PublicShareView): PublicShareView {
  return {
    shareId: view.shareId,
    request: {
      humanId: view.request.humanId,
      title: view.request.title,
      priority: view.request.priority,
      createdAt: view.request.createdAt,
    },
    briefSections: view.briefSections.map((section) => ({
      kind: section.kind,
      title: section.title,
      bulletPoints: [...section.bulletPoints],
      citations: section.citations.map((citation) => ({ ...citation })),
    })),
    deliverables: view.deliverables.map((deliverable) => ({ ...deliverable })),
    expiresAt: view.expiresAt,
    createdAt: view.createdAt,
  }
}

export type OperatorQueue =
  | "needs_elie"
  | "agent_drafting"
  | "needs_operator"
  | "delivered"
  | "attention_required"

export type OperatorWorkspaceItem = {
  request: ContentRequest
  queue: OperatorQueue
  agentJobStatus: AgentJob["status"] | null
  requiredDeliveryConfirmed: number
  requiredDeliveryTotal: number
  openConflictCount: number
  attentionReasonCount: number
  attentionReasons: Array<string>
  deliveryChannels: Array<string>
  nextActionChangedAt: number
}

export type OperatorWorkspacePage = {
  page: Array<OperatorWorkspaceItem>
  isDone: boolean
  continueCursor: string
}

export type OperatorWorkspaceInput = {
  queue?: OperatorQueue
  search?: string
  priority?: RequestPriority
  origin?: RequestOrigin
  lifecycle?: RequestLifecycle
  disposition?: RequestDisposition
  retention?: RequestRetention
  assigneePrincipalId?: string
  deliveryChannel?: string
  cursor?: string | null
  limit?: number
}

export type ContentRequestRelations = {
  parent: ContentRequestRelationSummary | null
  children: Array<ContentRequestRelationSummary>
  childrenTruncated: boolean
}

export type ContentRequestRelationSummary = Pick<
  ContentRequest,
  "requestId" | "humanId" | "title" | "lifecycle" | "disposition" | "retention"
>

export type CreateFollowUpInput = {
  parentHumanId: string
  title: string
  reason: string
  source?: OriginalSource
  correlationId: string
}

export type SemanticConflict = {
  conflictId: string
  requestHumanId: string
  field: "assigneePrincipalId" | "primaryDeliverableId" | "promotedVersionId"
  currentValue: string
  proposedValue: string
  expectedValue: string
  status: "open" | "resolved"
  correlationId: string
  createdAt: number
  resolvedValue: string | null
  resolvedAt: number | null
}

export type AssigneeChangeProposal = {
  humanId: string
  expectedAssigneePrincipalId: string
  proposedAssigneePrincipalId: string
  watcherPrincipalIds?: Array<string>
  reason?: string
  correlationId: string
}

export type AssigneeChangeResult =
  | { outcome: "applied"; conflict: null }
  | { outcome: "attention_required"; conflict: SemanticConflict }

export type DeliverablePromotionResult =
  | { outcome: "applied"; deliverable: Deliverable; conflict: null }
  | {
      outcome: "attention_required"
      deliverable: Deliverable
      conflict: SemanticConflict
    }

export type PrimaryDeliverableResult =
  | { outcome: "applied"; deliverables: Array<Deliverable>; conflict: null }
  | {
      outcome: "attention_required"
      deliverables: Array<Deliverable>
      conflict: SemanticConflict
    }

export interface ContentRequestRepository {
  createManual(input: PersistManualRequestInput): Promise<ContentRequest>
  getByHumanId(humanId: string): Promise<ContentRequest | null>
  list(limit?: number): Promise<Array<ContentRequest>>
  listOperatorWorkspace(
    input?: OperatorWorkspaceInput
  ): Promise<OperatorWorkspacePage>
  resolve(query: string): Promise<RequestResolution>
  assign(input: AssignRequestInput): Promise<ContentRequest>
  open(humanId: string, correlationId: string): Promise<ContentRequest>
  setExpiration(
    humanId: string,
    expiresAt: number | null,
    correlationId: string
  ): Promise<ContentRequest>
  expire(
    humanId: string,
    reason: string,
    correlationId: string
  ): Promise<ContentRequest>
  restoreExpired(
    humanId: string,
    expiresAt: number | null,
    correlationId: string
  ): Promise<ContentRequest>
  archive(humanId: string, correlationId: string): Promise<ContentRequest>
  restoreArchived(
    humanId: string,
    correlationId: string
  ): Promise<ContentRequest>
  createFollowUp(input: CreateFollowUpInput): Promise<ContentRequest>
  getRelations(humanId: string): Promise<ContentRequestRelations>
  listAssignablePrincipals(): Promise<Array<PrincipalSummary>>
  listMyNotifications(): Promise<Array<ContentNotification>>
  markNotificationRead(notificationId: string): Promise<void>
  listContext(humanId: string): Promise<Array<ContentContextItem>>
  getContextDeckPreferences(
    humanId: string
  ): Promise<ContextDeckPreferences | null>
  saveContextDeckPreferences(
    humanId: string,
    preferences: ContextDeckPreferences,
    correlationId: string
  ): Promise<ContextDeckPreferences>
  getFounderInput(humanId: string): Promise<FounderInputDocument | null>
  saveFounderText(
    humanId: string,
    text: string,
    correlationId: string
  ): Promise<FounderInputDocument>
  pullFounderAutomergeChanges(
    humanId: string,
    documentId: string
  ): Promise<FounderAutomergePull>
  submitFounderAutomergeChanges(input: {
    humanId: string
    documentId: string
    changes: Array<FounderAutomergeChange>
    heads: Array<string>
    text: string
    correlationId: string
  }): Promise<FounderInputDocument>
  getFounderVersionHistory(humanId: string): Promise<FounderVersionHistory>
  listFounderArchivedVersions(
    humanId: string,
    cursor: string | null
  ): Promise<FounderVersionArchivePage>
  restoreFounderArchivedVersion(
    humanId: string,
    versionId: string,
    correlationId: string
  ): Promise<FounderInputDocument>
  createFounderVoiceUploadUrl(humanId: string): Promise<string>
  finalizeFounderVoiceCapture(
    input: FinalizeFounderVoiceCaptureInput
  ): Promise<FounderVoiceCapture>
  listFounderVoiceCaptures(humanId: string): Promise<Array<FounderVoiceCapture>>
  retryFounderVoiceCapture(
    humanId: string,
    captureId: string
  ): Promise<FounderVoiceCapture>
  markFounderVoiceTranscriptMerged(
    humanId: string,
    captureId: string
  ): Promise<FounderVoiceCapture>
  discardFounderVoiceCapture(
    humanId: string,
    captureId: string
  ): Promise<FounderVoiceCapture>
  undoFounderInput(
    humanId: string,
    correlationId: string
  ): Promise<FounderInputDocument>
  redoFounderInput(
    humanId: string,
    correlationId: string
  ): Promise<FounderInputDocument>
  assertFounderInputSynced(
    humanId: string,
    heads: Array<string>
  ): Promise<{ synced: boolean; durableHeads: Array<string> }>
  submitFounderInput(
    humanId: string,
    heads: Array<string>,
    correlationId: string
  ): Promise<AgentJob>
  listAgentJobs(): Promise<Array<AgentJob>>
  claimAgentJob(leaseToken: string, leaseMs: number): Promise<AgentJob | null>
  heartbeatAgentJob(
    jobId: string,
    leaseToken: string,
    leaseMs: number,
    leaseGeneration: number
  ): Promise<AgentJob>
  getAgentJobInput(jobId: string): Promise<AgentJobInput>
  completeAgentJob(
    jobId: string,
    leaseToken: string,
    body: string,
    correlationId: string,
    leaseGeneration: number
  ): Promise<AgentJob>
  failAgentJob(
    jobId: string,
    leaseToken: string,
    errorCode: string,
    transient: boolean,
    correlationId: string,
    leaseGeneration: number
  ): Promise<AgentJob>
  listDeliverables(humanId: string): Promise<Array<Deliverable>>
  createDerivativeDeliverable(input: {
    humanId: string
    kind: string
    name: string
    body?: string
    correlationId: string
  }): Promise<Deliverable>
  createDeliverableVersion(input: {
    deliverableId: string
    body: string
    changeSummary?: string
    correlationId: string
  }): Promise<Deliverable>
  promoteDeliverableVersion(input: {
    deliverableId: string
    versionId: string
    expectedPromotedVersionId: string | null
    correlationId: string
  }): Promise<DeliverablePromotionResult>
  setPrimaryDeliverable(input: {
    humanId: string
    deliverableId: string
    expectedPrimaryDeliverableId: string
    correlationId: string
  }): Promise<PrimaryDeliverableResult>
  listDeliveryTargets(humanId: string): Promise<Array<DeliveryTarget>>
  listArchivedDeliveryTargets(
    humanId: string,
    cursor: string | null
  ): Promise<DeliveryTargetPage>
  createDeliveryTarget(input: {
    humanId: string
    deliverableId: string
    channel: string
    destinationLabel: string
    destinationUrl?: string
    isRequired?: boolean
    correlationId: string
  }): Promise<DeliveryTarget>
  setDeliveryTargetRequired(input: {
    targetId: string
    isRequired: boolean
    correlationId: string
  }): Promise<DeliveryTarget>
  setDeliveryTargetRetention(input: {
    targetId: string
    retention: "active" | "archived"
    correlationId: string
  }): Promise<DeliveryTarget>
  listPublicShares(humanId: string): Promise<Array<PublicShareSummary>>
  createPublicShare(input: {
    humanId: string
    contextItemIds: Array<string>
    deliverableIds: Array<string>
    expiresAt?: number
    correlationId: string
  }): Promise<{ share: PublicShareSummary; token: string }>
  revokePublicShare(
    shareId: string,
    correlationId: string
  ): Promise<PublicShareSummary>
  confirmDeliveryTarget(input: {
    targetId: string
    versionId: string
    note?: string
    integrationSuccessId?: string
    correlationId: string
  }): Promise<DeliveryTarget>
  reopenDeliveryTarget(input: {
    targetId: string
    correlationId: string
  }): Promise<DeliveryTarget>
  proposeAssigneeChange(
    input: AssigneeChangeProposal
  ): Promise<AssigneeChangeResult>
  listOpenSemanticConflicts(humanId: string): Promise<Array<SemanticConflict>>
  resolveSemanticConflict(input: {
    conflictId: string
    selectedValue: string
    correlationId: string
  }): Promise<SemanticConflict>
}

export interface ContentRequestService {
  createManual(input: CreateManualRequestInput): Promise<ContentRequest>
  getByHumanId(humanId: string): Promise<ContentRequest | null>
  list(limit?: number): Promise<Array<ContentRequest>>
  listOperatorWorkspace(
    input?: OperatorWorkspaceInput
  ): Promise<OperatorWorkspacePage>
  resolve(query: string): Promise<RequestResolution>
  assign(input: AssignRequestInput): Promise<ContentRequest>
  open(humanId: string, correlationId: string): Promise<ContentRequest>
  setExpiration(
    humanId: string,
    expiresAt: number | null,
    correlationId: string
  ): Promise<ContentRequest>
  expire(
    humanId: string,
    reason: string,
    correlationId: string
  ): Promise<ContentRequest>
  restoreExpired(
    humanId: string,
    expiresAt: number | null,
    correlationId: string
  ): Promise<ContentRequest>
  archive(humanId: string, correlationId: string): Promise<ContentRequest>
  restoreArchived(
    humanId: string,
    correlationId: string
  ): Promise<ContentRequest>
  createFollowUp(input: CreateFollowUpInput): Promise<ContentRequest>
  getRelations(humanId: string): Promise<ContentRequestRelations>
  listAssignablePrincipals(): Promise<Array<PrincipalSummary>>
  listMyNotifications(): Promise<Array<ContentNotification>>
  markNotificationRead(notificationId: string): Promise<void>
  listContext(humanId: string): Promise<Array<ContentContextItem>>
  getContextDeckPreferences(
    humanId: string
  ): Promise<ContextDeckPreferences | null>
  saveContextDeckPreferences(
    humanId: string,
    preferences: ContextDeckPreferences,
    correlationId: string
  ): Promise<ContextDeckPreferences>
  getFounderInput(humanId: string): Promise<FounderInputDocument | null>
  saveFounderText(
    humanId: string,
    text: string,
    correlationId: string
  ): Promise<FounderInputDocument>
  pullFounderAutomergeChanges(
    humanId: string,
    documentId: string
  ): Promise<FounderAutomergePull>
  submitFounderAutomergeChanges(input: {
    humanId: string
    documentId: string
    changes: Array<FounderAutomergeChange>
    heads: Array<string>
    text: string
    correlationId: string
  }): Promise<FounderInputDocument>
  getFounderVersionHistory(humanId: string): Promise<FounderVersionHistory>
  listFounderArchivedVersions(
    humanId: string,
    cursor: string | null
  ): Promise<FounderVersionArchivePage>
  restoreFounderArchivedVersion(
    humanId: string,
    versionId: string,
    correlationId: string
  ): Promise<FounderInputDocument>
  createFounderVoiceUploadUrl(humanId: string): Promise<string>
  finalizeFounderVoiceCapture(
    input: FinalizeFounderVoiceCaptureInput
  ): Promise<FounderVoiceCapture>
  listFounderVoiceCaptures(humanId: string): Promise<Array<FounderVoiceCapture>>
  retryFounderVoiceCapture(
    humanId: string,
    captureId: string
  ): Promise<FounderVoiceCapture>
  markFounderVoiceTranscriptMerged(
    humanId: string,
    captureId: string
  ): Promise<FounderVoiceCapture>
  discardFounderVoiceCapture(
    humanId: string,
    captureId: string
  ): Promise<FounderVoiceCapture>
  undoFounderInput(
    humanId: string,
    correlationId: string
  ): Promise<FounderInputDocument>
  redoFounderInput(
    humanId: string,
    correlationId: string
  ): Promise<FounderInputDocument>
  assertFounderInputSynced(
    humanId: string,
    heads: Array<string>
  ): Promise<{ synced: boolean; durableHeads: Array<string> }>
  submitFounderInput(
    humanId: string,
    heads: Array<string>,
    correlationId: string
  ): Promise<AgentJob>
  listAgentJobs(): Promise<Array<AgentJob>>
  claimAgentJob(leaseToken: string, leaseMs: number): Promise<AgentJob | null>
  heartbeatAgentJob(
    jobId: string,
    leaseToken: string,
    leaseMs: number,
    leaseGeneration: number
  ): Promise<AgentJob>
  getAgentJobInput(jobId: string): Promise<AgentJobInput>
  completeAgentJob(
    jobId: string,
    leaseToken: string,
    body: string,
    correlationId: string,
    leaseGeneration: number
  ): Promise<AgentJob>
  failAgentJob(
    jobId: string,
    leaseToken: string,
    errorCode: string,
    transient: boolean,
    correlationId: string,
    leaseGeneration: number
  ): Promise<AgentJob>
  listDeliverables(humanId: string): Promise<Array<Deliverable>>
  createDerivativeDeliverable(input: {
    humanId: string
    kind: string
    name: string
    body?: string
    correlationId: string
  }): Promise<Deliverable>
  createDeliverableVersion(input: {
    deliverableId: string
    body: string
    changeSummary?: string
    correlationId: string
  }): Promise<Deliverable>
  promoteDeliverableVersion(input: {
    deliverableId: string
    versionId: string
    expectedPromotedVersionId: string | null
    correlationId: string
  }): Promise<DeliverablePromotionResult>
  setPrimaryDeliverable(input: {
    humanId: string
    deliverableId: string
    expectedPrimaryDeliverableId: string
    correlationId: string
  }): Promise<PrimaryDeliverableResult>
  listDeliveryTargets(humanId: string): Promise<Array<DeliveryTarget>>
  listArchivedDeliveryTargets(
    humanId: string,
    cursor: string | null
  ): Promise<DeliveryTargetPage>
  createDeliveryTarget(input: {
    humanId: string
    deliverableId: string
    channel: string
    destinationLabel: string
    destinationUrl?: string
    isRequired?: boolean
    correlationId: string
  }): Promise<DeliveryTarget>
  setDeliveryTargetRequired(input: {
    targetId: string
    isRequired: boolean
    correlationId: string
  }): Promise<DeliveryTarget>
  setDeliveryTargetRetention(input: {
    targetId: string
    retention: "active" | "archived"
    correlationId: string
  }): Promise<DeliveryTarget>
  listPublicShares(humanId: string): Promise<Array<PublicShareSummary>>
  createPublicShare(input: {
    humanId: string
    contextItemIds: Array<string>
    deliverableIds: Array<string>
    expiresAt?: number
    correlationId: string
  }): Promise<{ share: PublicShareSummary; token: string }>
  revokePublicShare(
    shareId: string,
    correlationId: string
  ): Promise<PublicShareSummary>
  confirmDeliveryTarget(input: {
    targetId: string
    versionId: string
    note?: string
    integrationSuccessId?: string
    correlationId: string
  }): Promise<DeliveryTarget>
  reopenDeliveryTarget(input: {
    targetId: string
    correlationId: string
  }): Promise<DeliveryTarget>
  proposeAssigneeChange(
    input: AssigneeChangeProposal
  ): Promise<AssigneeChangeResult>
  listOpenSemanticConflicts(humanId: string): Promise<Array<SemanticConflict>>
  resolveSemanticConflict(input: {
    conflictId: string
    selectedValue: string
    correlationId: string
  }): Promise<SemanticConflict>
}

export function createContentRequestService(
  repository: ContentRequestRepository,
  creationOrigin: PersistManualRequestInput["origin"]
): ContentRequestService {
  return {
    createManual: (input) =>
      repository.createManual({ ...input, origin: creationOrigin }),
    getByHumanId: (humanId) => repository.getByHumanId(humanId),
    list: (limit) => repository.list(limit),
    listOperatorWorkspace: (input) => repository.listOperatorWorkspace(input),
    resolve: (query) => repository.resolve(query),
    assign: (input) => repository.assign(input),
    open: (humanId, correlationId) => repository.open(humanId, correlationId),
    setExpiration: (humanId, expiresAt, correlationId) =>
      repository.setExpiration(humanId, expiresAt, correlationId),
    expire: (humanId, reason, correlationId) =>
      repository.expire(humanId, reason, correlationId),
    restoreExpired: (humanId, expiresAt, correlationId) =>
      repository.restoreExpired(humanId, expiresAt, correlationId),
    archive: (humanId, correlationId) =>
      repository.archive(humanId, correlationId),
    restoreArchived: (humanId, correlationId) =>
      repository.restoreArchived(humanId, correlationId),
    createFollowUp: (input) => repository.createFollowUp(input),
    getRelations: (humanId) => repository.getRelations(humanId),
    listAssignablePrincipals: () => repository.listAssignablePrincipals(),
    listMyNotifications: () => repository.listMyNotifications(),
    markNotificationRead: (notificationId) =>
      repository.markNotificationRead(notificationId),
    listContext: (humanId) => repository.listContext(humanId),
    getContextDeckPreferences: (humanId) =>
      repository.getContextDeckPreferences(humanId),
    saveContextDeckPreferences: (humanId, preferences, correlationId) =>
      repository.saveContextDeckPreferences(
        humanId,
        preferences,
        correlationId
      ),
    getFounderInput: (humanId) => repository.getFounderInput(humanId),
    saveFounderText: (humanId, text, correlationId) =>
      repository.saveFounderText(humanId, text, correlationId),
    pullFounderAutomergeChanges: (humanId, documentId) =>
      repository.pullFounderAutomergeChanges(humanId, documentId),
    submitFounderAutomergeChanges: (input) =>
      repository.submitFounderAutomergeChanges(input),
    getFounderVersionHistory: (humanId) =>
      repository.getFounderVersionHistory(humanId),
    listFounderArchivedVersions: (humanId, cursor) =>
      repository.listFounderArchivedVersions(humanId, cursor),
    restoreFounderArchivedVersion: (humanId, versionId, correlationId) =>
      repository.restoreFounderArchivedVersion(
        humanId,
        versionId,
        correlationId
      ),
    createFounderVoiceUploadUrl: (humanId) =>
      repository.createFounderVoiceUploadUrl(humanId),
    finalizeFounderVoiceCapture: (input) =>
      repository.finalizeFounderVoiceCapture(input),
    listFounderVoiceCaptures: (humanId) =>
      repository.listFounderVoiceCaptures(humanId),
    retryFounderVoiceCapture: (humanId, captureId) =>
      repository.retryFounderVoiceCapture(humanId, captureId),
    markFounderVoiceTranscriptMerged: (humanId, captureId) =>
      repository.markFounderVoiceTranscriptMerged(humanId, captureId),
    discardFounderVoiceCapture: (humanId, captureId) =>
      repository.discardFounderVoiceCapture(humanId, captureId),
    undoFounderInput: (humanId, correlationId) =>
      repository.undoFounderInput(humanId, correlationId),
    redoFounderInput: (humanId, correlationId) =>
      repository.redoFounderInput(humanId, correlationId),
    assertFounderInputSynced: (humanId, heads) =>
      repository.assertFounderInputSynced(humanId, heads),
    submitFounderInput: (humanId, heads, correlationId) =>
      repository.submitFounderInput(humanId, heads, correlationId),
    listAgentJobs: () => repository.listAgentJobs(),
    claimAgentJob: (leaseToken, leaseMs) =>
      repository.claimAgentJob(leaseToken, leaseMs),
    heartbeatAgentJob: (jobId, leaseToken, leaseMs, leaseGeneration) =>
      repository.heartbeatAgentJob(jobId, leaseToken, leaseMs, leaseGeneration),
    getAgentJobInput: (jobId) => repository.getAgentJobInput(jobId),
    completeAgentJob: (
      jobId,
      leaseToken,
      body,
      correlationId,
      leaseGeneration
    ) =>
      repository.completeAgentJob(
        jobId,
        leaseToken,
        body,
        correlationId,
        leaseGeneration
      ),
    failAgentJob: (
      jobId,
      leaseToken,
      errorCode,
      transient,
      correlationId,
      leaseGeneration
    ) =>
      repository.failAgentJob(
        jobId,
        leaseToken,
        errorCode,
        transient,
        correlationId,
        leaseGeneration
      ),
    listDeliverables: (humanId) => repository.listDeliverables(humanId),
    createDerivativeDeliverable: (input) =>
      repository.createDerivativeDeliverable(input),
    createDeliverableVersion: (input) =>
      repository.createDeliverableVersion(input),
    promoteDeliverableVersion: (input) =>
      repository.promoteDeliverableVersion(input),
    setPrimaryDeliverable: (input) => repository.setPrimaryDeliverable(input),
    listDeliveryTargets: (humanId) => repository.listDeliveryTargets(humanId),
    listArchivedDeliveryTargets: (humanId, cursor) =>
      repository.listArchivedDeliveryTargets(humanId, cursor),
    createDeliveryTarget: (input) => repository.createDeliveryTarget(input),
    setDeliveryTargetRequired: (input) =>
      repository.setDeliveryTargetRequired(input),
    setDeliveryTargetRetention: (input) =>
      repository.setDeliveryTargetRetention(input),
    listPublicShares: (humanId) => repository.listPublicShares(humanId),
    createPublicShare: (input) => repository.createPublicShare(input),
    revokePublicShare: (shareId, correlationId) =>
      repository.revokePublicShare(shareId, correlationId),
    confirmDeliveryTarget: (input) => repository.confirmDeliveryTarget(input),
    reopenDeliveryTarget: (input) => repository.reopenDeliveryTarget(input),
    proposeAssigneeChange: (input) => repository.proposeAssigneeChange(input),
    listOpenSemanticConflicts: (humanId) =>
      repository.listOpenSemanticConflicts(humanId),
    resolveSemanticConflict: (input) =>
      repository.resolveSemanticConflict(input),
  }
}
