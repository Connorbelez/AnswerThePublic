export type ScoutOpportunitySection = "A" | "B" | "C" | "D"

const sectionChannels: Record<ScoutOpportunitySection, string> = {
  A: "community",
  B: "journalist_request",
  C: "editorial_outreach",
  D: "journalist_story_lead",
}

export function deliveryChannelForScoutSource(
  section: ScoutOpportunitySection,
  sourceUrl: string
) {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase()
    if (host === "reddit.com" || host.endsWith(".reddit.com")) return "reddit"
    if (host === "linkedin.com" || host.endsWith(".linkedin.com"))
      return "linkedin"
    if (host === "facebook.com" || host.endsWith(".facebook.com"))
      return "facebook"
    if (
      host === "x.com" ||
      host.endsWith(".x.com") ||
      host === "twitter.com" ||
      host.endsWith(".twitter.com")
    )
      return "x"
  } catch {
    // Scout URLs are validated upstream. Keep the opportunity category useful
    // if a future runtime applies stricter URL parsing.
  }
  return sectionChannels[section]
}

export function normalizeLegacyDeliveryChannel(
  channel: string | undefined,
  sourceUrl: string | undefined
) {
  const normalized = channel?.trim()
  if (normalized && Object.hasOwn(sectionChannels, normalized))
    return deliveryChannelForScoutSource(
      normalized as ScoutOpportunitySection,
      sourceUrl ?? ""
    )
  return normalized || "original_opportunity"
}
