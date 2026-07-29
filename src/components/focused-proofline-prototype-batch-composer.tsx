import { Mic, Pause } from "lucide-react"

import type { FocusedProoflineBatchComposerContext } from "@/components/focused-proofline-answer-surfaces"
import { GuestSubmissionControl } from "@/components/guest-submission-control"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

/**
 * Prototype-only capability adapter. The reusable answer surface intentionally
 * does not depend on submission confirmation or recording workflows.
 */
export function FocusedProoflinePrototypeBatchComposer({
  draft,
  recording,
  submitted,
  questionCount,
  onDraftChange,
  onRecordingChange,
  onSubmit,
}: FocusedProoflineBatchComposerContext) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between gap-3 pb-2">
        <div>
          <strong className="text-sm">Your batch response</strong>
          <p className="text-xs text-muted-foreground">
            {recording
              ? "Recording… speak naturally and cover the questions above."
              : `One response will be mapped across all ${questionCount} questions.`}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {draft.trim() ? "Draft saved" : "Not started"}
        </span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2 md:grid-cols-[auto_1fr_auto] md:items-end">
        <Button
          aria-label={
            recording ? "Stop batch recording" : "Record batch response"
          }
          className={cn(recording && "animate-pulse")}
          onClick={() => onRecordingChange(!recording)}
          size="icon-lg"
          variant={recording ? "destructive" : "outline"}
        >
          {recording ? <Pause /> : <Mic />}
        </Button>
        <Textarea
          aria-label="Batch response"
          className="min-h-12 resize-none bg-background px-3 py-2.5 text-sm"
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={
            recording
              ? "Recording your response…"
              : `Answer naturally across all ${questionCount} questions…`
          }
          value={draft}
        />
        <GuestSubmissionControl
          buttonLabel="Submit expertise"
          canSubmit={Boolean(draft.trim())}
          checklist="Confirm that you covered the real process, Ontario nuance, and at least one concrete case."
          confirmationLabel="Yes, submit expertise"
          description={`This sends your full batch response to the research team as the canonical founder input for all ${questionCount} questions.`}
          onSubmit={onSubmit}
          presentation="prototype"
          submitted={submitted}
          submittedLabel="Expertise submitted"
        />
      </div>
    </div>
  )
}
