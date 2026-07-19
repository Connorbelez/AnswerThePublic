export const operationalTelemetryEvents = [
  "agent_control.completed",
  "agent_control.failed",
] as const

export type OperationalTelemetryEvent =
  (typeof operationalTelemetryEvents)[number]

export type OperationalTelemetryAttributes = {
  operation?: string
  outcome: "ok" | "error"
  status: number
  durationMs: number
  itemCount?: number
}

type TelemetrySink = (serializedEvent: string) => void

const operationPattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/

function boundedInteger(value: number, maximum: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(Math.round(value), 0), maximum)
}

/**
 * Emits an intentionally tiny, aggregate-only operational event. The function
 * reconstructs the payload from a closed allowlist so callers cannot leak raw
 * requests, founder input, transcripts, credentials, or share tokens through
 * accidental object spreading.
 */
export function emitOperationalTelemetry(
  event: OperationalTelemetryEvent,
  attributes: OperationalTelemetryAttributes,
  sink: TelemetrySink = (serializedEvent) =>
    globalThis.console.info(serializedEvent)
) {
  const payload: Record<string, string | number> = {
    event,
    outcome: attributes.outcome,
    status: boundedInteger(attributes.status, 599),
    durationMs: boundedInteger(attributes.durationMs, 86_400_000),
  }
  if (
    attributes.operation &&
    operationPattern.test(attributes.operation) &&
    attributes.operation.length <= 80
  )
    payload.operation = attributes.operation
  if (attributes.itemCount !== undefined)
    payload.itemCount = boundedInteger(attributes.itemCount, 25)
  try {
    sink(JSON.stringify(payload))
  } catch {
    // Observability is strictly best-effort and must never break a request.
  }
}
