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
  lifecycle: RequestLifecycle
  disposition: RequestDisposition
  retention: RequestRetention
  aggregateVersion: number
  assignee: PrincipalSummary
  watchers: Array<PrincipalSummary>
  firstOpenedAt: number | null
  latestOpenedAt: number | null
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

export interface ContentRequestRepository {
  createManual(input: PersistManualRequestInput): Promise<ContentRequest>
  getByHumanId(humanId: string): Promise<ContentRequest | null>
  list(limit?: number): Promise<Array<ContentRequest>>
  resolve(query: string): Promise<RequestResolution>
  assign(input: AssignRequestInput): Promise<ContentRequest>
  open(humanId: string, correlationId: string): Promise<ContentRequest>
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
}

export interface ContentRequestService {
  createManual(input: CreateManualRequestInput): Promise<ContentRequest>
  getByHumanId(humanId: string): Promise<ContentRequest | null>
  list(limit?: number): Promise<Array<ContentRequest>>
  resolve(query: string): Promise<RequestResolution>
  assign(input: AssignRequestInput): Promise<ContentRequest>
  open(humanId: string, correlationId: string): Promise<ContentRequest>
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
    resolve: (query) => repository.resolve(query),
    assign: (input) => repository.assign(input),
    open: (humanId, correlationId) => repository.open(humanId, correlationId),
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
  }
}
