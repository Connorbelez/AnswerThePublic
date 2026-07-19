const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/
const ISO_DATES = /\b\d{4}-\d{2}-\d{2}\b/g
const RELATIVE_DURATION =
  /^(?:(?:respond|reply|submit|due|deadline)\s+)?within\s+(\d+)\s*(hour|hours|day|days)[.!]?$/i

/**
 * Converts only explicit, machine-checkable timing language into an expiry.
 * Ambiguous labels such as "soon" and "while active" intentionally return
 * undefined so automation cannot discard work on a guess.
 */
export function inferExpirationAt(
  timingLabel: string | undefined,
  now: number
) {
  const value = timingLabel?.trim()
  if (!value) return undefined
  const dateMatches = value.match(ISO_DATES) ?? []
  const isoDate =
    dateMatches.length === 1 ? value.match(ISO_DATE)?.[1] : undefined
  if (isoDate) {
    const parsed = Date.parse(`${isoDate}T23:59:59.999Z`)
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined
    const [year, month, day] = isoDate.split("-").map(Number)
    const roundTrip = new Date(parsed)
    return roundTrip.getUTCFullYear() === year &&
      roundTrip.getUTCMonth() === month - 1 &&
      roundTrip.getUTCDate() === day
      ? parsed
      : undefined
  }
  const relative = value.match(RELATIVE_DURATION)
  if (!relative) return undefined
  const amount = Number(relative[1])
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 365) {
    return undefined
  }
  const unitMs = relative[2].toLocaleLowerCase("en-CA").startsWith("hour")
    ? 60 * 60 * 1_000
    : 24 * 60 * 60 * 1_000
  return now + amount * unitMs
}

export function expirationTimingIdentity(timingLabel: string | undefined) {
  const value = timingLabel?.trim()
  if (!value) return undefined
  const dateMatches = value.match(ISO_DATES) ?? []
  const isoDate =
    dateMatches.length === 1 ? value.match(ISO_DATE)?.[1] : undefined
  if (isoDate) return `date:${isoDate}`
  const relative = value.match(RELATIVE_DURATION)
  if (!relative) return undefined
  const unit = relative[2].toLocaleLowerCase("en-CA").startsWith("hour")
    ? "hours"
    : "days"
  return `relative:${Number(relative[1])}:${unit}`
}
