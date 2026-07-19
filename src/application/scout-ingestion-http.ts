import { parseScoutReport } from "@/domain/scout-report"
import type { ScoutIngestionService } from "@/application/scout-ingestions"
import { AuthenticationRequiredError } from "@/application/workspace-session"

export type ScoutIngestionServiceFactory = (
  request: Request
) => Promise<ScoutIngestionService>

function errorResponse(
  status: number,
  code: string,
  message: string,
  diagnostics?: unknown
) {
  return Response.json(
    { error: { code, message, ...(diagnostics ? { diagnostics } : {}) } },
    { status }
  )
}

function domainCode(error: unknown) {
  if (
    typeof error === "object" &&
    error &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data &&
    "code" in error.data &&
    typeof error.data.code === "string"
  )
    return error.data.code
  return null
}

async function readBoundedJson(request: Request, maximumBytes: number) {
  if (!request.body)
    return { ok: false as const, reason: "invalid_json" as const }
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > maximumBytes) {
      await reader.cancel()
      return { ok: false as const, reason: "too_large" as const }
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  text += decoder.decode()
  try {
    return { ok: true as const, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false as const, reason: "invalid_json" as const }
  }
}

export function createScoutIngestionHandler(
  serviceForRequest: ScoutIngestionServiceFactory
) {
  return {
    POST: async ({ request }: { request: Request }) => {
      let service: ScoutIngestionService
      try {
        service = await serviceForRequest(request)
        await service.authorize()
      } catch (error) {
        const code = domainCode(error)
        if (
          error instanceof AuthenticationRequiredError ||
          code === "UNAUTHENTICATED" ||
          code === "PRINCIPAL_NOT_PROVISIONED"
        )
          return errorResponse(
            401,
            code ?? "UNAUTHENTICATED",
            "Authentication is required."
          )
        if (
          code === "ROLE_ACCESS_DENIED" ||
          code === "ORGANIZATION_ACCESS_DENIED"
        )
          return errorResponse(
            403,
            code,
            "This credential cannot perform that action."
          )
        return errorResponse(
          500,
          "INTERNAL_ERROR",
          "The scout report could not be ingested."
        )
      }
      const contentLength = Number(request.headers.get("content-length"))
      if (Number.isFinite(contentLength) && contentLength > 400_000) {
        return errorResponse(
          413,
          "PAYLOAD_TOO_LARGE",
          "The scout ingestion payload exceeds the supported limit."
        )
      }
      const body = await readBoundedJson(request, 400_000)
      if (!body.ok && body.reason === "too_large") {
        return errorResponse(
          413,
          "PAYLOAD_TOO_LARGE",
          "The scout ingestion payload exceeds the supported limit."
        )
      }
      if (!body.ok) {
        return errorResponse(
          400,
          "INVALID_JSON",
          "A JSON request body is required."
        )
      }
      const value = body.value
      if (
        typeof value !== "object" ||
        !value ||
        !("markdown" in value) ||
        !("idempotencyKey" in value) ||
        typeof value.markdown !== "string" ||
        typeof value.idempotencyKey !== "string" ||
        !value.idempotencyKey.trim()
      ) {
        return errorResponse(
          400,
          "VALIDATION_FAILED",
          "markdown and idempotencyKey are required strings."
        )
      }
      const parsed = parseScoutReport(value.markdown)
      if (!parsed.ok)
        return errorResponse(
          422,
          "INVALID_SCOUT_REPORT",
          "The complete scout report failed validation.",
          parsed.diagnostics
        )
      try {
        const data = await service.ingest({
          markdown: value.markdown,
          idempotencyKey: value.idempotencyKey.trim(),
          validatedReport: parsed.report,
        })
        return Response.json(
          { data },
          { status: data.status === "applied" ? 201 : 200 }
        )
      } catch (error) {
        const code = domainCode(error)
        if (
          error instanceof AuthenticationRequiredError ||
          code === "UNAUTHENTICATED" ||
          code === "PRINCIPAL_NOT_PROVISIONED"
        )
          return errorResponse(
            401,
            code ?? "UNAUTHENTICATED",
            "Authentication is required."
          )
        if (
          code === "ROLE_ACCESS_DENIED" ||
          code === "ORGANIZATION_ACCESS_DENIED"
        )
          return errorResponse(
            403,
            code,
            "This credential cannot perform that action."
          )
        if (code === "IDEMPOTENCY_KEY_REUSED")
          return errorResponse(
            409,
            code,
            "The idempotency key was already used for different report content."
          )
        if (code === "SOURCE_COLLISION_REQUIRES_REMEDIATION")
          return errorResponse(
            409,
            code,
            "Canonical source duplicates require operator remediation before ingestion."
          )
        return errorResponse(
          500,
          "INTERNAL_ERROR",
          "The scout report could not be ingested."
        )
      }
    },
  }
}
