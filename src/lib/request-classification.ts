import {
  MessagesSquare,
  Newspaper,
  PenLine,
  type LucideIcon,
} from "lucide-react"

import {
  classifyRequest,
  REQUEST_CATEGORIES,
  REQUEST_CATEGORY_META,
  SOURCE_PLATFORM_META,
  type RequestCategory,
  type SourcePlatform,
} from "../../shared/request-classification"

export type { RequestCategory, SourcePlatform }
export { REQUEST_CATEGORIES, REQUEST_CATEGORY_META, SOURCE_PLATFORM_META }

const CATEGORY_ICONS: Record<RequestCategory, LucideIcon> = {
  community_question: MessagesSquare,
  content_request: PenLine,
  journalist_story: Newspaper,
}

const CATEGORY_COLOR_CLASSES: Record<RequestCategory, string> = {
  community_question:
    "text-category-community border-category-community/40 bg-category-community/10",
  content_request:
    "text-category-request border-category-request/40 bg-category-request/10",
  journalist_story:
    "text-category-journalist border-category-journalist/40 bg-category-journalist/10",
}

/**
 * Everything presentational about a request's classification, in one object.
 * Components consume this descriptor and never read origin/channel directly —
 * if classification becomes a stored field later, only this function changes.
 */
export type RequestClassification = {
  category: RequestCategory
  categoryLabel: string
  CategoryIcon: LucideIcon
  colorClass: string
  source: {
    platform: SourcePlatform
    label: string
    isBrandGlyph: boolean
  }
}

export function getRequestClassification(request: {
  origin: string
  source?: { channel?: string; url?: string } | null
}): RequestClassification {
  const { category, sourcePlatform } = classifyRequest({
    origin: request.origin,
    channel: request.source?.channel,
    url: request.source?.url,
  })
  const platformMeta = SOURCE_PLATFORM_META[sourcePlatform]
  return {
    category,
    categoryLabel: REQUEST_CATEGORY_META[category].label,
    CategoryIcon: CATEGORY_ICONS[category],
    colorClass: CATEGORY_COLOR_CLASSES[category],
    source: {
      platform: sourcePlatform,
      label: platformMeta.label,
      isBrandGlyph: platformMeta.isBrandGlyph,
    },
  }
}
