import { parseScoutReport, type ParsedScoutReport } from "@/domain/scout-report"

export type ScoutIngestionResult = {
  ingestionRunId: string
  status: "applied" | "idempotent_replay"
  created: number
  updated: number
  manualPreserved: number
  requestHumanIds: Array<string>
}

export interface ScoutIngestionRepository {
  authorize(): Promise<void>
  ingest(input: {
    markdown: string
    idempotencyKey: string
  }): Promise<ScoutIngestionResult>
}

export interface ScoutIngestionService {
  authorize(): Promise<void>
  ingest(input: {
    markdown: string
    idempotencyKey: string
    validatedReport?: ParsedScoutReport
  }): Promise<ScoutIngestionResult>
}

export function createScoutIngestionService(
  repository: ScoutIngestionRepository
): ScoutIngestionService {
  return {
    authorize: () => repository.authorize(),
    async ingest(input) {
      const parsed = input.validatedReport
        ? { ok: true as const, report: input.validatedReport }
        : parseScoutReport(input.markdown)
      if (!parsed.ok)
        throw new Error(
          "Scout reports must be validated before repository access."
        )
      return repository.ingest({
        markdown: input.markdown,
        idempotencyKey: input.idempotencyKey,
      })
    },
  }
}
