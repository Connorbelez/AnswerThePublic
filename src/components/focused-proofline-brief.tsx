import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type FocusedProoflineQuestion = {
  id: string
  question: string
  motivation: string
  proofLabel?: string
  gapLabel?: string
  required?: boolean
}

export type FocusedProoflineBriefData = {
  topic: string
  summary: string
  audience: string
  framing: Array<string>
  fairlendPosture: string
  respondentContribution: string
}

export type FocusedProoflineRequest = {
  humanId: string
  title: string
}

type FocusedProoflineBriefProps = {
  request: FocusedProoflineRequest
  brief: FocusedProoflineBriefData
  questions: Array<FocusedProoflineQuestion>
  eyebrow?: string
  priorityLabel?: string
  requestTypeLabel?: string
  statusLabel?: string
  directedBy?: string
  durationLabel?: string
  contributionLabel?: string
  previewTitle?: string
  titleAs?: "h1" | "h2"
  actionFooter?: ReactNode
  className?: string
}

export function FocusedProoflineBrief({
  request,
  brief,
  questions,
  eyebrow = "Article brief",
  priorityLabel = "Critical",
  requestTypeLabel = "Expert interview",
  statusLabel,
  directedBy,
  durationLabel,
  contributionLabel = "What we need from you",
  previewTitle = "What we’ll ask—and why",
  titleAs = "h1",
  actionFooter,
  className,
}: FocusedProoflineBriefProps) {
  const Title = titleAs
  const resolvedDuration =
    durationLabel ?? `${questions.length} questions · about 12 minutes`

  return (
    <section
      className={cn(
        "focused-proofline-brief mx-auto max-w-5xl bg-background",
        actionFooter && "pb-28",
        className
      )}
      aria-labelledby="focused-proofline-title"
    >
      <div className="border-b border-border/70 px-5 py-8 md:px-10 md:py-12">
        <div className="flex flex-wrap items-center gap-2">
          {priorityLabel ? (
            <Badge variant="destructive">{priorityLabel}</Badge>
          ) : null}
          <Badge variant="outline">{requestTypeLabel}</Badge>
          {statusLabel ? (
            <Badge variant="secondary">{statusLabel}</Badge>
          ) : null}
        </div>
        <p className="mt-7 text-xs font-bold tracking-[0.16em] text-muted-foreground uppercase">
          {eyebrow}
        </p>
        <Title
          id="focused-proofline-title"
          className="mt-3 max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.045em] text-balance md:text-5xl"
        >
          {request.title}
        </Title>
        <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
          {brief.summary}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span>
            <strong className="text-foreground">{request.humanId}</strong>
          </span>
          {directedBy ? <span>Operator directed by {directedBy}</span> : null}
          <span>{resolvedDuration}</span>
        </div>
      </div>

      <div className="grid gap-px bg-border/70 md:grid-cols-2">
        <BriefField label="Topic">
          <p>{brief.topic}</p>
        </BriefField>
        <BriefField label="Audience">
          <p>{brief.audience}</p>
        </BriefField>
        <BriefField label="Framing">
          <div className="flex flex-wrap gap-2">
            {brief.framing.map((frame) => (
              <Badge key={frame} variant="secondary">
                {frame}
              </Badge>
            ))}
          </div>
        </BriefField>
        <BriefField label="FairLend posture">
          <p>{brief.fairlendPosture}</p>
        </BriefField>
        <BriefField className="md:col-span-2" label={contributionLabel}>
          <p>{brief.respondentContribution}</p>
        </BriefField>
      </div>

      <div className="border-t border-border/70 px-5 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
              Interview preview
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
              {previewTitle}
            </h2>
          </div>
          <span className="text-sm text-muted-foreground">
            {resolvedDuration}
          </span>
        </div>
        <ol className="mt-6 divide-y divide-border/70 border-y border-border/70">
          {questions.map((question, index) => (
            <li className="py-5 md:py-6" key={question.id}>
              <article className="flex items-start gap-3 md:gap-4">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-xs font-semibold"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
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
                  <h3 className="mt-3 text-base leading-6 font-semibold md:text-lg">
                    {question.question}
                  </h3>
                  <div className="mt-3 rounded-2xl bg-muted/45 p-4">
                    <p className="text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                      Motivation
                    </p>
                    <p className="mt-1.5 text-sm leading-6">
                      {question.motivation}
                    </p>
                    {question.gapLabel ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Research gap: {question.gapLabel}
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ol>
      </div>

      {actionFooter}
    </section>
  )
}

function BriefField({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("bg-background p-5 md:p-7", className)}>
      <h2 className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </h2>
      <div className="mt-3 text-sm leading-6">{children}</div>
    </div>
  )
}
