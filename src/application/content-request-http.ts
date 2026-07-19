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
  if (
    code === "ROLE_ACCESS_DENIED" ||
    code === "ORGANIZATION_ACCESS_DENIED" ||
    code === "RESOURCE_ACCESS_DENIED"
  ) {
    return jsonError(403, code, "This credential cannot perform that action.")
  }
  if (code === "NOT_FOUND")
    return jsonError(404, code, "The requested resource was not found.")
  if (code === "ASSIGNEE_NOT_FOUND")
    return jsonError(404, code, "The selected assignee was not found.")
  if (code === "LEASE_LOST")
    return jsonError(409, code, "The job lease is no longer active.")
  if (
    code === "DELIVERED_PRIMARY_LOCKED" ||
    code === "DELIVERABLE_ARCHIVED" ||
    code === "PRIMARY_DELIVERABLE_MISSING" ||
    code === "CONFLICT_ALREADY_RESOLVED"
  )
    return jsonError(
      409,
      code,
      code === "DELIVERED_PRIMARY_LOCKED"
        ? "The primary deliverable is locked after delivery."
        : code === "DELIVERABLE_ARCHIVED"
          ? "An archived deliverable cannot become primary."
          : code === "PRIMARY_DELIVERABLE_MISSING"
            ? "The request does not have a primary deliverable."
            : "The semantic conflict was already resolved."
    )
  if (code === "FOUNDER_INPUT_HANDOFF_REQUIRED")
    return jsonError(
      409,
      code,
      "Founder input must be explicitly handed off before reassignment."
    )
  if (
    code === "ORIGINAL_TARGET_REQUIRED" ||
    code === "DELIVERY_TARGET_ALREADY_CONFIRMED" ||
    code === "DELIVERY_ALREADY_CONFIRMED" ||
    code === "DELIVERY_NOT_CONFIRMED" ||
    code === "DELIVERY_TARGET_RETENTION_UNCHANGED" ||
    code === "REQUEST_CHILD_LIMIT_REACHED" ||
    code === "PROMOTED_VERSION_REQUIRED" ||
    code === "HUMAN_CONFIRMATION_REQUIRED" ||
    code === "INTEGRATION_SUCCESS_REQUIRED"
  )
    return jsonError(
      409,
      code,
      "The delivery state does not allow that action."
    )
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

function objectBody(input: unknown) {
  return typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)
    : null
}

async function requestBody(request: Request) {
  try {
    return objectBody(await request.json())
  } catch {
    return null
  }
}

export function createAgentJobCollectionHandler(
  serviceForRequest: ContentRequestServiceFactory
) {
  return {
    GET: async ({ request }: { request: Request }) => {
      try {
        return Response.json({
          data: await (await serviceForRequest(request)).listAgentJobs(),
        })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
    POST: async ({ request }: { request: Request }) => {
      const body = await requestBody(request)
      if (
        body?.action !== "claim" ||
        typeof body.leaseToken !== "string" ||
        typeof body.leaseMs !== "number"
      )
        return jsonError(
          400,
          "VALIDATION_FAILED",
          "The request payload is invalid."
        )
      try {
        return Response.json({
          data: await (
            await serviceForRequest(request)
          ).claimAgentJob(body.leaseToken, body.leaseMs),
        })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
  }
}

export function createAgentJobItemHandler(
  serviceForRequest: ContentRequestServiceFactory
) {
  return {
    GET: async ({
      request,
      params,
    }: {
      request: Request
      params: { jobId: string }
    }) => {
      try {
        return Response.json({
          data: await (
            await serviceForRequest(request)
          ).getAgentJobInput(params.jobId),
        })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
    POST: async ({
      request,
      params,
    }: {
      request: Request
      params: { jobId: string }
    }) => {
      const body = await requestBody(request)
      if (
        !body ||
        typeof body.action !== "string" ||
        typeof body.leaseToken !== "string" ||
        typeof body.leaseGeneration !== "number"
      )
        return jsonError(
          400,
          "VALIDATION_FAILED",
          "The request payload is invalid."
        )
      try {
        const service = await serviceForRequest(request)
        let data
        if (body.action === "heartbeat" && typeof body.leaseMs === "number")
          data = await service.heartbeatAgentJob(
            params.jobId,
            body.leaseToken,
            body.leaseMs,
            body.leaseGeneration
          )
        else if (body.action === "complete" && typeof body.body === "string")
          data = await service.completeAgentJob(
            params.jobId,
            body.leaseToken,
            body.body,
            typeof body.correlationId === "string"
              ? body.correlationId
              : correlationId(request),
            body.leaseGeneration
          )
        else if (
          body.action === "fail" &&
          typeof body.errorCode === "string" &&
          typeof body.transient === "boolean"
        )
          data = await service.failAgentJob(
            params.jobId,
            body.leaseToken,
            body.errorCode,
            body.transient,
            typeof body.correlationId === "string"
              ? body.correlationId
              : correlationId(request),
            body.leaseGeneration
          )
        else
          return jsonError(
            400,
            "VALIDATION_FAILED",
            "The request payload is invalid."
          )
        return Response.json({ data })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
  }
}

export function createDeliverableCollectionHandler(
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
        return Response.json({
          data: await (
            await serviceForRequest(request)
          ).listDeliverables(params.requestId),
        })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
    POST: async ({
      request,
      params,
    }: {
      request: Request
      params: { requestId: string }
    }) => {
      const body = await requestBody(request)
      if (!body || typeof body.action !== "string")
        return jsonError(
          400,
          "VALIDATION_FAILED",
          "The request payload is invalid."
        )
      try {
        const service = await serviceForRequest(request)
        const operationId =
          typeof body.correlationId === "string"
            ? body.correlationId
            : correlationId(request)
        const data =
          body.action === "create_derivative" &&
          typeof body.kind === "string" &&
          typeof body.name === "string" &&
          (body.body === undefined || typeof body.body === "string")
            ? await service.createDerivativeDeliverable({
                humanId: params.requestId,
                kind: body.kind,
                name: body.name,
                body: body.body,
                correlationId: operationId,
              })
            : body.action === "set_primary" &&
                typeof body.deliverableId === "string" &&
                typeof body.expectedPrimaryDeliverableId === "string"
              ? await service.setPrimaryDeliverable({
                  humanId: params.requestId,
                  deliverableId: body.deliverableId,
                  expectedPrimaryDeliverableId:
                    body.expectedPrimaryDeliverableId,
                  correlationId: operationId,
                })
              : null
        return data === null
          ? jsonError(
              400,
              "VALIDATION_FAILED",
              "The request payload is invalid."
            )
          : Response.json({ data })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
  }
}

export function createDeliverableItemHandler(
  serviceForRequest: ContentRequestServiceFactory
) {
  return {
    POST: async ({
      request,
      params,
    }: {
      request: Request
      params: { deliverableId: string }
    }) => {
      const body = await requestBody(request)
      if (!body || typeof body.action !== "string")
        return jsonError(
          400,
          "VALIDATION_FAILED",
          "The request payload is invalid."
        )
      try {
        const service = await serviceForRequest(request)
        const operationId =
          typeof body.correlationId === "string"
            ? body.correlationId
            : correlationId(request)
        const data =
          body.action === "create_version" && typeof body.body === "string"
            ? await service.createDeliverableVersion({
                deliverableId: params.deliverableId,
                body: body.body,
                changeSummary:
                  typeof body.changeSummary === "string"
                    ? body.changeSummary
                    : undefined,
                correlationId: operationId,
              })
            : body.action === "promote" &&
                typeof body.versionId === "string" &&
                (typeof body.expectedPromotedVersionId === "string" ||
                  body.expectedPromotedVersionId === null)
              ? await service.promoteDeliverableVersion({
                  deliverableId: params.deliverableId,
                  versionId: body.versionId,
                  expectedPromotedVersionId: body.expectedPromotedVersionId,
                  correlationId: operationId,
                })
              : null
        return data === null
          ? jsonError(
              400,
              "VALIDATION_FAILED",
              "The request payload is invalid."
            )
          : Response.json({ data })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
  }
}

export function createSemanticConflictCollectionHandler(
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
        return Response.json({
          data: await service.listOpenSemanticConflicts(params.requestId),
        })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
  }
}

export function createSemanticConflictItemHandler(
  serviceForRequest: ContentRequestServiceFactory
) {
  return {
    POST: async ({
      request,
      params,
    }: {
      request: Request
      params: { conflictId: string }
    }) => {
      const body = await requestBody(request)
      if (
        !body ||
        body.action !== "resolve" ||
        typeof body.selectedValue !== "string"
      )
        return jsonError(
          400,
          "VALIDATION_FAILED",
          "The request payload is invalid."
        )
      try {
        const service = await serviceForRequest(request)
        return Response.json({
          data: await service.resolveSemanticConflict({
            conflictId: params.conflictId,
            selectedValue: body.selectedValue,
            correlationId:
              typeof body.correlationId === "string"
                ? body.correlationId
                : correlationId(request),
          }),
        })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
  }
}

export function createDeliveryTargetCollectionHandler(
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
        const url = new URL(request.url)
        if (url.searchParams.get("retention") === "archived") {
          return Response.json({
            data: await service.listArchivedDeliveryTargets(
              params.requestId,
              url.searchParams.get("cursor")
            ),
          })
        }
        return Response.json({
          data: await service.listDeliveryTargets(params.requestId),
        })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
    POST: async ({
      request,
      params,
    }: {
      request: Request
      params: { requestId: string }
    }) => {
      const body = await requestBody(request)
      if (
        !body ||
        body.action !== "create" ||
        typeof body.deliverableId !== "string" ||
        typeof body.channel !== "string" ||
        typeof body.destinationLabel !== "string" ||
        (body.destinationUrl !== undefined &&
          typeof body.destinationUrl !== "string") ||
        (body.isRequired !== undefined && typeof body.isRequired !== "boolean")
      )
        return jsonError(
          400,
          "VALIDATION_FAILED",
          "The request payload is invalid."
        )
      try {
        const service = await serviceForRequest(request)
        const data = await service.createDeliveryTarget({
          humanId: params.requestId,
          deliverableId: body.deliverableId,
          channel: body.channel,
          destinationLabel: body.destinationLabel,
          destinationUrl: body.destinationUrl,
          isRequired: body.isRequired,
          correlationId:
            typeof body.correlationId === "string"
              ? body.correlationId
              : correlationId(request),
        })
        return Response.json({ data }, { status: 201 })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
  }
}

export function createDeliveryTargetItemHandler(
  serviceForRequest: ContentRequestServiceFactory
) {
  return {
    POST: async ({
      request,
      params,
    }: {
      request: Request
      params: { targetId: string }
    }) => {
      const body = await requestBody(request)
      if (!body || typeof body.action !== "string")
        return jsonError(
          400,
          "VALIDATION_FAILED",
          "The request payload is invalid."
        )
      const operationId =
        typeof body.correlationId === "string"
          ? body.correlationId
          : correlationId(request)
      try {
        const service = await serviceForRequest(request)
        const data =
          body.action === "set_required" && typeof body.isRequired === "boolean"
            ? await service.setDeliveryTargetRequired({
                targetId: params.targetId,
                isRequired: body.isRequired,
                correlationId: operationId,
              })
            : body.action === "set_retention" &&
                (body.retention === "active" || body.retention === "archived")
              ? await service.setDeliveryTargetRetention({
                  targetId: params.targetId,
                  retention: body.retention,
                  correlationId: operationId,
                })
              : body.action === "confirm" && typeof body.versionId === "string"
                ? await service.confirmDeliveryTarget({
                    targetId: params.targetId,
                    versionId: body.versionId,
                    note: typeof body.note === "string" ? body.note : undefined,
                    integrationSuccessId:
                      typeof body.integrationSuccessId === "string"
                        ? body.integrationSuccessId
                        : undefined,
                    correlationId: operationId,
                  })
                : body.action === "reopen"
                  ? await service.reopenDeliveryTarget({
                      targetId: params.targetId,
                      correlationId: operationId,
                    })
                  : null
        return data
          ? Response.json({ data })
          : jsonError(
              400,
              "VALIDATION_FAILED",
              "The request payload is invalid."
            )
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
  }
}
