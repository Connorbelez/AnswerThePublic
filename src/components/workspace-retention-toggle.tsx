import { Archive, Clock3, Inbox } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type WorkspaceCollection = "active" | "expired" | "archived"

const collectionOptions = [
  {
    value: "active",
    label: "Active",
    ariaLabel: "View active requests",
    icon: Inbox,
  },
  {
    value: "expired",
    label: "Expired",
    ariaLabel: "View expired requests",
    icon: Clock3,
  },
  {
    value: "archived",
    label: "Archive",
    ariaLabel: "View archived requests",
    icon: Archive,
  },
] as const

export function WorkspaceRetentionToggle({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: WorkspaceCollection
  onChange(value: WorkspaceCollection): void
  disabled?: boolean
  className?: string
}) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      role="group"
      aria-label="Request collection"
    >
      <span className="mr-1 text-sm font-medium text-muted-foreground">
        View
      </span>
      {collectionOptions.map((option) => {
        const Icon = option.icon
        const selected = value === option.value

        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={selected ? "default" : "outline"}
            className="min-h-11"
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            <Icon aria-hidden="true" data-icon="inline-start" />
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}
