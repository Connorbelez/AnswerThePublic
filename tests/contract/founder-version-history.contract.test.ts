import { describe, expect, it, vi } from "vitest"

import type { FounderArchivedVersion } from "@/application/content-requests"
import { nextDistinctArchivePage } from "@/lib/founder-version-history"

function archivedVersion(revision: number): FounderArchivedVersion {
  return {
    versionId: `version-${revision}`,
    revision,
    actorPrincipalId: "founder-1",
    actorSubject: "Elie",
    correlationId: `correlation-${revision}`,
    occurredAt: revision,
  }
}

describe("founder version history pagination", () => {
  it("skips recent timeline duplicates before exposing older archive versions", async () => {
    const allVersions = Array.from({ length: 55 }, (_, index) =>
      archivedVersion(55 - index)
    )
    const loadPage = vi.fn(async (cursor: string | null) => {
      const offset = cursor ? Number(cursor) : 0
      const page = allVersions.slice(offset, offset + 20)
      const nextOffset = offset + page.length
      return {
        page,
        isDone: nextOffset >= allVersions.length,
        continueCursor: String(nextOffset),
      }
    })
    const recent = new Set(
      Array.from({ length: 50 }, (_, index) => `correlation-${55 - index}`)
    )

    const result = await nextDistinctArchivePage(loadPage, recent, null)

    expect(result.page.map((version) => version.revision)).toEqual([
      5, 4, 3, 2, 1,
    ])
    expect(loadPage).toHaveBeenCalledTimes(3)
    expect(
      new Set(result.page.map((version) => version.correlationId)).size
    ).toBe(result.page.length)
  })
})
