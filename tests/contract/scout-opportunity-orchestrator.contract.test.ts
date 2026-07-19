import { describe, expect, it, vi } from "vitest"

import {
  orchestrateScoutOpportunities,
  SCOUT_ORCHESTRATION_EXIT,
} from "@/automation/scout-opportunity-orchestrator"
import type { ScoutParseResult } from "@/domain/scout-report"

function parsedReport(): ScoutParseResult {
  return {
    ok: true,
    report: {
      reportIdentity: "2026-07-19 14:30 ET",
      parserVersion: "fairlend-scout-v1",
      rawMarkdown: "report",
      opportunities: [],
      demandLedgerMarkdown: "",
    },
  }
}

function harness() {
  const output: Array<string> = []
  const errors: Array<string> = []
  return {
    output,
    errors,
    io: {
      writeOut: (value: string) => output.push(value),
      writeError: (value: string) => errors.push(value),
    },
  }
}

describe("scheduled scout opportunity orchestration", () => {
  it("validates locally and derives a stable content-addressed idempotency key", async () => {
    const first = harness()
    const second = harness()
    const runCli = vi.fn()
    const options = {
      parse: vi.fn().mockReturnValue(parsedReport()),
      readReport: vi.fn().mockResolvedValue("same maintained report"),
      runCli,
    }

    expect(
      await orchestrateScoutOpportunities(
        { file: "report.md", validateOnly: true },
        { ...options, io: first.io }
      )
    ).toBe(SCOUT_ORCHESTRATION_EXIT.success)
    expect(
      await orchestrateScoutOpportunities(
        { file: "report.md", validateOnly: true },
        { ...options, io: second.io }
      )
    ).toBe(SCOUT_ORCHESTRATION_EXIT.success)

    expect(JSON.parse(first.output[0]).idempotencyKey).toBe(
      JSON.parse(second.output[0]).idempotencyKey
    )
    expect(runCli).not.toHaveBeenCalled()
  })

  it("fails closed before any remote call when the report is invalid", async () => {
    const result = harness()
    const runCli = vi.fn()
    const exitCode = await orchestrateScoutOpportunities(
      { file: "invalid.md" },
      {
        io: result.io,
        readReport: vi.fn().mockResolvedValue("invalid"),
        parse: vi.fn().mockReturnValue({
          ok: false,
          diagnostics: [
            {
              code: "MISSING_HEADER",
              message: "Missing",
              path: "report",
              line: 1,
              remediation: "Use the maintained heading.",
            },
          ],
        }),
        runCli,
      }
    )

    expect(exitCode).toBe(SCOUT_ORCHESTRATION_EXIT.invalidReport)
    expect(JSON.parse(result.errors[0])).toMatchObject({
      status: "invalid_report",
      diagnostics: [{ code: "MISSING_HEADER" }],
    })
    expect(runCli).not.toHaveBeenCalled()
  })

  it("uses the existing CLI adapter and the app URL fallback to ingest", async () => {
    const result = harness()
    const runCli = vi.fn(async (_args, options) => {
      options?.io?.writeOut(
        JSON.stringify({ data: { status: "applied", created: 2, updated: 0 } })
      )
      return 0
    })
    const exitCode = await orchestrateScoutOpportunities(
      { file: "report.md" },
      {
        io: result.io,
        env: {
          FAIRLEND_APP_URL: "https://content.example/",
          CONTENT_REQUESTS_ACCESS_TOKEN: "installation-secret",
        },
        readReport: vi.fn().mockResolvedValue("valid report"),
        parse: vi.fn().mockReturnValue(parsedReport()),
        runCli,
      }
    )

    expect(exitCode).toBe(SCOUT_ORCHESTRATION_EXIT.success)
    expect(runCli).toHaveBeenCalledWith(
      expect.arrayContaining(["ingest", "--file", "report.md"]),
      expect.objectContaining({
        env: expect.objectContaining({
          CONTENT_REQUESTS_API_URL: "https://content.example",
          CONTENT_REQUESTS_ACCESS_TOKEN: "installation-secret",
        }),
      })
    )
    expect(JSON.parse(result.output[0])).toMatchObject({
      status: "ingested",
      attempt: 1,
      result: { status: "applied", created: 2 },
    })
  })

  it("reports missing runtime configuration without exposing values", async () => {
    const result = harness()
    const exitCode = await orchestrateScoutOpportunities(
      { file: "report.md" },
      {
        io: result.io,
        env: {},
        readReport: vi.fn().mockResolvedValue("valid report"),
        parse: vi.fn().mockReturnValue(parsedReport()),
      }
    )

    expect(exitCode).toBe(SCOUT_ORCHESTRATION_EXIT.configurationError)
    expect(JSON.parse(result.errors[0])).toMatchObject({
      status: "configuration_error",
      missing: [
        "CONTENT_REQUESTS_API_URL or FAIRLEND_APP_URL",
        "CONTENT_REQUESTS_ACCESS_TOKEN",
      ],
    })
  })

  it("retries one transient failure with the same idempotency key", async () => {
    const result = harness()
    const keys: Array<string> = []
    const runCli = vi.fn(async (args, options) => {
      keys.push(args[args.indexOf("--idempotency-key") + 1])
      if (keys.length === 1) {
        options?.io?.writeOut(
          JSON.stringify({ error: { code: "INTERNAL_ERROR" } })
        )
        return 1
      }
      options?.io?.writeOut(
        JSON.stringify({ data: { status: "idempotent_replay" } })
      )
      return 0
    })

    const exitCode = await orchestrateScoutOpportunities(
      { file: "report.md" },
      {
        io: result.io,
        env: {
          CONTENT_REQUESTS_API_URL: "https://content.example",
          CONTENT_REQUESTS_ACCESS_TOKEN: "installation-secret",
        },
        readReport: vi.fn().mockResolvedValue("valid report"),
        parse: vi.fn().mockReturnValue(parsedReport()),
        runCli,
      }
    )

    expect(exitCode).toBe(SCOUT_ORCHESTRATION_EXIT.success)
    expect(runCli).toHaveBeenCalledTimes(2)
    expect(keys[0]).toBe(keys[1])
    expect(JSON.parse(result.output[0])).toMatchObject({ attempt: 2 })
  })

  it("does not retry validation, authorization, or collision failures", async () => {
    const result = harness()
    const runCli = vi.fn(async (_args, options) => {
      options?.io?.writeOut(
        JSON.stringify({
          error: { code: "SOURCE_COLLISION_REQUIRES_REMEDIATION" },
        })
      )
      return 1
    })

    const exitCode = await orchestrateScoutOpportunities(
      { file: "report.md" },
      {
        io: result.io,
        env: {
          CONTENT_REQUESTS_API_URL: "https://content.example",
          CONTENT_REQUESTS_ACCESS_TOKEN: "installation-secret",
        },
        readReport: vi.fn().mockResolvedValue("valid report"),
        parse: vi.fn().mockReturnValue(parsedReport()),
        runCli,
      }
    )

    expect(exitCode).toBe(SCOUT_ORCHESTRATION_EXIT.ingestionError)
    expect(runCli).toHaveBeenCalledTimes(1)
    expect(JSON.parse(result.errors[0])).toMatchObject({
      remoteCode: "SOURCE_COLLISION_REQUIRES_REMEDIATION",
    })
  })
})
