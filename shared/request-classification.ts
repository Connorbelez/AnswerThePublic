/**
 * Request classification: maps a content request's origin + source channel/URL
 * to (a) a three-way content category and (b) a source platform.
 *
 * Lives in shared/ (no React, no Convex runtime imports) so both the client
 * derivation and a future Convex server-side filter use one source of truth.
 *
 * Phase 2 note: when a stored `category` column lands on contentRequests,
 * readers should prefer the stored value and fall back to `classifyRequest`
 * — call sites must not change.
 */

export type RequestCategory =
  "community_question" | "content_request" | "journalist_story"

export type SourcePlatform =
  | "reddit"
  | "linkedin"
  | "x"
  | "facebook"
  | "chatgpt_app"
  | "manual"
  | "cli"
  | "http_api"
  | "community"
  | "press"
  | "other"

export const REQUEST_CATEGORY_META: Readonly<
  Record<RequestCategory, { label: string }>
> = {
  community_question: { label: "Community question" },
  content_request: { label: "Content request" },
  journalist_story: { label: "Journalist opportunity" },
}

/** Stable order for filter UIs. */
export const REQUEST_CATEGORIES: ReadonlyArray<RequestCategory> = [
  "community_question",
  "content_request",
  "journalist_story",
]

export const SOURCE_PLATFORM_META: Readonly<
  Record<SourcePlatform, { label: string; isBrandGlyph: boolean }>
> = {
  reddit: { label: "Reddit", isBrandGlyph: true },
  linkedin: { label: "LinkedIn", isBrandGlyph: true },
  x: { label: "X", isBrandGlyph: true },
  facebook: { label: "Facebook", isBrandGlyph: true },
  chatgpt_app: { label: "ChatGPT App", isBrandGlyph: false },
  manual: { label: "Manual", isBrandGlyph: false },
  cli: { label: "CLI", isBrandGlyph: false },
  http_api: { label: "HTTP API", isBrandGlyph: false },
  community: { label: "Community", isBrandGlyph: false },
  press: { label: "Press", isBrandGlyph: false },
  other: { label: "Other", isBrandGlyph: false },
}

const JOURNALIST_CHANNELS: ReadonlySet<string> = new Set([
  "journalist_request",
  "journalist_story_lead",
  "editorial_outreach",
])

const COMMUNITY_CHANNELS: ReadonlySet<string> = new Set([
  "reddit",
  "linkedin",
  "x",
  "facebook",
  "community",
  "original_opportunity",
])

/** Mirrors the host rules in shared/delivery-channel.ts. */
export function platformForUrl(
  url: string | null | undefined
): SourcePlatform | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname.toLowerCase()
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
    // Unparseable URL: classification must never throw.
  }
  return null
}

export type ClassificationInput = {
  origin: string
  channel?: string | null
  url?: string | null
}

export type ClassificationResult = {
  category: RequestCategory
  sourcePlatform: SourcePlatform
}

/**
 * Derivation precedence (deterministic):
 *  1. Journalist channels -> journalist_story
 *  2. Community channels or a community-platform URL host -> community_question
 *  3. automated_scout without a channel still came from a scout report ->
 *     community_question
 *  4. Everything else (manual/cli/http_api/chatgpt_app) -> content_request
 */
export function classifyRequest(
  input: ClassificationInput
): ClassificationResult {
  const channel = input.channel?.trim().toLowerCase() || undefined
  const urlPlatform = platformForUrl(input.url)

  let category: RequestCategory
  if (channel && JOURNALIST_CHANNELS.has(channel)) {
    category = "journalist_story"
  } else if ((channel && COMMUNITY_CHANNELS.has(channel)) || urlPlatform) {
    category = "community_question"
  } else if (input.origin === "automated_scout") {
    category = "community_question"
  } else {
    category = "content_request"
  }

  let sourcePlatform: SourcePlatform
  if (
    channel === "reddit" ||
    channel === "linkedin" ||
    channel === "x" ||
    channel === "facebook"
  ) {
    sourcePlatform = channel
  } else if (urlPlatform) {
    sourcePlatform = urlPlatform
  } else if (channel === "community" || channel === "original_opportunity") {
    sourcePlatform = "community"
  } else if (channel && JOURNALIST_CHANNELS.has(channel)) {
    sourcePlatform = "press"
  } else if (
    input.origin === "manual" ||
    input.origin === "chatgpt_app" ||
    input.origin === "cli" ||
    input.origin === "http_api"
  ) {
    sourcePlatform = input.origin
  } else if (input.origin === "automated_scout") {
    sourcePlatform = "community"
  } else {
    sourcePlatform = "other"
  }

  return { category, sourcePlatform }
}
