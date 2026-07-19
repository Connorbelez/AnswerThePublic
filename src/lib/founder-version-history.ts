import type { FounderVersionArchivePage } from "@/application/content-requests"

export async function nextDistinctArchivePage(
  loadPage: (cursor: string | null) => Promise<FounderVersionArchivePage>,
  recentCorrelationIds: ReadonlySet<string>,
  cursor: string | null
): Promise<FounderVersionArchivePage> {
  let nextCursor = cursor
  for (;;) {
    const result = await loadPage(nextCursor)
    const page = result.page.filter(
      (version) => !recentCorrelationIds.has(version.correlationId)
    )
    if (page.length > 0 || result.isDone) return { ...result, page }
    nextCursor = result.continueCursor
  }
}
