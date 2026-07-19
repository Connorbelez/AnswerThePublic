const SUBSTANTIAL_REWRITE_TOKEN_CHANGE_RATE = 0.2

function tokenCounts(value: string) {
  const counts = new Map<string, number>()
  for (const token of value
    .toLocaleLowerCase("en-CA")
    .match(/[\p{L}\p{N}]+/gu) ?? [])
    counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

/**
 * Classify material language replacement without persisting either body in
 * telemetry. Formatting, punctuation, and small editorial changes are ignored.
 */
export function isSubstantialRewrite(original: string, revised: string) {
  const originalCounts = tokenCounts(original)
  const revisedCounts = tokenCounts(revised)
  const originalSize = [...originalCounts.values()].reduce(
    (total, count) => total + count,
    0
  )
  const revisedSize = [...revisedCounts.values()].reduce(
    (total, count) => total + count,
    0
  )
  const comparisonSize = Math.max(originalSize, revisedSize)
  if (comparisonSize === 0) return false

  let shared = 0
  for (const [token, count] of originalCounts)
    shared += Math.min(count, revisedCounts.get(token) ?? 0)
  return 1 - shared / comparisonSize >= SUBSTANTIAL_REWRITE_TOKEN_CHANGE_RATE
}
