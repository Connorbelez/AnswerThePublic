import type {
  FounderHandoffFormat,
  FounderHandoffStage,
} from "../../shared/founder-handoff"
import type {
  CompleteExpertInterviewProcessingInput,
  CreateExpertInterviewInput,
  ExpertInterviewBrief,
  ExpertInterviewPackage,
  ExpertInterviewQuestion,
  ExpertInterviewSubmissionSummary,
  ExpertSynthesisProcessingSnapshot,
  ExpertSynthesisProvenance,
  SaveExpertInterviewPackageInput,
} from "@/application/expert-interviews"

export type RequestOrigin =
  "manual" | "automated_scout" | "chatgpt_app" | "cli" | "http_api"

export type RequestPriority = "critical" | "high" | "normal" | "low"
export type ContentRequestType = "standard" | "expert_interview"

export type RequestLifecycle =
  | "pending"
  | "in_progress"
  | "founder_complete"
  | "ready_to_respond"
  | "responded"

export type RequestDisposition = "active" | "expired"
export type RequestRetention = "active" | "archived"

export type AggregateVersionPrecondition = {
  expectedAggregateVersion?: number
}

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
  requestType: ContentRequestType
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

export type CursorPage<T> = {
  page: Array<T>
  nextCursor: string | null
}

export type ProductMetrics = {
  from: number
  to: number
  generatedAt: number
  truncated: boolean
  firstOpens: number
  founderSubmissions: number
  readyResponses: number
  deliveries: number
  expirations: number
  failures: number
  retriesScheduled: number
  draftingCompletions: number
  draftingFailureRate: number
  deliveriesWithExpiration: number
  deliveriesBeforeExpiration: number
  deliveryBeforeExpirationRate: number
  agentDraftDeliveries: number
  rewrittenResponses: number
  rewriteRate: number
  deliveredWithoutSubstantialRewriteRate: number
  medianCreationToFirstOpenMs: number | null
  medianCreationToFounderSubmissionMs: number | null
  medianFounderToReadyMs: number | null
  medianReadyToDeliveryMs: number | null
}

export type ProductMetricsInput = {
  from?: number
  to?: number
}

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

export type UpdateRequestInput = {
  humanId: string
  title?: string
  aliases?: Array<string>
  priority?: RequestPriority
  timingLabel?: string | null
  correlationId: string
}

export type ContentNotification = {
  notificationId: string
  requestHumanId: string
  type:
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
  emailQueued: boolean
  emailStatus: "queued" | "sent" | "failed"
  createdAt: number
  readAt: number | null
  deepLink: string
}

export type ContentRequestAuditEvent = {
  eventId: string
  operation: string
  correlationId: string
  requestHumanId: string
  actorPrincipalId: string | null
  actorGrantId: string | null
  credentialId: string
  occurredAt: number
  beforeVersion: number | null
  afterVersion: number
}
export type ContentRequestAuditPage = {
  page: Array<ContentRequestAuditEvent>
  nextCursor: string | null
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

export type UpsertContentContextInput = Omit<
  ContentContextItem,
  "contextId"
> & {
  humanId: string
  correlationId: string
}

export type ContentContextVersion = ContentContextItem & {
  versionId: string
  ordinal: number
  actorPrincipalId: string
  credentialId: string
  correlationId: string
  createdAt: number
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
    "queued" | "running" | "retry_wait" | "failed" | "completed" | "cancelled"
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
  processingModel: "founder_input" | "expert_submissions"
  expertSubmissionIds: Array<string>
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
  } | null
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

export type PersonSummary = {
  personId: string
  displayName: string
  email: string
  principalId: string | null
  isFounder: boolean
}

export type PersonSearchResult = {
  people: Array<PersonSummary>
  defaultPersonId: string | null
}

export type CreatePersonInput = {
  humanId: string
  displayName: string
  email: string
  correlationId: string
}

export type GuestAccessGrantState =
  "generated" | "opened" | "in_progress" | "submitted" | "expired" | "revoked"

export type GuestAccessGrantSummary = {
  grantId: string
  requestHumanId: string
  person: PersonSummary
  state: GuestAccessGrantState
  tokenVersion: number
  expiresAt: number
  createdAt: number
  firstOpenedAt: number | null
  latestActivityAt: number
  progress: { completed: number; total: number }
  submitted: boolean
  events: Array<{
    kind:
      | "generated"
      | "opened"
      | "first_progress"
      | "submitted"
      | "expired"
      | "revoked"
      | "renewed"
      | "reopened"
      | "taken_over"
    occurredAt: number
    actor: "guest" | "administrator" | "system"
    actorName: string
    tokenVersion: number | null
  }>
}

export type CreateGuestAccessGrantInput = {
  humanId: string
  personId: string
  correlationId: string
}

export type CreateGuestAccessGrantResult = {
  grant: GuestAccessGrantSummary
  token: string | null
}

export type MutateGuestAccessGrantInput = {
  grantId: string
  correlationId: string
  expectedAggregateVersion?: number
}

export type RenewGuestAccessGrantResult = {
  grant: GuestAccessGrantSummary
  token: string | null
}

export type GuestAnswerMode = "batch" | "one_by_one"

export type GuestEditorLease = {
  active: boolean
  generation: number
  expiresAt: number | null
}

export type GuestResponseFeedback = {
  feedbackId: string
  scope:
    | { kind: "workspace" }
    | { kind: "question"; questionId: string }
    | { kind: "asset"; assetId: string }
  body: string
  author: { displayName: string }
  createdAt: number
}

export type GuestResponseAdminFeedback = Omit<
  GuestResponseFeedback,
  "author"
> & {
  author: { principalId: string; displayName: string }
}

export type GuestResponseAssetScope =
  { kind: "batch" } | { kind: "question"; questionId: string }

export type GuestResponseAsset = {
  assetId: string
  clientAssetId: string
  kind: "audio" | "attachment"
  scope: GuestResponseAssetScope
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadState: "uploading" | "uploaded" | "failed" | "discarded"
  transcriptionState:
    | "not_applicable"
    | "queued"
    | "transcribing"
    | "transcribed"
    | "failed"
    | "discarded"
  transcript: string | null
  transcriptVersion: number
  transcriptionLeaseExpiresAt: number | null
  failureCode: string | null
  retryHistory: Array<{
    stage: "upload" | "transcription"
    attempt: number
    outcome: "started" | "succeeded" | "failed"
    code: string | null
    at: number
  }>
  version: number
  submittedAt: number | null
  discardedAt: number | null
  downloadUrl: string | null
  feedback: Array<GuestResponseAssetFeedback>
  createdAt: number
  updatedAt: number
}

export type GuestResponseAssetFeedback = {
  feedbackId: string
  assetId: string
  body: string
  author: { displayName: string }
  createdAt: number
}

export type GuestResponseAdminAssetFeedback = Omit<
  GuestResponseAssetFeedback,
  "author"
> & {
  author: { principalId: string; displayName: string }
}

export type GuestResponseSubmission = {
  submissionId: string
  requestHumanId: string
  respondent: {
    personId: string
    displayName: string
    email: string
  }
  workspaceRevision: number
  answerMode: GuestAnswerMode
  selectedAnswerMode?: GuestAnswerMode
  selectionMethod?:
    "single_mode" | "respondent_choice" | "legacy_workspace_mode"
  batchText: string
  questionAnswers: Array<{ questionId: string; text: string }>
  questions: Array<{
    questionId: string
    question: string
    motivation: string
    position: number
    version: number
  }>
  assetSnapshots?: Array<{
    assetId: string
    version: number
    transcriptVersion: number
    kind: "audio" | "attachment"
    scope: GuestResponseAssetScope
  }>
  submittedAt: number
}

export type GuestResponseWorkspace = {
  answerMode: GuestAnswerMode
  batchText: string
  questionAnswers: Array<{ questionId: string; text: string }>
  progress: { completed: number; total: number }
  revision: number
  editorLease: GuestEditorLease
  locked?: boolean
  lockedAt?: number | null
  feedback?: Array<GuestResponseFeedback>
}

export type SaveGuestResponseWorkspaceInput = {
  token: string
  leaseId: string
  leaseGeneration: number
  operationId: string
  expectedRevision: number
  answerMode: GuestAnswerMode
  batchText: string
  questionAnswers: Array<{ questionId: string; text: string }>
}

export type SaveGuestResponseWorkspaceResult =
  | { status: "saved"; workspace: GuestResponseWorkspace }
  | { status: "conflict"; workspace: GuestResponseWorkspace }
  | {
      status: "lease_conflict"
      workspace: GuestResponseWorkspace
      editorLease: GuestEditorLease
    }

export type AcquireGuestEditorLeaseInput = {
  token: string
  leaseId: string
  operationId: string
}

export type HeartbeatGuestEditorLeaseInput = AcquireGuestEditorLeaseInput & {
  leaseGeneration: number
}

export type TakeoverGuestEditorLeaseInput = AcquireGuestEditorLeaseInput & {
  expectedGeneration: number
}

export type GuestEditorLeaseResult = {
  status: "editing" | "conflict"
  editorLease: GuestEditorLease
}

export type SubmitGuestResponseWorkspaceInput = {
  token: string
  leaseId: string
  leaseGeneration: number
  operationId: string
  expectedRevision: number
  confirmed: true
  selectedAnswerMode?: GuestAnswerMode
}

export type SubmitGuestResponseWorkspaceResult = {
  status: "submitted"
  workspace: { locked: true; revision: number }
  submission: GuestResponseSubmission
}

export type GuestResponseAdminView = {
  grantId: string
  requestHumanId: string
  assignedPerson: { displayName: string }
  readOnly: true
  questions: Array<{
    questionId: string
    question: string
    motivation: string
  }>
  workspace: Omit<GuestResponseWorkspace, "feedback"> & {
    feedback: Array<GuestResponseAdminFeedback>
  }
  submissions: Array<GuestResponseSubmission>
  assets?: Array<{
    asset: GuestResponseAsset
    feedback: Array<GuestResponseAdminAssetFeedback>
  }>
}

export type BeginGuestEvidenceUploadInput = {
  token: string
  leaseId: string
  leaseGeneration: number
  clientAssetId: string
  kind: "audio" | "attachment"
  scope: GuestResponseAssetScope
  fileName: string
  mimeType: string
  sizeBytes: number
}

export type BeginGuestEvidenceUploadResult = {
  asset: GuestResponseAsset
  uploadSessionId: string
  uploadUrl: string
  uploadRegistrationToken: string
}

export type GuestEvidenceRetryResult = {
  asset: GuestResponseAsset
  uploadSessionId: string | null
  uploadUrl: string | null
  uploadRegistrationToken: string | null
}

export type FinalizeGuestEvidenceUploadInput = {
  token: string
  leaseId: string
  leaseGeneration: number
  assetId: string
  uploadSessionId: string
  storageId: string
}

export type RegisterGuestEvidenceUploadInput = {
  assetId: string
  uploadSessionId: string
  storageId: string
  uploadRegistrationToken: string
}

export type MarkGuestEvidenceUploadFailedInput = {
  token: string
  leaseId: string
  leaseGeneration: number
  assetId: string
  uploadSessionId: string
  failureCode: string
}

export type RetryGuestEvidenceInput = {
  token: string
  leaseId: string
  leaseGeneration: number
  assetId: string
  operationId: string
}

export type DiscardGuestEvidenceInput = RetryGuestEvidenceInput

export type AddGuestResponseAssetFeedbackInput = {
  grantId: string
  assetId: string
  body: string
  correlationId: string
}

export type AddGuestResponseFeedbackInput = {
  grantId: string
  scope: { kind: "workspace" } | { kind: "question"; questionId: string }
  body: string
  correlationId: string
}

export type ReopenGuestResponseWorkspaceInput = {
  grantId: string
  correlationId: string
}

export type GuestAccessView =
  | {
      status: "available"
      grantId: string
      expiresAt: number
      request: {
        humanId: string
        title: string
        requestType: "standard" | "expert_interview"
        brief: {
          question: string | null
          body: string | null
        }
      }
      interview: {
        brief: ExpertInterviewBrief
        questions: Array<
          Pick<ExpertInterviewQuestion, "id" | "question" | "motivation">
        >
      } | null
      questions: Array<
        Pick<ExpertInterviewQuestion, "id" | "question" | "motivation">
      >
      workspace?: GuestResponseWorkspace
    }
  | { status: "expired" }
  | { status: "rate_limited" }

export interface GuestAccessRepository {
  resolve(token: string, networkSource: string): Promise<GuestAccessView | null>
  acquireEditorLease(
    input: AcquireGuestEditorLeaseInput
  ): Promise<GuestEditorLeaseResult | null>
  heartbeatEditorLease(
    input: HeartbeatGuestEditorLeaseInput
  ): Promise<GuestEditorLeaseResult | null>
  takeoverEditorLease(
    input: TakeoverGuestEditorLeaseInput
  ): Promise<GuestEditorLeaseResult | null>
  saveResponseWorkspace(
    input: SaveGuestResponseWorkspaceInput
  ): Promise<SaveGuestResponseWorkspaceResult | null>
  submitResponseWorkspace(
    input: SubmitGuestResponseWorkspaceInput
  ): Promise<SubmitGuestResponseWorkspaceResult | null>
  beginEvidenceUpload(
    input: BeginGuestEvidenceUploadInput
  ): Promise<BeginGuestEvidenceUploadResult>
  finalizeEvidenceUpload(
    input: FinalizeGuestEvidenceUploadInput
  ): Promise<GuestResponseAsset>
  registerEvidenceUpload(input: RegisterGuestEvidenceUploadInput): Promise<null>
  markEvidenceUploadFailed(
    input: MarkGuestEvidenceUploadFailedInput
  ): Promise<GuestResponseAsset>
  listEvidence(token: string): Promise<Array<GuestResponseAsset>>
  retryEvidence(
    input: RetryGuestEvidenceInput
  ): Promise<GuestEvidenceRetryResult>
  discardEvidence(input: DiscardGuestEvidenceInput): Promise<GuestResponseAsset>
}

export interface GuestAccessService {
  resolve(token: string, networkSource: string): Promise<GuestAccessView | null>
  acquireEditorLease(
    input: AcquireGuestEditorLeaseInput
  ): Promise<GuestEditorLeaseResult | null>
  heartbeatEditorLease(
    input: HeartbeatGuestEditorLeaseInput
  ): Promise<GuestEditorLeaseResult | null>
  takeoverEditorLease(
    input: TakeoverGuestEditorLeaseInput
  ): Promise<GuestEditorLeaseResult | null>
  saveResponseWorkspace(
    input: SaveGuestResponseWorkspaceInput
  ): Promise<SaveGuestResponseWorkspaceResult | null>
  submitResponseWorkspace(
    input: SubmitGuestResponseWorkspaceInput
  ): Promise<SubmitGuestResponseWorkspaceResult | null>
  beginEvidenceUpload(
    input: BeginGuestEvidenceUploadInput
  ): Promise<BeginGuestEvidenceUploadResult>
  finalizeEvidenceUpload(
    input: FinalizeGuestEvidenceUploadInput
  ): Promise<GuestResponseAsset>
  registerEvidenceUpload(input: RegisterGuestEvidenceUploadInput): Promise<null>
  markEvidenceUploadFailed(
    input: MarkGuestEvidenceUploadFailedInput
  ): Promise<GuestResponseAsset>
  listEvidence(token: string): Promise<Array<GuestResponseAsset>>
  retryEvidence(
    input: RetryGuestEvidenceInput
  ): Promise<GuestEvidenceRetryResult>
  discardEvidence(input: DiscardGuestEvidenceInput): Promise<GuestResponseAsset>
}

export function createGuestAccessService(
  repository: GuestAccessRepository
): GuestAccessService {
  return {
    resolve: (token, networkSource) => repository.resolve(token, networkSource),
    acquireEditorLease: (input) => repository.acquireEditorLease(input),
    heartbeatEditorLease: (input) => repository.heartbeatEditorLease(input),
    takeoverEditorLease: (input) => repository.takeoverEditorLease(input),
    saveResponseWorkspace: (input) => repository.saveResponseWorkspace(input),
    submitResponseWorkspace: (input) =>
      repository.submitResponseWorkspace(input),
    beginEvidenceUpload: (input) => repository.beginEvidenceUpload(input),
    registerEvidenceUpload: (input) => repository.registerEvidenceUpload(input),
    finalizeEvidenceUpload: (input) => repository.finalizeEvidenceUpload(input),
    markEvidenceUploadFailed: (input) =>
      repository.markEvidenceUploadFailed(input),
    listEvidence: (token) => repository.listEvidence(token),
    retryEvidence: (input) => repository.retryEvidence(input),
    discardEvidence: (input) => repository.discardEvidence(input),
  }
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

export type FounderHandoffStatus = {
  handoffId: string
  recipient: PrincipalSummary
  selectedFormats: Array<FounderHandoffFormat>
  note: string | null
  stage: FounderHandoffStage
  deliveredAt: number
  openedAt: number | null
  emailStatus: "queued" | "sent" | "failed" | null
}

export type FinalizeFounderHandoffInput = {
  humanId: string
  recipientPrincipalId: string
  selectedFormats: Array<FounderHandoffFormat>
  note?: string
  correlationId: string
}

export type FinalizeFounderHandoffResult =
  | { outcome: "applied"; handoff: FounderHandoffStatus }
  | { outcome: "already_applied"; handoff: FounderHandoffStatus }

export type OperatorWorkspaceItem = {
  request: ContentRequest
  queue: OperatorQueue
  founderHandoff: FounderHandoffStatus | null
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

export type ExpertInterviewCreationResult = {
  request: ContentRequest
  expertInterview: {
    package: ExpertInterviewPackage
    brief: ContentContextItem
    gaps: Array<ContentContextItem>
    questions: Array<ContentContextItem>
    instructions: ContentContextItem
  }
}

export interface ContentRequestRepository {
  createManual(input: PersistManualRequestInput): Promise<ContentRequest>
  createExpertInterview(
    input: CreateExpertInterviewInput & {
      origin: PersistManualRequestInput["origin"]
    }
  ): Promise<ExpertInterviewCreationResult>
  saveExpertInterviewPackage(
    input: SaveExpertInterviewPackageInput
  ): Promise<ExpertInterviewPackage>
  getExpertInterview(humanId: string): Promise<ExpertInterviewPackage | null>
  listExpertInterviewSubmissions(
    humanId: string
  ): Promise<Array<ExpertInterviewSubmissionSummary>>
  listExpertInterviewContextVersionIds(humanId: string): Promise<Array<string>>
  createExpertSynthesisProcessingSnapshot(input: {
    humanId: string
    submissionIds: Array<string>
    synthesisInstructions?: string
    correlationId: string
  }): Promise<ExpertSynthesisProcessingSnapshot>
  verifyExpertSynthesisProcessingSnapshot(input: {
    humanId: string
    processingToken: string
    submissionIds: Array<string>
  }): Promise<ExpertSynthesisProcessingSnapshot>
  commitExpertSynthesis(
    input: CompleteExpertInterviewProcessingInput
  ): Promise<{
    deliverable: Deliverable
    provenance: ExpertSynthesisProvenance
  }>
  setExpertInterviewSubmissionInclusion(input: {
    humanId: string
    submissionId: string
    included: boolean
    correlationId: string
  }): Promise<ExpertInterviewSubmissionSummary>
  searchPeople(query: string, limit?: number): Promise<PersonSearchResult>
  createPerson(input: CreatePersonInput): Promise<PersonSummary>
  listGuestAccessGrants(
    humanId: string
  ): Promise<Array<GuestAccessGrantSummary>>
  createGuestAccessGrant(
    input: CreateGuestAccessGrantInput
  ): Promise<CreateGuestAccessGrantResult>
  revokeGuestAccessGrant(
    input: MutateGuestAccessGrantInput
  ): Promise<GuestAccessGrantSummary>
  renewGuestAccessGrant(
    input: MutateGuestAccessGrantInput
  ): Promise<RenewGuestAccessGrantResult>
  inspectGuestResponseWorkspace(
    grantId: string
  ): Promise<GuestResponseAdminView | null>
  addGuestResponseAssetFeedback(
    input: AddGuestResponseAssetFeedbackInput
  ): Promise<GuestResponseAdminAssetFeedback>
  addGuestResponseFeedback(
    input: AddGuestResponseFeedbackInput
  ): Promise<GuestResponseAdminFeedback>
  reopenGuestResponseWorkspace(
    input: ReopenGuestResponseWorkspaceInput
  ): Promise<{ locked: false; lockedAt: null; revision: number }>
  getByHumanId(humanId: string): Promise<ContentRequest | null>
  list(limit?: number): Promise<Array<ContentRequest>>
  listFounderWorkspace(
    founderEmail: string,
    limit?: number
  ): Promise<Array<ContentRequest>>
  listPage(
    cursor: string | null,
    limit: number
  ): Promise<CursorPage<ContentRequest>>
  listOperatorWorkspace(
    input?: OperatorWorkspaceInput
  ): Promise<OperatorWorkspacePage>
  getCurrentFounderHandoff(
    humanId: string
  ): Promise<FounderHandoffStatus | null>
  finalizeFounderHandoff(
    input: FinalizeFounderHandoffInput
  ): Promise<FinalizeFounderHandoffResult>
  resolve(query: string): Promise<RequestResolution>
  update(input: UpdateRequestInput): Promise<ContentRequest>
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
    correlationId: string,
    expectedAggregateVersion?: number
  ): Promise<ContentRequest>
  restoreExpired(
    humanId: string,
    expiresAt: number | null,
    correlationId: string
  ): Promise<ContentRequest>
  archive(
    humanId: string,
    correlationId: string,
    expectedAggregateVersion?: number
  ): Promise<ContentRequest>
  restoreArchived(
    humanId: string,
    correlationId: string
  ): Promise<ContentRequest>
  createFollowUp(input: CreateFollowUpInput): Promise<ContentRequest>
  getRelations(humanId: string): Promise<ContentRequestRelations>
  listAssignablePrincipals(): Promise<Array<PrincipalSummary>>
  listMyNotifications(): Promise<Array<ContentNotification>>
  listMyNotificationsPage(
    cursor: string | null,
    limit: number
  ): Promise<CursorPage<ContentNotification>>
  markNotificationRead(
    notificationId: string,
    correlationId: string
  ): Promise<void>
  listAuditEvents(
    humanId: string,
    cursor: string | null,
    limit: number
  ): Promise<ContentRequestAuditPage>
  getProductMetrics(input?: ProductMetricsInput): Promise<ProductMetrics>
  listContext(humanId: string): Promise<Array<ContentContextItem>>
  upsertContext(input: UpsertContentContextInput): Promise<ContentContextItem>
  listContextVersions(
    contextId: string,
    cursor: string | null,
    limit: number
  ): Promise<CursorPage<ContentContextVersion>>
  getContextDeckPreferences(
    humanId: string,
    founderWorkspace?: boolean
  ): Promise<ContextDeckPreferences | null>
  saveContextDeckPreferences(
    humanId: string,
    preferences: ContextDeckPreferences,
    correlationId: string,
    founderWorkspace?: boolean
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
  listAgentJobsPage(
    cursor: string | null,
    limit: number
  ): Promise<CursorPage<AgentJob>>
  claimAgentJob(leaseToken: string, leaseMs: number): Promise<AgentJob | null>
  claimAgentJobForRequest(
    humanId: string,
    leaseToken: string,
    leaseMs: number
  ): Promise<AgentJob | null>
  claimExpertSynthesisJob(
    humanId: string,
    leaseToken: string,
    leaseMs: number
  ): Promise<AgentJob | null>
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
    leaseGeneration: number,
    expectedAggregateVersion?: number
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
    expectedAggregateVersion?: number
  }): Promise<DeliverablePromotionResult>
  setPrimaryDeliverable(input: {
    humanId: string
    deliverableId: string
    expectedPrimaryDeliverableId: string
    correlationId: string
    expectedAggregateVersion?: number
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
    expectedAggregateVersion?: number
  }): Promise<DeliveryTarget>
  setDeliveryTargetRetention(input: {
    targetId: string
    retention: "active" | "archived"
    correlationId: string
    expectedAggregateVersion?: number
  }): Promise<DeliveryTarget>
  listPublicShares(humanId: string): Promise<Array<PublicShareSummary>>
  createPublicShare(input: {
    humanId: string
    contextItemIds: Array<string>
    deliverableIds: Array<string>
    expiresAt?: number
    correlationId: string
    expectedAggregateVersion?: number
  }): Promise<{ share: PublicShareSummary; token: string }>
  revokePublicShare(
    shareId: string,
    correlationId: string,
    expectedAggregateVersion?: number
  ): Promise<PublicShareSummary>
  confirmDeliveryTarget(input: {
    targetId: string
    versionId: string
    note?: string
    integrationSuccessId?: string
    correlationId: string
    expectedAggregateVersion?: number
  }): Promise<DeliveryTarget>
  reopenDeliveryTarget(input: {
    targetId: string
    correlationId: string
    expectedAggregateVersion?: number
  }): Promise<DeliveryTarget>
  proposeAssigneeChange(
    input: AssigneeChangeProposal
  ): Promise<AssigneeChangeResult>
  listOpenSemanticConflicts(humanId: string): Promise<Array<SemanticConflict>>
  resolveSemanticConflict(input: {
    conflictId: string
    selectedValue: string
    correlationId: string
    expectedAggregateVersion?: number
  }): Promise<SemanticConflict>
}

export interface ContentRequestService {
  createManual(input: CreateManualRequestInput): Promise<ContentRequest>
  createExpertInterview(
    input: CreateExpertInterviewInput
  ): Promise<ExpertInterviewCreationResult>
  saveExpertInterviewPackage(
    input: SaveExpertInterviewPackageInput
  ): Promise<ExpertInterviewPackage>
  getExpertInterview(humanId: string): Promise<ExpertInterviewPackage | null>
  listExpertInterviewSubmissions(
    humanId: string
  ): Promise<Array<ExpertInterviewSubmissionSummary>>
  listExpertInterviewContextVersionIds(humanId: string): Promise<Array<string>>
  createExpertSynthesisProcessingSnapshot(input: {
    humanId: string
    submissionIds: Array<string>
    synthesisInstructions?: string
    correlationId: string
  }): Promise<ExpertSynthesisProcessingSnapshot>
  verifyExpertSynthesisProcessingSnapshot(input: {
    humanId: string
    processingToken: string
    submissionIds: Array<string>
  }): Promise<ExpertSynthesisProcessingSnapshot>
  commitExpertSynthesis(
    input: CompleteExpertInterviewProcessingInput
  ): Promise<{
    deliverable: Deliverable
    provenance: ExpertSynthesisProvenance
  }>
  setExpertInterviewSubmissionInclusion(input: {
    humanId: string
    submissionId: string
    included: boolean
    correlationId: string
  }): Promise<ExpertInterviewSubmissionSummary>
  searchPeople(query: string, limit?: number): Promise<PersonSearchResult>
  createPerson(input: CreatePersonInput): Promise<PersonSummary>
  listGuestAccessGrants(
    humanId: string
  ): Promise<Array<GuestAccessGrantSummary>>
  createGuestAccessGrant(
    input: CreateGuestAccessGrantInput
  ): Promise<CreateGuestAccessGrantResult>
  revokeGuestAccessGrant(
    input: MutateGuestAccessGrantInput
  ): Promise<GuestAccessGrantSummary>
  renewGuestAccessGrant(
    input: MutateGuestAccessGrantInput
  ): Promise<RenewGuestAccessGrantResult>
  inspectGuestResponseWorkspace(
    grantId: string
  ): Promise<GuestResponseAdminView | null>
  addGuestResponseAssetFeedback(
    input: AddGuestResponseAssetFeedbackInput
  ): Promise<GuestResponseAdminAssetFeedback>
  addGuestResponseFeedback(
    input: AddGuestResponseFeedbackInput
  ): Promise<GuestResponseAdminFeedback>
  reopenGuestResponseWorkspace(
    input: ReopenGuestResponseWorkspaceInput
  ): Promise<{ locked: false; lockedAt: null; revision: number }>
  getByHumanId(humanId: string): Promise<ContentRequest | null>
  list(limit?: number): Promise<Array<ContentRequest>>
  listFounderWorkspace(
    founderEmail: string,
    limit?: number
  ): Promise<Array<ContentRequest>>
  listPage(
    cursor: string | null,
    limit: number
  ): Promise<CursorPage<ContentRequest>>
  listOperatorWorkspace(
    input?: OperatorWorkspaceInput
  ): Promise<OperatorWorkspacePage>
  getCurrentFounderHandoff(
    humanId: string
  ): Promise<FounderHandoffStatus | null>
  finalizeFounderHandoff(
    input: FinalizeFounderHandoffInput
  ): Promise<FinalizeFounderHandoffResult>
  resolve(query: string): Promise<RequestResolution>
  update(input: UpdateRequestInput): Promise<ContentRequest>
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
    correlationId: string,
    expectedAggregateVersion?: number
  ): Promise<ContentRequest>
  restoreExpired(
    humanId: string,
    expiresAt: number | null,
    correlationId: string
  ): Promise<ContentRequest>
  archive(
    humanId: string,
    correlationId: string,
    expectedAggregateVersion?: number
  ): Promise<ContentRequest>
  restoreArchived(
    humanId: string,
    correlationId: string
  ): Promise<ContentRequest>
  createFollowUp(input: CreateFollowUpInput): Promise<ContentRequest>
  getRelations(humanId: string): Promise<ContentRequestRelations>
  listAssignablePrincipals(): Promise<Array<PrincipalSummary>>
  listMyNotifications(): Promise<Array<ContentNotification>>
  listMyNotificationsPage(
    cursor: string | null,
    limit: number
  ): Promise<CursorPage<ContentNotification>>
  markNotificationRead(
    notificationId: string,
    correlationId: string
  ): Promise<void>
  listAuditEvents(
    humanId: string,
    cursor: string | null,
    limit: number
  ): Promise<ContentRequestAuditPage>
  getProductMetrics(input?: ProductMetricsInput): Promise<ProductMetrics>
  listContext(humanId: string): Promise<Array<ContentContextItem>>
  upsertContext(input: UpsertContentContextInput): Promise<ContentContextItem>
  listContextVersions(
    contextId: string,
    cursor: string | null,
    limit: number
  ): Promise<CursorPage<ContentContextVersion>>
  getContextDeckPreferences(
    humanId: string,
    founderWorkspace?: boolean
  ): Promise<ContextDeckPreferences | null>
  saveContextDeckPreferences(
    humanId: string,
    preferences: ContextDeckPreferences,
    correlationId: string,
    founderWorkspace?: boolean
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
  listAgentJobsPage(
    cursor: string | null,
    limit: number
  ): Promise<CursorPage<AgentJob>>
  claimAgentJob(leaseToken: string, leaseMs: number): Promise<AgentJob | null>
  claimAgentJobForRequest(
    humanId: string,
    leaseToken: string,
    leaseMs: number
  ): Promise<AgentJob | null>
  claimExpertSynthesisJob(
    humanId: string,
    leaseToken: string,
    leaseMs: number
  ): Promise<AgentJob | null>
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
    leaseGeneration: number,
    expectedAggregateVersion?: number
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
    expectedAggregateVersion?: number
  }): Promise<DeliverablePromotionResult>
  setPrimaryDeliverable(input: {
    humanId: string
    deliverableId: string
    expectedPrimaryDeliverableId: string
    correlationId: string
    expectedAggregateVersion?: number
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
    expectedAggregateVersion?: number
  }): Promise<DeliveryTarget>
  setDeliveryTargetRetention(input: {
    targetId: string
    retention: "active" | "archived"
    correlationId: string
    expectedAggregateVersion?: number
  }): Promise<DeliveryTarget>
  listPublicShares(humanId: string): Promise<Array<PublicShareSummary>>
  createPublicShare(input: {
    humanId: string
    contextItemIds: Array<string>
    deliverableIds: Array<string>
    expiresAt?: number
    correlationId: string
    expectedAggregateVersion?: number
  }): Promise<{ share: PublicShareSummary; token: string }>
  revokePublicShare(
    shareId: string,
    correlationId: string,
    expectedAggregateVersion?: number
  ): Promise<PublicShareSummary>
  confirmDeliveryTarget(input: {
    targetId: string
    versionId: string
    note?: string
    integrationSuccessId?: string
    correlationId: string
    expectedAggregateVersion?: number
  }): Promise<DeliveryTarget>
  reopenDeliveryTarget(input: {
    targetId: string
    correlationId: string
    expectedAggregateVersion?: number
  }): Promise<DeliveryTarget>
  proposeAssigneeChange(
    input: AssigneeChangeProposal
  ): Promise<AssigneeChangeResult>
  listOpenSemanticConflicts(humanId: string): Promise<Array<SemanticConflict>>
  resolveSemanticConflict(input: {
    conflictId: string
    selectedValue: string
    correlationId: string
    expectedAggregateVersion?: number
  }): Promise<SemanticConflict>
}

export function createContentRequestService(
  repository: ContentRequestRepository,
  creationOrigin: PersistManualRequestInput["origin"]
): ContentRequestService {
  return {
    createManual: (input) =>
      repository.createManual({ ...input, origin: creationOrigin }),
    createExpertInterview: (input) =>
      repository.createExpertInterview({ ...input, origin: creationOrigin }),
    saveExpertInterviewPackage: (input) =>
      repository.saveExpertInterviewPackage(input),
    getExpertInterview: (humanId) => repository.getExpertInterview(humanId),
    listExpertInterviewSubmissions: (humanId) =>
      repository.listExpertInterviewSubmissions(humanId),
    listExpertInterviewContextVersionIds: (humanId) =>
      repository.listExpertInterviewContextVersionIds(humanId),
    createExpertSynthesisProcessingSnapshot: (input) =>
      repository.createExpertSynthesisProcessingSnapshot(input),
    verifyExpertSynthesisProcessingSnapshot: (input) =>
      repository.verifyExpertSynthesisProcessingSnapshot(input),
    commitExpertSynthesis: (input) => repository.commitExpertSynthesis(input),
    setExpertInterviewSubmissionInclusion: (input) =>
      repository.setExpertInterviewSubmissionInclusion(input),
    searchPeople: (query, limit) => repository.searchPeople(query, limit),
    createPerson: (input) => repository.createPerson(input),
    listGuestAccessGrants: (humanId) =>
      repository.listGuestAccessGrants(humanId),
    createGuestAccessGrant: (input) => repository.createGuestAccessGrant(input),
    revokeGuestAccessGrant: (input) => repository.revokeGuestAccessGrant(input),
    renewGuestAccessGrant: (input) => repository.renewGuestAccessGrant(input),
    inspectGuestResponseWorkspace: (grantId) =>
      repository.inspectGuestResponseWorkspace(grantId),
    addGuestResponseAssetFeedback: (input) =>
      repository.addGuestResponseAssetFeedback(input),
    addGuestResponseFeedback: (input) =>
      repository.addGuestResponseFeedback(input),
    reopenGuestResponseWorkspace: (input) =>
      repository.reopenGuestResponseWorkspace(input),
    getByHumanId: (humanId) => repository.getByHumanId(humanId),
    list: (limit) => repository.list(limit),
    listFounderWorkspace: (founderEmail, limit) =>
      repository.listFounderWorkspace(founderEmail, limit),
    listPage: (cursor, limit) => repository.listPage(cursor, limit),
    listOperatorWorkspace: (input) => repository.listOperatorWorkspace(input),
    getCurrentFounderHandoff: (humanId) =>
      repository.getCurrentFounderHandoff(humanId),
    finalizeFounderHandoff: (input) => repository.finalizeFounderHandoff(input),
    resolve: (query) => repository.resolve(query),
    update: (input) => repository.update(input),
    assign: (input) => repository.assign(input),
    open: (humanId, correlationId) => repository.open(humanId, correlationId),
    setExpiration: (humanId, expiresAt, correlationId) =>
      repository.setExpiration(humanId, expiresAt, correlationId),
    expire: (humanId, reason, correlationId, expectedAggregateVersion) =>
      repository.expire(
        humanId,
        reason,
        correlationId,
        expectedAggregateVersion
      ),
    restoreExpired: (humanId, expiresAt, correlationId) =>
      repository.restoreExpired(humanId, expiresAt, correlationId),
    archive: (humanId, correlationId, expectedAggregateVersion) =>
      repository.archive(humanId, correlationId, expectedAggregateVersion),
    restoreArchived: (humanId, correlationId) =>
      repository.restoreArchived(humanId, correlationId),
    createFollowUp: (input) => repository.createFollowUp(input),
    getRelations: (humanId) => repository.getRelations(humanId),
    listAssignablePrincipals: () => repository.listAssignablePrincipals(),
    listMyNotifications: () => repository.listMyNotifications(),
    listMyNotificationsPage: (cursor, limit) =>
      repository.listMyNotificationsPage(cursor, limit),
    markNotificationRead: (notificationId, correlationId) =>
      repository.markNotificationRead(notificationId, correlationId),
    listAuditEvents: (humanId, cursor, limit) =>
      repository.listAuditEvents(humanId, cursor, limit),
    getProductMetrics: (input) => repository.getProductMetrics(input),
    listContext: (humanId) => repository.listContext(humanId),
    upsertContext: (input) => repository.upsertContext(input),
    listContextVersions: (contextId, cursor, limit) =>
      repository.listContextVersions(contextId, cursor, limit),
    getContextDeckPreferences: (humanId, founderWorkspace) =>
      repository.getContextDeckPreferences(humanId, founderWorkspace),
    saveContextDeckPreferences: (
      humanId,
      preferences,
      correlationId,
      founderWorkspace
    ) =>
      repository.saveContextDeckPreferences(
        humanId,
        preferences,
        correlationId,
        founderWorkspace
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
    listAgentJobsPage: (cursor, limit) =>
      repository.listAgentJobsPage(cursor, limit),
    claimAgentJob: (leaseToken, leaseMs) =>
      repository.claimAgentJob(leaseToken, leaseMs),
    claimAgentJobForRequest: (humanId, leaseToken, leaseMs) =>
      repository.claimAgentJobForRequest(humanId, leaseToken, leaseMs),
    claimExpertSynthesisJob: (humanId, leaseToken, leaseMs) =>
      repository.claimExpertSynthesisJob(humanId, leaseToken, leaseMs),
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
      leaseGeneration,
      expectedAggregateVersion
    ) =>
      repository.failAgentJob(
        jobId,
        leaseToken,
        errorCode,
        transient,
        correlationId,
        leaseGeneration,
        expectedAggregateVersion
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
    revokePublicShare: (shareId, correlationId, expectedAggregateVersion) =>
      repository.revokePublicShare(
        shareId,
        correlationId,
        expectedAggregateVersion
      ),
    confirmDeliveryTarget: (input) => repository.confirmDeliveryTarget(input),
    reopenDeliveryTarget: (input) => repository.reopenDeliveryTarget(input),
    proposeAssigneeChange: (input) => repository.proposeAssigneeChange(input),
    listOpenSemanticConflicts: (humanId) =>
      repository.listOpenSemanticConflicts(humanId),
    resolveSemanticConflict: (input) =>
      repository.resolveSemanticConflict(input),
  }
}
