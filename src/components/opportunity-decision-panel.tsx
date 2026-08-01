import { useEffect, useRef, useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Check, CircleCheck, Clock3, Send, X } from "lucide-react"

import {
  archiveContentRequest,
  promoteOpportunity,
  setContentRequestExpiration,
} from "@/application/content-request-server-functions"
import {
  contentFormatDefinitions,
  type ContentFormat,
} from "@/application/promote-opportunity"
import type {
  FounderHandoffStatus,
  PrincipalSummary,
  SemanticConflict,
} from "@/application/content-requests"
import { FounderHandoffStatusCard } from "@/components/founder-handoff-status"
import type { OpportunityRisk } from "@/lib/opportunity-brief"
import { cn } from "@/lib/utils"
import { triggerHaptic } from "@/lib/haptics"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"

type OpportunityDecisionPanelProps = {
  humanId: string
  recipient: PrincipalSummary | null
  formats: Array<ContentFormat>
  onFormatsChange(formats: Array<ContentFormat>): void
  risk: OpportunityRisk
  readOnly?: boolean
  className?: string
  compact?: boolean
  actionBar?: boolean
  onPromoted?(): void
  founderHandoff?: FounderHandoffStatus | null
}

function promotionError(
  result:
    | { outcome: "blocked"; reason: string }
    | { outcome: "attention_required"; conflict: SemanticConflict }
) {
  if (result.outcome === "attention_required") {
    return "This opportunity changed while you were reviewing it. Resolve the attention item, then try again."
  }
  if (result.reason === "candidate_version_missing") {
    return "A response draft is required before this opportunity can be promoted."
  }
  if (result.reason === "primary_deliverable_missing") {
    return "The primary response is missing. Restore it before promoting."
  }
  if (result.reason === "request_inactive") {
    return "This opportunity is archived or expired. Restore it before promoting."
  }
  return "This opportunity could not be found. Refresh the queue and try again."
}

export function OpportunityDecisionPanel({
  humanId,
  recipient,
  formats,
  onFormatsChange,
  risk,
  readOnly = false,
  className,
  compact = false,
  actionBar = false,
  onPromoted,
  founderHandoff = null,
}: OpportunityDecisionPanelProps) {
  const router = useRouter()
  const promote = useServerFn(promoteOpportunity)
  const archive = useServerFn(archiveContentRequest)
  const setExpiration = useServerFn(setContentRequestExpiration)
  const promoteButtonRef = useRef<HTMLButtonElement>(null)
  const touchInitiated = useRef(false)
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [optimisticHandoff, setOptimisticHandoff] =
    useState<FounderHandoffStatus | null>(null)
  const [resolution, setResolution] = useState<"passed" | "snoozed" | null>(
    null
  )
  const activeHandoff = founderHandoff ?? optimisticHandoff
  const displayedFormats = activeHandoff?.selectedFormats ?? formats

  const toggleFormat = (format: ContentFormat, checked: boolean) => {
    if (format === "original_response" || activeHandoff) return
    const next = new Set(formats)
    if (checked) next.add(format)
    else next.delete(format)
    onFormatsChange(
      contentFormatDefinitions
        .map((definition) => definition.id)
        .filter((id) => next.has(id))
    )
  }

  const submit = async () => {
    if (!recipient || readOnly || pending) return
    const wasTouchInitiated = touchInitiated.current
    touchInitiated.current = false
    setPending(true)
    setError(null)
    try {
      const result = await promote({
        data: {
          humanId,
          recipientPrincipalId: recipient.principalId,
          formats,
          note: note.trim() || undefined,
          correlationId: crypto.randomUUID(),
        },
      })
      if (
        result.outcome === "blocked" ||
        result.outcome === "attention_required"
      ) {
        setError(promotionError(result))
        return
      }
      setOptimisticHandoff({ ...result.handoff, stage: "delivered" })
      triggerHaptic("success", { touchInitiated: wasTouchInitiated })
      onPromoted?.()
      await router.invalidate()
    } catch {
      setError(
        "Promotion failed before it completed. Nothing was hidden—refresh and try again."
      )
    } finally {
      setPending(false)
    }
  }

  const resolveWithoutPromotion = async (action: "pass" | "snooze") => {
    if (readOnly || pending) return
    const wasTouchInitiated = touchInitiated.current
    touchInitiated.current = false
    setPending(true)
    setError(null)
    try {
      if (action === "pass") {
        await archive({
          data: { humanId, correlationId: crypto.randomUUID() },
        })
        setResolution("passed")
        triggerHaptic("warning", { touchInitiated: wasTouchInitiated })
      } else {
        await setExpiration({
          data: {
            humanId,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            correlationId: crypto.randomUUID(),
          },
        })
        setResolution("snoozed")
        triggerHaptic("selection", { touchInitiated: wasTouchInitiated })
      }
      await router.invalidate()
    } catch {
      setError(
        action === "pass"
          ? "Pass failed before it completed. Refresh and try again."
          : "Snooze failed before it completed. Refresh and try again."
      )
    } finally {
      setPending(false)
    }
  }

  useEffect(() => {
    if (compact || actionBar || readOnly || resolution || activeHandoff) return
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      const formatIndex = Number(event.key) - 1
      const format = contentFormatDefinitions[formatIndex]
      if (format && format.id !== "original_response") {
        event.preventDefault()
        toggleFormat(format.id, !formats.includes(format.id))
        return
      }
      if (event.key.toLowerCase() === "p") {
        event.preventDefault()
        void submit()
      } else if (event.key.toLowerCase() === "x") {
        event.preventDefault()
        void resolveWithoutPromotion("pass")
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault()
        void resolveWithoutPromotion("snooze")
      } else if (event.key.toLowerCase() === "e") {
        event.preventDefault()
        promoteButtonRef.current?.focus()
      }
    }
    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  })

  if (resolution) {
    const copy = {
      passed: ["Opportunity passed", "Removed from the review queue."],
      snoozed: [
        "Snoozed for 24 hours",
        "This opportunity will return to the review queue tomorrow.",
      ],
    }[resolution]
    return (
      <section
        className={cn("triage-decision triage-decision--success", className)}
        aria-live="polite"
      >
        <CircleCheck aria-hidden="true" />
        <div>
          <h2>{copy[0]}</h2>
          <p>{copy[1]}</p>
        </div>
      </section>
    )
  }

  if (actionBar && activeHandoff) {
    return (
      <FounderHandoffStatusCard
        handoff={activeHandoff}
        variant="compact"
        className={className}
      />
    )
  }

  if (actionBar) {
    return (
      <section
        className={cn("triage-decision-bar", className)}
        aria-label="Opportunity actions"
      >
        {error ? (
          <p className="triage-decision-bar__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="triage-decision-bar__recipient">
          <Avatar>
            <AvatarFallback>EB</AvatarFallback>
          </Avatar>
          <strong>Elie</strong>
          <span>· {displayedFormats.length} outputs</span>
        </div>
        <Button
          type="button"
          size="lg"
          onClick={() => void submit()}
          onPointerDown={(event) => {
            touchInitiated.current = event.pointerType === "touch"
          }}
          disabled={readOnly || pending || !recipient}
          aria-label="Promote to Elie"
        >
          <Send data-icon="inline-start" />
          {pending ? "Working…" : "Promote"}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={() => void resolveWithoutPromotion("pass")}
          onPointerDown={(event) => {
            touchInitiated.current = event.pointerType === "touch"
          }}
          disabled={readOnly || pending}
          aria-label="Pass on opportunity"
        >
          Pass
        </Button>
      </section>
    )
  }

  return (
    <section
      className={cn("triage-decision", className)}
      aria-label="Route opportunity"
    >
      <div className="triage-decision__section">
        <div className="triage-decision__heading">
          <h2>Route</h2>
          {!compact ? <Kbd>E</Kbd> : null}
        </div>
        {recipient ? (
          <div className="triage-recipient" data-selected="true">
            <Avatar size="lg">
              <AvatarFallback>EB</AvatarFallback>
            </Avatar>
            <div>
              <strong>Elie</strong>
              <span>Founder · Content owner</span>
            </div>
            <Check aria-label="Selected recipient" />
          </div>
        ) : (
          <p className="form-error" role="alert">
            No founder is available for assignment.
          </p>
        )}
      </div>

      <Separator />

      <div className="triage-decision__secondary-actions">
        <Button
          type="button"
          variant="outline"
          onClick={() => void resolveWithoutPromotion("pass")}
          disabled={readOnly || pending || Boolean(activeHandoff)}
          aria-label="Pass on opportunity"
        >
          <X data-icon="inline-start" /> Pass {!compact ? <Kbd>X</Kbd> : null}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void resolveWithoutPromotion("snooze")}
          disabled={readOnly || pending || Boolean(activeHandoff)}
          aria-label="Snooze opportunity for 24 hours"
        >
          <Clock3 data-icon="inline-start" /> Snooze{" "}
          {!compact ? <Kbd>S</Kbd> : null}
        </Button>
      </div>

      <Separator />

      <div className="triage-decision__section">
        <div className="triage-decision__heading">
          <h2>Repurpose</h2>
          <span>{displayedFormats.length} selected</span>
        </div>
        <div
          className="triage-format-list"
          role="group"
          aria-label="Content formats"
        >
          {contentFormatDefinitions.map((format, index) => {
            const checked = displayedFormats.includes(format.id)
            const required = format.id === "original_response"
            const recommended = ["blog_article", "linkedin_post"].includes(
              format.id
            )
            return (
              <div className="triage-format" key={format.id}>
                {!compact ? <Kbd>{index + 1}</Kbd> : null}
                <Checkbox
                  id={`triage-format-${compact ? "compact-" : ""}${format.id}`}
                  checked={checked}
                  disabled={readOnly || required || Boolean(activeHandoff)}
                  onCheckedChange={(value) =>
                    toggleFormat(format.id, value === true)
                  }
                />
                <label
                  htmlFor={`triage-format-${compact ? "compact-" : ""}${format.id}`}
                >
                  {format.label}
                </label>
                {required ? <Badge variant="secondary">Required</Badge> : null}
                {recommended ? (
                  <Badge variant="outline">Recommended</Badge>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      {!compact && !activeHandoff ? (
        <div className="triage-decision__section">
          <label className="triage-note">
            <span>
              Note for Elie <small>(optional)</small>
            </span>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add handoff context…"
              disabled={readOnly}
            />
          </label>
        </div>
      ) : null}

      {activeHandoff ? (
        <FounderHandoffStatusCard
          handoff={activeHandoff}
          variant={compact ? "compact" : "detail"}
        />
      ) : (
        <div className="triage-promotion-summary">
          <div>
            <strong>To Elie · {formats.length} outputs</strong>
            <span>
              {risk
                ? `${risk[0].toUpperCase()}${risk.slice(1)} compliance risk`
                : "Source and evidence included"}
            </span>
          </div>
          <Button
            ref={promoteButtonRef}
            type="button"
            size="lg"
            onClick={() => void submit()}
            disabled={readOnly || pending || !recipient}
            aria-label="Promote to Elie"
          >
            <Send data-icon="inline-start" />
            {pending ? "Promoting…" : compact ? "Promote" : "Promote to Elie"}
            {!compact && !pending ? <Kbd>P</Kbd> : null}
          </Button>
        </div>
      )}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
