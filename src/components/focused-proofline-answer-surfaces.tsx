import { useState, type ReactNode } from "react"
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleCheck,
  Mic,
  Pause,
  RotateCcw,
} from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Progress, ProgressLabel } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export type FocusedProoflineAnswerQuestion = {
  id: string
  question: string
  motivation: string
  proofLabel?: string
  required?: boolean
}

const batchSurfaceVariants = cva("mx-auto max-w-5xl bg-background", {
  variants: {
    presentation: {
      prototype: "pb-56 md:pb-36",
      production: "pb-28",
    },
  },
  defaultVariants: {
    presentation: "prototype",
  },
})

const batchComposerVariants = cva(
  "z-40 border-t border-border/80 bg-background/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl",
  {
    variants: {
      presentation: {
        prototype:
          "fixed right-0 bottom-0 left-0 shadow-[0_-16px_40px_-24px_rgba(0,0,0,0.45)]",
        production: "relative right-auto bottom-auto left-auto shadow-none",
      },
    },
    defaultVariants: {
      presentation: "prototype",
    },
  }
)

const focusedSurfaceVariants = cva("mx-auto flex flex-col bg-background", {
  variants: {
    presentation: {
      prototype: "min-h-[72svh] max-w-6xl",
      production: "min-h-[72svh] max-w-5xl",
    },
  },
  defaultVariants: {
    presentation: "prototype",
  },
})

export type FocusedProoflineBatchComposerContext = {
  draft: string
  recording: boolean
  submitted: boolean
  questionCount: number
  onDraftChange(value: string): void
  onRecordingChange(value: boolean): void
  onSubmit(): void
}

export type FocusedProoflineBatchAnswersProps = VariantProps<
  typeof batchSurfaceVariants
> & {
  questions: ReadonlyArray<FocusedProoflineAnswerQuestion>
  draft: string
  recording: boolean
  submitted: boolean
  variantLabel?: string
  onDraftChange(value: string): void
  onRecordingChange(value: boolean): void
  onSubmit(): void
  renderComposer?(context: FocusedProoflineBatchComposerContext): ReactNode
  renderQuestionSupplement?(question: FocusedProoflineAnswerQuestion): ReactNode
  className?: string
}

/**
 * The expanded Focused Proofline batch response surface. Question hierarchy,
 * motivation context, and responsive composer placement stay behind this seam;
 * production callers may inject their persisted composer without rebuilding the
 * approved visual structure.
 */
export function FocusedProoflineBatchAnswers({
  questions,
  draft,
  recording,
  submitted,
  variantLabel,
  onDraftChange,
  onRecordingChange,
  onSubmit,
  renderComposer,
  renderQuestionSupplement,
  presentation = "prototype",
  className,
}: FocusedProoflineBatchAnswersProps) {
  const questionCount = questions.length
  const composerContext: FocusedProoflineBatchComposerContext = {
    draft,
    recording,
    submitted,
    questionCount,
    onDraftChange,
    onRecordingChange,
    onSubmit,
  }

  return (
    <section className={cn(batchSurfaceVariants({ presentation }), className)}>
      <div className="border-b border-border/70 px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="destructive">Critical</Badge>
              <Badge variant="outline">Answer all at once</Badge>
              {variantLabel ? (
                <Badge variant="secondary">{variantLabel}</Badge>
              ) : null}
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em]">
              One response. Every research question in view.
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Talk through the request naturally. The researcher will map your
              response back to each question and surface any missing follow-ups.
            </p>
          </div>
          <span className="text-sm font-semibold">
            {questionCount} questions · expanded
          </span>
        </div>
      </div>

      <div className="divide-y divide-border/70 px-4 md:px-8">
        {questions.map((question, index) => (
          <article
            className="py-6 md:grid md:grid-cols-[2.5rem_1fr] md:gap-4 md:py-7"
            key={question.id}
          >
            <span className="grid size-8 place-items-center rounded-full border text-xs font-semibold">
              {index + 1}
            </span>
            <div className="mt-3 min-w-0 md:mt-0">
              {question.proofLabel || question.required !== undefined ? (
                <div className="flex flex-wrap items-center gap-2">
                  {question.proofLabel ? (
                    <Badge variant="secondary">{question.proofLabel}</Badge>
                  ) : null}
                  {question.required !== undefined ? (
                    <span className="text-xs text-muted-foreground">
                      {question.required ? "Required" : "Optional"}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <h3 className="mt-3 text-lg leading-7 font-semibold">
                {question.question}
              </h3>
              <div className="mt-3 rounded-2xl bg-muted/45 p-4">
                <p className="text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                  Why we’re asking
                </p>
                <p className="mt-1.5 text-sm leading-6">
                  {question.motivation}
                </p>
              </div>
              {renderQuestionSupplement?.(question)}
            </div>
          </article>
        ))}
      </div>

      <div className={batchComposerVariants({ presentation })}>
        {renderComposer ? (
          renderComposer(composerContext)
        ) : (
          <DefaultBatchComposer {...composerContext} />
        )}
      </div>
    </section>
  )
}

/**
 * Capability-neutral fallback used by the reusable visual surface. Product
 * submission confirmation is deliberately supplied by a caller-owned adapter.
 */
function DefaultBatchComposer({
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
        <Button
          disabled={!draft.trim() || submitted}
          onClick={onSubmit}
          type="button"
        >
          {submitted ? "Expertise submitted" : "Submit expertise"}
        </Button>
      </div>
    </div>
  )
}

export type FocusedProoflineAnswerEditorContext = {
  question: FocusedProoflineAnswerQuestion
  questionIndex: number
  answer: string
  disabled: boolean
  onAnswer(value: string): void
}

export type FocusedProoflineQuestionAnswersProps = VariantProps<
  typeof focusedSurfaceVariants
> & {
  questions: ReadonlyArray<FocusedProoflineAnswerQuestion>
  activeQuestionIndex: number
  answers: Readonly<Record<string, string>>
  skipped?: ReadonlyArray<string>
  disabled?: boolean
  savedLabel?: string
  onAnswer(id: string, answer: string): void
  onPrevious(): void
  onNext(): void
  onSkip(id: string): void
  onJump(index: number): void
  renderAnswerEditor?(context: FocusedProoflineAnswerEditorContext): ReactNode
  onViewSupportingResearch?(questionId: string): void
  className?: string
}

/**
 * The Focused Proofline one-question-at-a-time surface. It owns the mobile
 * disclosure rows, desktop interview rail, active-question hierarchy, and
 * previous/skip/next navigation while allowing a persisted editor adapter.
 */
export function FocusedProoflineQuestionAnswers({
  questions,
  activeQuestionIndex,
  answers,
  skipped = [],
  disabled = false,
  savedLabel = "Saved",
  onAnswer,
  onPrevious,
  onNext,
  onSkip,
  onJump,
  renderAnswerEditor,
  onViewSupportingResearch,
  presentation = "prototype",
  className,
}: FocusedProoflineQuestionAnswersProps) {
  const boundedIndex = Math.min(
    Math.max(activeQuestionIndex, 0),
    Math.max(questions.length - 1, 0)
  )
  const question = questions[boundedIndex]
  const completeCount = questions.filter(({ id }) =>
    Boolean(answers[id])
  ).length
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(
    presentation === "production" ? null : (question?.id ?? null)
  )

  if (!question) return null

  const editorContext: FocusedProoflineAnswerEditorContext = {
    question,
    questionIndex: boundedIndex,
    answer: answers[question.id] ?? "",
    disabled,
    onAnswer: (value) => onAnswer(question.id, value),
  }

  return (
    <section
      className={cn(focusedSurfaceVariants({ presentation }), className)}
    >
      <div className="border-b border-border/70 px-4 py-4 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge variant="destructive">Critical</Badge>
            <span className="text-sm font-medium">Expertise request</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              Question {boundedIndex + 1} of {questions.length}
            </span>
            <span>{savedLabel}</span>
          </div>
        </div>
        <Progress
          className="mt-3"
          value={((boundedIndex + 1) / questions.length) * 100}
        >
          <ProgressLabel className="sr-only">Interview progress</ProgressLabel>
        </Progress>
        <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 lg:hidden">
          {questions.map((item, index) => {
            const answered = Boolean(answers[item.id])
            const isSkipped = skipped.includes(item.id)
            const expanded = expandedQuestionId === item.id
            return (
              <Collapsible
                key={item.id}
                onOpenChange={(open) => {
                  setExpandedQuestionId(open ? item.id : null)
                  if (open) onJump(index)
                }}
                open={expanded}
              >
                <CollapsibleTrigger
                  render={
                    <button
                      aria-label={`${index + 1}. ${item.question}`}
                      className={cn(
                        "flex w-full items-center gap-3 bg-background px-3 py-3 text-left",
                        index === boundedIndex && "bg-muted/60"
                      )}
                      type="button"
                    />
                  }
                >
                  {answered ? (
                    <CircleCheck className="size-4 shrink-0 text-emerald-700" />
                  ) : isSkipped ? (
                    <RotateCcw className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <span className="grid size-5 shrink-0 place-items-center rounded-full border text-[10px]">
                      {index + 1}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <strong className="block text-xs">
                      Question {index + 1}
                      {item.proofLabel ? ` · ${item.proofLabel}` : ""}
                    </strong>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {item.question}
                    </span>
                  </span>
                  <ChevronRight
                    className={cn(
                      "size-4 shrink-0 transition-transform",
                      expanded && "rotate-90"
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="bg-muted/25 px-4 pt-1 pb-4">
                    <p className="text-sm leading-6">{item.question}</p>
                    <div className="mt-3 rounded-xl bg-background p-3">
                      <p className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
                        Why we’re asking
                      </p>
                      <p className="mt-1 text-xs leading-5">
                        {item.motivation}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      {item.required !== undefined ? (
                        <span className="text-xs text-muted-foreground">
                          {item.required ? "Required" : "Optional"}
                        </span>
                      ) : (
                        <span />
                      )}
                      <Button
                        disabled={disabled}
                        onClick={() => {
                          onJump(index)
                          setExpandedQuestionId(item.id)
                        }}
                        size="sm"
                      >
                        Answer this question
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      </div>

      <div className="grid flex-1 lg:grid-cols-[14rem_1fr]">
        <aside className="hidden border-r border-border/70 bg-muted/15 p-4 lg:block">
          <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
            All questions
          </p>
          <div className="mt-3 space-y-1">
            {questions.map((item, index) => {
              const answered = Boolean(answers[item.id])
              const isSkipped = skipped.includes(item.id)
              return (
                <button
                  aria-label={`${index + 1} ${item.question}`}
                  aria-current={index === boundedIndex ? "step" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm",
                    index === boundedIndex
                      ? "bg-foreground text-background"
                      : "hover:bg-muted"
                  )}
                  disabled={disabled}
                  key={item.id}
                  onClick={() => onJump(index)}
                  type="button"
                >
                  {answered ? (
                    <CircleCheck className="size-4 shrink-0" />
                  ) : isSkipped ? (
                    <RotateCcw className="size-4 shrink-0" />
                  ) : (
                    <span className="grid size-4 shrink-0 place-items-center rounded-full border text-[9px]">
                      {index + 1}
                    </span>
                  )}
                  <span className="line-clamp-2">{item.question}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {completeCount} answered · {skipped.length} skipped
          </p>
        </aside>

        <div className="flex min-w-0 flex-col px-4 py-8 md:px-10 md:py-12">
          <div className="mx-auto w-full max-w-2xl flex-1">
            {question.proofLabel ? (
              <Badge variant="secondary">{question.proofLabel}</Badge>
            ) : null}
            <h2 className="mt-5 text-2xl leading-tight font-semibold tracking-[-0.035em] md:text-4xl">
              {question.question}
            </h2>
            <div className="mt-6 rounded-2xl bg-muted/60 p-4">
              <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                Why we’re asking
              </p>
              <p className="mt-2 text-sm leading-6">{question.motivation}</p>
              {presentation === "prototype" || onViewSupportingResearch ? (
                <Button
                  className="mt-2 px-0"
                  onClick={() => onViewSupportingResearch?.(question.id)}
                  type="button"
                  variant="link"
                >
                  <BookOpen /> View supporting research
                </Button>
              ) : null}
            </div>
            {renderAnswerEditor ? (
              renderAnswerEditor(editorContext)
            ) : (
              <PrototypeFocusedAnswerEditor {...editorContext} />
            )}
          </div>
          <div className="mx-auto mt-8 flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
            <Button
              disabled={disabled || boundedIndex === 0}
              onClick={onPrevious}
              variant="ghost"
            >
              <ArrowLeft /> Previous
            </Button>
            <div className="flex gap-2">
              <Button
                disabled={disabled}
                onClick={() => onSkip(question.id)}
                variant="outline"
              >
                Skip
              </Button>
              <Button
                disabled={disabled || boundedIndex === questions.length - 1}
                onClick={onNext}
              >
                Save & next <ArrowRight />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function PrototypeFocusedAnswerEditor({
  questionIndex,
  answer,
  disabled,
  onAnswer,
}: FocusedProoflineAnswerEditorContext) {
  return (
    <Tabs className="mt-7" defaultValue="type">
      <TabsList>
        <TabsTrigger value="type">Type</TabsTrigger>
        <TabsTrigger value="record">
          <Mic /> Record
        </TabsTrigger>
      </TabsList>
      <TabsContent value="type">
        <Textarea
          aria-label={`Answer to question ${questionIndex + 1}`}
          className="min-h-44 bg-muted/40 p-4 text-base leading-7"
          disabled={disabled}
          onChange={(event) => onAnswer(event.target.value)}
          placeholder="Share a concrete example, process, or rule of thumb…"
          value={answer}
        />
      </TabsContent>
      <TabsContent value="record">
        <div className="grid min-h-44 place-items-center rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center">
          <div>
            <Button disabled={disabled} size="lg">
              <Mic /> Press to record
            </Button>
            <p className="mt-3 text-sm text-muted-foreground">
              The transcript will be attached to this answer.
            </p>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )
}
