import {
  LayoutList,
  MessagesSquare,
  Newspaper,
  PenLine,
  type LucideIcon,
} from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  REQUEST_CATEGORIES,
  REQUEST_CATEGORY_META,
  type RequestCategory,
} from "@/lib/request-classification"
import { cn } from "@/lib/utils"

const CATEGORY_ICONS: Record<RequestCategory, LucideIcon> = {
  community_question: MessagesSquare,
  content_request: PenLine,
  journalist_story: Newspaper,
}

export type RequestCategoryFilterValue = RequestCategory | "all"

/**
 * Category filter chips (Linear/Gmail-style) shared by the operator
 * dashboard, the founder view, and the triage inbox.
 */
export function RequestCategoryFilter({
  value,
  onChange,
  counts,
  className,
}: {
  value: RequestCategoryFilterValue
  onChange: (next: RequestCategoryFilterValue) => void
  counts?: Partial<Record<RequestCategoryFilterValue, number>>
  className?: string
}) {
  const options: ReadonlyArray<RequestCategoryFilterValue> = [
    "all",
    ...REQUEST_CATEGORIES,
  ]
  return (
    <ToggleGroup
      aria-label="Filter by request category"
      value={[value]}
      onValueChange={(values) => {
        const next = values[0] as RequestCategoryFilterValue | undefined
        if (next) onChange(next)
      }}
      variant="outline"
      spacing={1}
      className={cn(
        "request-category-filter w-full max-w-full flex-wrap justify-start",
        className
      )}
    >
      {options.map((option) => {
        const label =
          option === "all" ? "All" : REQUEST_CATEGORY_META[option].label
        const Icon = option === "all" ? LayoutList : CATEGORY_ICONS[option]
        const count = counts?.[option]
        return (
          <ToggleGroupItem
            key={option}
            value={option}
            aria-label={`${label} requests`}
            className="h-auto min-h-8 max-w-full min-w-0 shrink grow basis-[calc(50%-0.25rem)] gap-1.5 py-2 whitespace-normal sm:grow-0 sm:basis-auto"
          >
            <Icon aria-hidden="true" />
            <span className="min-w-0 break-words">{label}</span>
            {typeof count === "number" ? (
              <span className="text-muted-foreground tabular-nums">
                {count}
              </span>
            ) : null}
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}
