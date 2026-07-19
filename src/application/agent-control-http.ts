import {
  agentControlOperations,
  executeAgentControlCommand,
  isAgentControlMutation,
  validateAgentControlCommand,
  type AgentControlCommand,
} from "@/application/agent-control-plane"
import {
  jsonError,
  safeErrorResponse,
  type ContentRequestServiceFactory,
} from "@/application/content-request-http"

const maximumBulkCommands = 25

function parseCommand(input: unknown): AgentControlCommand | null {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return null
  const value = input as Record<string, unknown>
  if (
    typeof value.operation !== "string" ||
    !agentControlOperations.includes(value.operation as never) ||
    (value.arguments !== undefined &&
      (typeof value.arguments !== "object" ||
        value.arguments === null ||
        Array.isArray(value.arguments))) ||
    (value.fields !== undefined &&
      (!Array.isArray(value.fields) ||
        value.fields.length > 50 ||
        !value.fields.every(
          (field) => typeof field === "string" && field.length > 0
        ))) ||
    (value.idempotencyKey !== undefined &&
      (typeof value.idempotencyKey !== "string" ||
        value.idempotencyKey.length === 0 ||
        value.idempotencyKey.length > 200))
  )
    return null
  return value as AgentControlCommand
}

function withCorrelationId(
  command: AgentControlCommand,
  request: Request,
  index: number,
  isBulk: boolean
) {
  const argumentsWithCorrelation = { ...(command.arguments ?? {}) }
  const headerIdempotencyKey = request.headers.get("x-idempotency-key")
  const stableKey =
    command.idempotencyKey ??
    (headerIdempotencyKey
      ? isBulk
        ? `${headerIdempotencyKey}:${index}`
        : headerIdempotencyKey
      : null)
  if (command.operation === "job.claim" && stableKey)
    argumentsWithCorrelation.leaseToken = stableKey
  if (
    stableKey &&
    typeof argumentsWithCorrelation.correlationId === "string" &&
    argumentsWithCorrelation.correlationId !== stableKey
  )
    throw new Error("IDEMPOTENCY_KEY_CONFLICT")
  if (isBulk && isAgentControlMutation(command.operation) && !stableKey)
    throw new Error("BULK_IDEMPOTENCY_KEY_REQUIRED")
  argumentsWithCorrelation.correlationId =
    stableKey ??
    (typeof argumentsWithCorrelation.correlationId === "string"
      ? argumentsWithCorrelation.correlationId
      : (request.headers.get("x-correlation-id") ?? crypto.randomUUID()))
  return { ...command, arguments: argumentsWithCorrelation }
}

function validationError() {
  return jsonError(
    400,
    "VALIDATION_FAILED",
    "The control-plane command is invalid."
  )
}

export function createAgentControlHandler(
  serviceForRequest: ContentRequestServiceFactory
) {
  return {
    GET: async ({ request }: { request: Request }) => {
      try {
        const service = await serviceForRequest(request)
        await service.list(1)
        return Response.json({
          data: {
            operations: agentControlOperations,
            maximumBulkCommands,
          },
        })
      } catch (error) {
        return safeErrorResponse(error)
      }
    },
    POST: async ({ request }: { request: Request }) => {
      let input: unknown
      try {
        input = await request.json()
      } catch {
        return jsonError(400, "INVALID_JSON", "A JSON body is required.")
      }
      const envelope =
        typeof input === "object" && input !== null && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : null
      const isBulk = Array.isArray(envelope?.commands)
      const rawCommands: Array<unknown> = isBulk
        ? (envelope?.commands as Array<unknown>)
        : [envelope?.command ?? input]
      if (rawCommands.length === 0 || rawCommands.length > maximumBulkCommands)
        return validationError()
      const commands = rawCommands.map(parseCommand)
      if (commands.some((command) => command === null)) return validationError()
      let normalized: Array<AgentControlCommand>
      try {
        normalized = (commands as Array<AgentControlCommand>).map(
          (command, index) =>
            validateAgentControlCommand(
              withCorrelationId(command, request, index, isBulk)
            )
        )
      } catch {
        return validationError()
      }
      try {
        const service = await serviceForRequest(request)
        if (!isBulk) {
          return Response.json({
            data: await executeAgentControlCommand(service, normalized[0]!),
          })
        }
        // Authenticate and authorize the whole envelope before executing any
        // commands. Otherwise a lazy repository can turn a global 401/403 into
        // misleading per-item 207 failures.
        await service.list(1)
        const data: Array<Record<string, unknown>> = []
        for (let index = 0; index < normalized.length; index += 1) {
          try {
            data.push({
              index,
              ok: true,
              data: await executeAgentControlCommand(
                service,
                normalized[index]!
              ),
            })
          } catch (error) {
            const response = safeErrorResponse(error)
            const payload = (await response.json()) as {
              error: { code: string; message: string }
            }
            data.push({ index, ok: false, status: response.status, ...payload })
          }
        }
        return Response.json(
          { data },
          { status: data.some((item) => item.ok === false) ? 207 : 200 }
        )
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "UNKNOWN_AGENT_OPERATION" ||
            error.message.startsWith("INVALID_ARGUMENT:"))
        )
          return validationError()
        return safeErrorResponse(error)
      }
    },
  }
}
