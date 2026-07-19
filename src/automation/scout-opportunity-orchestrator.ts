import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import { runContentRequestsCli } from "@/cli/content-requests"
import {
  parseScoutReport,
  type ParsedScoutReport,
  type ScoutParseResult,
} from "@/domain/scout-report"

type OrchestrationIo = {
  writeOut(value: string): void
  writeError(value: string): void
}

type ScoutParser = (markdown: string) => ScoutParseResult
type CliRunner = (
  argv: Parameters<typeof runContentRequestsCli>[0],
  options?: Parameters<typeof runContentRequestsCli>[1]
) => Promise<number>

export type ScoutOpportunityOrchestrationInput = {
  file: string
  idempotencyKey?: string
  validateOnly?: boolean
}

export type ScoutOpportunityOrchestrationOptions = {
  env?: Record<string, string | undefined>
  io?: OrchestrationIo
  parse?: ScoutParser
  readReport?: (path: string) => Promise<string>
  runCli?: CliRunner
}

export const SCOUT_ORCHESTRATION_EXIT = {
  success: 0,
  invalidReport: 2,
  configurationError: 3,
  ingestionError: 4,
} as const

const NON_RETRYABLE_REMOTE_CODES = new Set([
  "AUTHENTICATION_REQUIRED",
  "FORBIDDEN",
  "IDEMPOTENCY_KEY_REUSED",
  "INVALID_JSON",
  "INVALID_SCOUT_REPORT",
  "PAYLOAD_TOO_LARGE",
  "SOURCE_COLLISION_REQUIRES_REMEDIATION",
])

function reportPlan(report: ParsedScoutReport, markdown: string) {
  const reportSha256 = createHash("sha256").update(markdown).digest("hex")
  return {
    reportIdentity: report.reportIdentity,
    parserVersion: report.parserVersion,
    opportunityCount: report.opportunities.length,
    reportSha256,
    idempotencyKey: `scout:${reportSha256.slice(0, 48)}`,
  }
}

function parseJson(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function remoteErrorCode(payload: Record<string, unknown> | null) {
  const error = payload?.error
  if (!error || typeof error !== "object" || Array.isArray(error)) return null
  const code = (error as Record<string, unknown>).code
  return typeof code === "string" ? code : null
}

function remoteData(payload: Record<string, unknown> | null) {
  return payload && "data" in payload ? payload.data : null
}

export async function orchestrateScoutOpportunities(
  input: ScoutOpportunityOrchestrationInput,
  options: ScoutOpportunityOrchestrationOptions = {}
) {
  const env = options.env ?? process.env
  const io = options.io ?? {
    writeOut: (value: string) => process.stdout.write(`${value}\n`),
    writeError: (value: string) => process.stderr.write(`${value}\n`),
  }
  const readReport =
    options.readReport ?? ((path: string) => readFile(path, "utf8"))
  const markdown = await readReport(input.file)
  const parsed = (options.parse ?? parseScoutReport)(markdown)

  if (!parsed.ok) {
    io.writeError(
      JSON.stringify({
        status: "invalid_report",
        reportPath: input.file,
        diagnostics: parsed.diagnostics,
      })
    )
    return SCOUT_ORCHESTRATION_EXIT.invalidReport
  }

  const plan = reportPlan(parsed.report, markdown)
  const idempotencyKey = input.idempotencyKey ?? plan.idempotencyKey
  if (input.validateOnly) {
    io.writeOut(
      JSON.stringify({
        status: "validated",
        reportPath: input.file,
        ...plan,
        idempotencyKey,
      })
    )
    return SCOUT_ORCHESTRATION_EXIT.success
  }

  const apiUrl = (
    env.CONTENT_REQUESTS_API_URL ?? env.FAIRLEND_APP_URL
  )?.replace(/\/$/, "")
  const missing = [
    ...(!apiUrl ? ["CONTENT_REQUESTS_API_URL or FAIRLEND_APP_URL"] : []),
    ...(!env.CONTENT_REQUESTS_ACCESS_TOKEN
      ? ["CONTENT_REQUESTS_ACCESS_TOKEN"]
      : []),
  ]
  if (missing.length > 0) {
    io.writeError(
      JSON.stringify({ status: "configuration_error", missing, ...plan })
    )
    return SCOUT_ORCHESTRATION_EXIT.configurationError
  }

  const runCli = options.runCli ?? runContentRequestsCli
  let lastFailure: Record<string, unknown> = {
    status: "ingestion_error",
    error: "The ingestion command did not complete.",
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const cliOutput: Array<string> = []
    const cliErrors: Array<string> = []
    try {
      const exitCode = await runCli(
        ["ingest", "--file", input.file, "--idempotency-key", idempotencyKey],
        {
          env: {
            ...env,
            CONTENT_REQUESTS_API_URL: apiUrl,
          },
          io: {
            writeOut: (value) => cliOutput.push(value),
            writeError: (value) => cliErrors.push(value),
          },
        }
      )
      const payload = parseJson(cliOutput.at(-1))
      if (exitCode === 0) {
        io.writeOut(
          JSON.stringify({
            status: "ingested",
            reportPath: input.file,
            ...plan,
            idempotencyKey,
            attempt,
            result: remoteData(payload),
          })
        )
        return SCOUT_ORCHESTRATION_EXIT.success
      }

      const code = remoteErrorCode(payload)
      lastFailure = {
        status: "ingestion_error",
        reportPath: input.file,
        ...plan,
        idempotencyKey,
        attempt,
        remoteCode: code,
        remote: payload,
        messages: cliErrors,
      }
      if (code && NON_RETRYABLE_REMOTE_CODES.has(code)) break
    } catch (error) {
      lastFailure = {
        status: "ingestion_error",
        reportPath: input.file,
        ...plan,
        idempotencyKey,
        attempt,
        error: error instanceof Error ? error.message : "CLI execution failed.",
      }
    }
  }

  io.writeError(JSON.stringify(lastFailure))
  return SCOUT_ORCHESTRATION_EXIT.ingestionError
}
