import { useState } from "react"
import { CircleCheck, Send } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { GuestAnswerMode } from "@/application/content-requests"

const submissionButtonVariants = cva("", {
  variants: {
    presentation: {
      prototype: "col-span-2 min-h-12 w-full px-6 md:col-span-1 md:w-auto",
      production: "min-h-12 w-full px-6 sm:w-auto",
    },
  },
  defaultVariants: {
    presentation: "production",
  },
})

type GuestSubmissionControlProps = VariantProps<
  typeof submissionButtonVariants
> & {
  canSubmit: boolean
  submitted: boolean
  submitting?: boolean
  buttonLabel?: string
  submittedLabel?: string
  title?: string
  description?: string
  confirmationLabel?: string
  checklist?: string
  answerModeSelection?: {
    batchHasMaterial: boolean
    oneByOneHasMaterial: boolean
  }
  onSubmit(selectedAnswerMode?: GuestAnswerMode): void | Promise<void>
}

/**
 * The production submission boundary extracted from the approved Focused
 * Proofline prototype. It owns the accessible destructive-confirmation
 * interaction while callers own persistence and evidence state.
 */
export function GuestSubmissionControl({
  canSubmit,
  submitted,
  submitting = false,
  presentation,
  buttonLabel = "Submit response",
  submittedLabel = "Response submitted",
  title = "Are you sure you’re ready to submit?",
  description = "Submitting creates a read-only snapshot of your current response. An administrator can reopen the workspace if you need to add more evidence later.",
  confirmationLabel = "Yes, submit response",
  checklist = "Confirm that your practical sequence, important caveats, and concrete examples are included.",
  answerModeSelection,
  onSubmit,
}: GuestSubmissionControlProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [selectedAnswerMode, setSelectedAnswerMode] =
    useState<GuestAnswerMode>()
  const requiresAnswerModeSelection = Boolean(
    answerModeSelection?.batchHasMaterial &&
    answerModeSelection.oneByOneHasMaterial
  )
  const deterministicAnswerMode =
    answerModeSelection?.batchHasMaterial &&
    !answerModeSelection.oneByOneHasMaterial
      ? ("batch" as const)
      : answerModeSelection?.oneByOneHasMaterial &&
          !answerModeSelection.batchHasMaterial
        ? ("one_by_one" as const)
        : undefined

  return (
    <AlertDialog
      open={confirmOpen}
      onOpenChange={(open) => {
        setConfirmOpen(open)
        if (!open) setSelectedAnswerMode(undefined)
      }}
    >
      <Button
        className={submissionButtonVariants({ presentation })}
        disabled={!canSubmit || submitted || submitting}
        onClick={() => setConfirmOpen(true)}
        type="button"
      >
        {submitted ? (
          <>
            <CircleCheck /> {submittedLabel}
          </>
        ) : (
          <>
            {submitting ? "Submitting…" : buttonLabel} <Send />
          </>
        )}
      </Button>
      <AlertDialogContent className="top-auto bottom-3 translate-y-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-2xl bg-muted/50 p-4 text-sm">
          <strong className="block">Before you submit</strong>
          <span className="mt-1 block text-muted-foreground">{checklist}</span>
        </div>
        {requiresAnswerModeSelection ? (
          <fieldset className="rounded-2xl border border-border/70 p-4">
            <legend className="px-1 text-sm font-semibold">
              Choose which response to submit
            </legend>
            <p className="mb-4 text-sm text-muted-foreground">
              Both response modes contain saved material. Your other draft will
              stay preserved in this workspace.
            </p>
            <RadioGroup
              aria-label="Choose which response to submit"
              onValueChange={(value) =>
                setSelectedAnswerMode(value as GuestAnswerMode)
              }
              value={selectedAnswerMode ?? ""}
            >
              <Label className="flex min-h-12 items-start gap-3 rounded-xl border p-3">
                <RadioGroupItem aria-label="Answer all at once" value="batch" />
                <span>
                  <strong className="block">Answer all at once</strong>
                  <span className="text-muted-foreground">
                    Submit the shared batch response and its batch evidence.
                  </span>
                </span>
              </Label>
              <Label className="flex min-h-12 items-start gap-3 rounded-xl border p-3">
                <RadioGroupItem
                  aria-label="Answer one question at a time"
                  value="one_by_one"
                />
                <span>
                  <strong className="block">
                    Answer one question at a time
                  </strong>
                  <span className="text-muted-foreground">
                    Submit the per-question answers and their evidence.
                  </span>
                </span>
              </Label>
            </RadioGroup>
          </fieldset>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            className="disabled:opacity-100"
            disabled={
              submitting || (requiresAnswerModeSelection && !selectedAnswerMode)
            }
            onClick={async () => {
              await onSubmit(selectedAnswerMode ?? deterministicAnswerMode)
              setConfirmOpen(false)
            }}
          >
            {confirmationLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
