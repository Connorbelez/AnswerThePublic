import type {
  ContentRequestService,
  CreateManualRequestInput,
} from "@/application/content-requests"
import { AuthenticationRequiredError } from "@/application/workspace-session"

export type ContentRequestServiceFactory = (
  request: Request
) => Promise<ContentRequestService>

function jsonError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status })
}

function domainErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    typeof error.data.code === "string"
  ) {
    return error.data.code
  }
  return null
}

function domainErrorData(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null
    ? (error.data as Record<string, unknown>)
    : null
}

function safeErrorResponse(error: unknown, validationStatus = 400) {
  const code = domainErrorCode(error)
  if (
    error instanceof AuthenticationRequiredError ||
    code === "UNAUTHENTICATED" ||
    code === "PRINCIPAL_NOT_PROVISIONED"
  ) {
    return jsonError(
      401,
      code ?? "UNAUTHENTICATED",
      "Authentication is required."
    )
  }
  if (code === "ROLE_ACCESS_DENIED" || code === "ORGANIZATION_ACCESS_DENIED") {
    return jsonError(403, code, "This credential cannot perform that action.")
  }
  if (code === "VALIDATION_FAILED") {
    return jsonError(validationStatus, code, "The request payload is invalid.")
  }
  if (code === "SOURCE_COLLISION_REQUIRES_REMEDIATION") {
    const requestHumanIds = domainErrorData(error)?.requestHumanIds
    return Response.json(
      {
        error: {
          code,
          message: "Canonical source duplicates require operator remediation.",
          conflictingRequestIds: Array.isArray(requestHumanIds)
            ? requestHumanIds.filter((value) => typeof value === "string")
            : [],
        },
      },
      { status: 409 }
    )
  }
  if (code === "IDEMPOTENCY_KEY_REUSED") {
    return jsonError(
      409,
      code,
      "The correlation ID was already used for different request content."
    )
  }
  return jsonError(500, "INTERNAL_ERROR", "The request could not be completed.")
}

function parseLimit(value: string | null) {
  if (value === null) return undefined
  const limit = Number(value)
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : null
}

function parseManualRequestInput(input: unknown) {
  if (typeof input !== "object" || input === null) return null
  const value = input as Record<string, unknown>
  if (typeof value.title !== "string") return null
  if (
    value.aliases !== undefined &&
    (!Array.isArray(value.aliases) ||
      !value.aliases.every((alias) => typeof alias === "string"))
  ) {
    return null
  }
  if (
    value.correlationId !== undefined &&
    typeof value.correlationId !== "string"
  ) {
    return null
  }
  if (value.source !== undefined) {
    if (typeof value.source !== "object" || value.source === null) return null
    const source = value.source as Record<string, unknown>
    const sourceFields = ["question", "body", "url", "name", "channel"]
    if (
      sourceFields.some(
        (field) =>
          source[field] !== undefined && typeof source[field] !== "string"
      )
    ) {
      return null
    }
  }
  return value as CreateManualRequestInput
}

function correlationId(request: Request) {
  return request.headers.get("x-correlation-id") ?? crypto.randomUUID()
}

export function createContentRequestCollectionHandler(
  serviceForRequest: ContentRequestServiceFactory
) {
  return {
    GET: async ({ request }: { request: Request }) => {
      try {
        const service = await serviceForRequest(request)
        const url = new URL(request.url)
        const search = url.searchParams.get("q")
        const limit = parseLimit(url.searchParams.get("limit"))
        if (limit === null || (search !== null && !search.trim())) {
          return jsonError(
            400,
            "VALIDATION_FAILED",
            "Query parameters are invalid."
          )
        }
        const data = search
          ? await service.resolve(search)
          : await service.list(limit)
        return Response.json({ data })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
    POST: async ({ request }: { request: Request }) => {
      let input: unknown
      try {
        input = await request.json()
      } catch {
        return jsonError(
          400,
          "INVALID_JSON",
          "A JSON request body is required."
        )
      }
      const body = parseManualRequestInput(input)
      if (!body) {
        return jsonError(
          400,
          "VALIDATION_FAILED",
          "The request payload is invalid."
        )
      }
      try {
        const service = await serviceForRequest(request)
        const data = await service.createManual({
          title: body.title,
          source: body.source,
          aliases: body.aliases,
          correlationId: body.correlationId ?? correlationId(request),
        })
        return Response.json({ data }, { status: 201 })
      } catch (error) {
        return safeErrorResponse(error, 422)
      }
    },
  }
}

export function createContentRequestItemHandler(
  serviceForRequest: ContentRequestServiceFactory
) {
  return {
    GET: async ({
      request,
      params,
    }: {
      request: Request
      params: { requestId: string }
    }) => {
      try {
        const service = await serviceForRequest(request)
        const data = await service.getByHumanId(params.requestId)
        return data
          ? Response.json({ data })
          : jsonError(404, "NOT_FOUND", "Content Request not found.")
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
  }
}
