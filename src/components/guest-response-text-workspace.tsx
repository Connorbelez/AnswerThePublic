"use client"

import { useMemo, useState, type ReactNode } from "react"

import type {
  GuestAnswerMode,
  GuestResponseWorkspace,
} from "@/application/content-requests"
import {
  FocusedProoflineBatchAnswers,
  FocusedProoflineQuestionAnswers,
  type FocusedProoflineAnswerQuestion,
} from "@/components/focused-proofline-answer-surfaces"
import { Button } from "@/components/ui/button"
import { Progress, ProgressLabel } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"

type GuestResponseTextWorkspaceProps = {
  workspace: GuestResponseWorkspace
  questions: ReadonlyArray<FocusedProoflineAnswerQuestion>
  disabled?: boolean
  savedLabel?: string
  onAnswerModeChange(answerMode: GuestAnswerMode): void
  onBatchTextChange(text: string): void
  onQuestionAnswerChange(questionId: string, text: string): void
  renderQuestionSupplement?(questionId: string): ReactNode
  capabilityFooter?: ReactNode
}

function responseProgress(workspace: GuestResponseWorkspace) {
  return {
    completed:
      workspace.answerMode === "batch"
        ? workspace.batchText.trim()
          ? workspace.questionAnswers.length
          : 0
        : workspace.questionAnswers.filter(({ text }) => text.trim()).length,
    total: workspace.questionAnswers.length,
  }
}

/**
 * Ticket 03's capability-independent text workspace. Lease coordination,
 * evidence, submission, and other downstream capabilities compose around this
 * seam instead of being prerequisites for rendering or testing the core modes.
 */
export function GuestResponseTextWorkspace({
  workspace,
  questions,
  disabled = false,
  savedLabel = "Saved",
  onAnswerModeChange,
  onBatchTextChange,
  onQuestionAnswerChange,
  renderQuestionSupplement,
  capabilityFooter,
}: GuestResponseTextWorkspaceProps) {
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0)
  const progress = responseProgress(workspace)
  const completion = progress.total
    ? (progress.completed / progress.total) * 100
    : 0
  const answers = useMemo(
    () =>
      Object.fromEntries(
        workspace.questionAnswers.map(({ questionId, text }) => [
          questionId,
          text,
        ])
      ),
    [workspace.questionAnswers]
  )
  const jump = (index: number) =>
    setActiveQuestionIndex(
      Math.min(Math.max(index, 0), Math.max(questions.length - 1, 0))
    )

  return (
    <>
      <Progress
        aria-label="Response progress"
        className="mt-6"
        value={completion}
      >
        <ProgressLabel>Response progress</ProgressLabel>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {progress.completed} of {progress.total} answered
        </span>
      </Progress>

      <div className="pointer-events-auto fixed right-0 bottom-0 left-0 isolate z-[100] border-t border-border/80 bg-background/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-24px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div
          aria-label="Answer mode"
          className="mx-auto grid max-w-5xl grid-cols-2 overflow-hidden rounded-2xl border border-foreground bg-foreground shadow-xl"
          role="group"
        >
          <Button
            aria-pressed={workspace.answerMode === "batch"}
            className="min-h-16 justify-center rounded-none border-r border-background/20 px-3 text-sm sm:text-base"
            disabled={disabled}
            onClick={() => onAnswerModeChange("batch")}
            type="button"
            variant={workspace.answerMode === "batch" ? "default" : "ghost"}
          >
            Answer all at once
          </Button>
          <Button
            aria-pressed={workspace.answerMode === "one_by_one"}
            className="min-h-16 justify-center rounded-none px-3 text-sm sm:text-base"
            disabled={disabled}
            onClick={() => onAnswerModeChange("one_by_one")}
            type="button"
            variant={
              workspace.answerMode === "one_by_one" ? "default" : "ghost"
            }
          >
            Answer one at a time
          </Button>
        </div>
      </div>

      {workspace.answerMode === "batch" ? (
        <FocusedProoflineBatchAnswers
          className="mt-8"
          draft={workspace.batchText}
          onDraftChange={onBatchTextChange}
          onRecordingChange={() => undefined}
          onSubmit={() => undefined}
          presentation="production"
          questions={questions}
          recording={false}
          renderQuestionSupplement={(question) =>
            renderQuestionSupplement?.(question.id)
          }
          renderComposer={() => (
            <div className="mx-auto max-w-5xl px-1">
              <label
                className="block text-sm font-semibold"
                htmlFor="guest-batch-response"
              >
                Your complete response
              </label>
              <Textarea
                className="mt-2 min-h-48"
                disabled={disabled}
                id="guest-batch-response"
                onChange={(event) => onBatchTextChange(event.target.value)}
                placeholder="Share the sequence, examples, caveats, and practical details that matter."
                value={workspace.batchText}
              />
            </div>
          )}
          submitted={Boolean(workspace.locked)}
        />
      ) : (
        <FocusedProoflineQuestionAnswers
          activeQuestionIndex={activeQuestionIndex}
          answers={answers}
          className="mt-8"
          disabled={disabled}
          onAnswer={onQuestionAnswerChange}
          onJump={jump}
          onNext={() => jump(activeQuestionIndex + 1)}
          onPrevious={() => jump(activeQuestionIndex - 1)}
          onSkip={() => jump(activeQuestionIndex + 1)}
          presentation="production"
          questions={questions}
          renderAnswerEditor={({ question, answer, disabled, onAnswer }) => (
            <div className="mt-7">
              {renderQuestionSupplement?.(question.id)}
              <label
                className="block font-semibold"
                htmlFor={`guest-answer-${question.id}`}
              >
                Your answer
              </label>
              <Textarea
                className="mt-2 min-h-44 bg-muted/40 p-4 text-base leading-7"
                disabled={disabled}
                id={`guest-answer-${question.id}`}
                onChange={(event) => onAnswer(event.target.value)}
                value={answer}
              />
            </div>
          )}
          savedLabel={savedLabel}
        />
      )}

      {capabilityFooter}
      <div
        aria-hidden="true"
        className="h-[calc(5.75rem+env(safe-area-inset-bottom))]"
        data-guest-response-footer-spacer=""
      />
    </>
  )
}
