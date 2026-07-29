import { Badge } from "@/components/ui/badge"
import { SourcePlatformIcon } from "@/components/ui/source-platform-icon"
import type { RequestClassification } from "@/lib/request-classification"
import { cn } from "@/lib/utils"

/**
 * Canonical classification chip: category icon + category label + source
 * platform glyph + source label. Icon + text + color — never color alone.
 */
export function RequestClassificationBadge({
  classification,
  showSource = true,
  className,
}: {
  classification: RequestClassification
  showSource?: boolean
  className?: string
}) {
  const { CategoryIcon, categoryLabel, colorClass, source } = classification
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-auto max-w-full min-w-0 shrink flex-wrap justify-start py-1 whitespace-normal",
        colorClass,
        className
      )}
      data-category={classification.category}
      data-platform={source.platform}
    >
      <CategoryIcon data-icon="inline-start" aria-hidden="true" />
      <span className="min-w-0 break-words">{categoryLabel}</span>
      {showSource ? (
        <>
          <span aria-hidden="true" className="opacity-60">
            ·
          </span>
          <SourcePlatformIcon platform={source.platform} />
          <span className="min-w-0 break-all">{source.label}</span>
        </>
      ) : null}
      <span className="sr-only">
        {showSource
          ? `${categoryLabel}, sourced from ${source.label}`
          : categoryLabel}
      </span>
    </Badge>
  )
}
