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

export interface ContentRequestRepository {
  createManual(input: PersistManualRequestInput): Promise<ContentRequest>
  getByHumanId(humanId: string): Promise<ContentRequest | null>
  list(limit?: number): Promise<Array<ContentRequest>>
  resolve(query: string): Promise<RequestResolution>
}

export interface ContentRequestService {
  createManual(input: CreateManualRequestInput): Promise<ContentRequest>
  getByHumanId(humanId: string): Promise<ContentRequest | null>
  list(limit?: number): Promise<Array<ContentRequest>>
  resolve(query: string): Promise<RequestResolution>
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
  }
}
