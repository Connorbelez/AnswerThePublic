import { cva, type VariantProps } from "class-variance-authority"
import { CircleCheck, Clock3, Send } from "lucide-react"

import type { FounderHandoffStatus } from "@/application/content-requests"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const founderHandoffStatusVariants = cva("", {
  variants: {
    variant: {
      detail: "triage-promotion-summary founder-handoff-status",
      compact: "inline-flex min-w-0 items-center",
    },
  },
  defaultVariants: {
    variant: "detail",
  },
})

const stageLabels: Record<FounderHandoffStatus["stage"], string> = {
  delivered: "Delivered to Elie",
  opened: "Opened by Elie",
  draft_in_progress: "Draft in progress",
  founder_complete: "Elie complete",
  agent_drafting: "Agent drafting",
  ready: "Ready",
  attention_required: "Drafting needs attention",
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
  }).format(timestamp)
}

export function FounderHandoffStatusCard({
  handoff,
  variant = "detail",
  className,
}: {
  handoff: FounderHandoffStatus
  className?: string
} & VariantProps<typeof founderHandoffStatusVariants>) {
  const label = stageLabels[handoff.stage]
  const recipientLabel =
    handoff.recipient.role === "founder" ? "Elie" : handoff.recipient.subject
  if (variant === "compact")
    return (
      <span
        className={cn(founderHandoffStatusVariants({ variant }), className)}
        data-handoff-stage={handoff.stage}
      >
        <Badge
          variant={
            handoff.stage === "attention_required" ? "destructive" : "secondary"
          }
        >
          To {recipientLabel}: {label}
        </Badge>
      </span>
    )

  return (
    <Card
      className={cn(founderHandoffStatusVariants({ variant }), className)}
      data-handoff-stage={handoff.stage}
      aria-label="Founder handoff status"
    >
      <div className="founder-handoff-status__heading">
        <div>
          <strong>To {recipientLabel}</strong>
          <span>{label}</span>
        </div>
        <CircleCheck aria-hidden="true" />
      </div>
      <div className="founder-handoff-status__metadata">
        <Badge variant="outline">
          {handoff.selectedFormats.length}{" "}
          {handoff.selectedFormats.length === 1 ? "output" : "outputs"}
        </Badge>
        <Badge variant="outline">
          <Send data-icon="inline-start" />
          Delivered {formatTimestamp(handoff.deliveredAt)}
        </Badge>
        {handoff.openedAt ? (
          <Badge variant="outline">
            <Clock3 data-icon="inline-start" />
            Opened {formatTimestamp(handoff.openedAt)}
          </Badge>
        ) : null}
        {handoff.emailStatus ? (
          <Badge variant="outline">Email {handoff.emailStatus}</Badge>
        ) : null}
      </div>
    </Card>
  )
}
