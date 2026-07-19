// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest"

import { emitOperationalTelemetry } from "@/infrastructure/operational-telemetry"

describe("operational telemetry privacy contract", () => {
  it("serializes only the closed operational allowlist", () => {
    const lines: Array<string> = []
    emitOperationalTelemetry(
      "agent_control.completed",
      {
        operation: "request.create",
        outcome: "ok",
        status: 201,
        durationMs: 12.6,
        itemCount: 1,
        sourceBody: "must-not-leak-source",
        founderInput: "must-not-leak-founder-input",
        transcript: "must-not-leak-transcript",
        credential: "must-not-leak-credential",
        shareToken: "must-not-leak-share-token",
      } as never,
      (line) => lines.push(line)
    )

    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toEqual({
      event: "agent_control.completed",
      operation: "request.create",
      outcome: "ok",
      status: 201,
      durationMs: 13,
      itemCount: 1,
    })
    expect(lines[0]).not.toContain("must-not-leak")
  })

  it("drops malformed operation labels and survives a broken sink", () => {
    const lines: Array<string> = []
    expect(() =>
      emitOperationalTelemetry(
        "agent_control.failed",
        {
          operation: "source body: secret",
          outcome: "error",
          status: Number.POSITIVE_INFINITY,
          durationMs: -4,
        },
        (line) => lines.push(line)
      )
    ).not.toThrow()
    expect(JSON.parse(lines[0]!)).toEqual({
      event: "agent_control.failed",
      outcome: "error",
      status: 0,
      durationMs: 0,
    })
    expect(() =>
      emitOperationalTelemetry(
        "agent_control.failed",
        { outcome: "error", status: 500, durationMs: 1 },
        () => {
          throw new Error("sink unavailable")
        }
      )
    ).not.toThrow()
  })
})
