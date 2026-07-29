import { useRef, useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"

import type {
  GuestResponseAdminAssetFeedback,
  GuestResponseAdminFeedback,
  GuestResponseAdminView,
} from "@/application/content-requests"
import {
  addGuestResponseAssetFeedback,
  addGuestResponseFeedback,
  reopenGuestResponseWorkspace,
} from "@/application/content-request-server-functions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Progress, ProgressLabel } from "@/components/ui/progress"

type FeedbackScope =
  | { kind: "workspace" }
  | { kind: "question"; questionId: string }
  | { kind: "asset"; assetId: string }

function questionLabel(view: GuestResponseAdminView, questionId: string) {
  const currentQuestion = view.questions.find(
    (question) => question.questionId === questionId
  )
  if (currentQuestion) return currentQuestion.question
  const snapshot = [...view.submissions]
    .reverse()
    .flatMap((submission) => submission.questions)
    .find((question) => question.questionId === questionId)
  return snapshot?.question ?? questionId
}

function snapshotQuestionLabel(
  submission: GuestResponseAdminView["submissions"][number],
  questionId: string
) {
  return (
    submission.questions.find((question) => question.questionId === questionId)
      ?.question ?? questionId
  )
}

function GuestResponseAdminCard({
  view,
  disabled,
  onAddFeedback,
  onReopen,
}: {
  view: GuestResponseAdminView
  disabled: boolean
  onAddFeedback: (input: {
    grantId: string
    scope: FeedbackScope
    body: string
  }) => Promise<GuestResponseAdminFeedback | GuestResponseAdminAssetFeedback>
  onReopen: (grantId: string) => Promise<unknown>
}) {
  const [feedbackTarget, setFeedbackTarget] = useState("workspace")
  const [feedbackBody, setFeedbackBody] = useState("")
  const [pending, setPending] = useState<"feedback" | "reopen" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sendFeedback = async () => {
    const body = feedbackBody.trim()
    if (!body || pending) return
    const scope: FeedbackScope =
      feedbackTarget === "workspace"
        ? { kind: "workspace" }
        : feedbackTarget.startsWith("asset:")
          ? { kind: "asset", assetId: feedbackTarget.slice("asset:".length) }
          : { kind: "question", questionId: feedbackTarget }
    setPending("feedback")
    setError(null)
    try {
      await onAddFeedback({ grantId: view.grantId, scope, body })
      setFeedbackBody("")
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not add feedback."
      )
    } finally {
      setPending(null)
    }
  }

  const reopen = async () => {
    if (pending) return
    setPending("reopen")
    setError(null)
    try {
      await onReopen(view.grantId)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not reopen response."
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle as="h4">{view.assignedPerson.displayName}</CardTitle>
        <CardDescription>
          Read-only respondent evidence · revision {view.workspace.revision}
        </CardDescription>
        <CardAction>
          <Badge variant={view.workspace.locked ? "secondary" : "outline"}>
            {view.workspace.locked ? "Submitted" : "In progress"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <Progress
          aria-label={`Response progress for ${view.assignedPerson.displayName}`}
          value={
            view.workspace.progress.total
              ? (view.workspace.progress.completed /
                  view.workspace.progress.total) *
                100
              : 0
          }
        >
          <ProgressLabel>Progress</ProgressLabel>
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {view.workspace.progress.completed} of{" "}
            {view.workspace.progress.total} answered
          </span>
        </Progress>
        {view.workspace.batchText.trim() ? (
          <section
            aria-label={`${view.assignedPerson.displayName}: Complete response`}
          >
            <h5
              className="mb-2 text-sm font-medium"
              id={`${view.grantId}-batch-answer`}
            >
              Complete response
            </h5>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {view.workspace.batchText}
            </p>
          </section>
        ) : null}
        {view.workspace.questionAnswers.length ? (
          <div className="space-y-4">
            <h5 className="text-sm font-medium">Question responses</h5>
            {view.workspace.questionAnswers.map((answer) => (
              <section
                aria-label={`${view.assignedPerson.displayName}: ${questionLabel(view, answer.questionId)}`}
                key={answer.questionId}
              >
                <h5
                  className="mb-1 text-sm font-medium"
                  id={`${view.grantId}-${answer.questionId}`}
                >
                  {questionLabel(view, answer.questionId)}
                </h5>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {answer.text || "No response yet."}
                </p>
              </section>
            ))}
          </div>
        ) : null}
        {!view.workspace.batchText.trim() &&
        !view.workspace.questionAnswers.some(({ text }) => text.trim()) ? (
          <p className="text-sm text-muted-foreground">No response yet.</p>
        ) : null}

        {view.workspace.feedback?.length ? (
          <section aria-label="Administrator feedback" className="space-y-2">
            <h5 className="text-sm font-medium">Administrator feedback</h5>
            {view.workspace.feedback.map((feedback) => (
              <div
                className="rounded-2xl border px-3 py-2 text-sm"
                key={feedback.feedbackId}
              >
                <p>{feedback.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {feedback.author.displayName}
                  {feedback.scope.kind === "question"
                    ? ` · ${questionLabel(view, feedback.scope.questionId)}`
                    : " · Whole response"}
                </p>
              </div>
            ))}
          </section>
        ) : null}

        {view.assets?.length ? (
          <section aria-label="Response evidence" className="space-y-3">
            <h5 className="text-sm font-medium">Response evidence</h5>
            {view.assets.map(({ asset, feedback }) => (
              <article
                aria-label={`Evidence: ${asset.fileName}`}
                className="rounded-2xl border p-3"
                id={`guest-access-${view.grantId}-asset-${asset.assetId}`}
                key={asset.assetId}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h6 className="text-sm font-medium">{asset.fileName}</h6>
                    <p className="text-xs text-muted-foreground">
                      {asset.kind === "audio"
                        ? "Audio recording"
                        : "Attachment"}
                      {" · "}
                      {asset.scope.kind === "batch"
                        ? "Whole response"
                        : questionLabel(view, asset.scope.questionId)}
                      {" · "}
                      {asset.mimeType}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {asset.transcriptionState === "transcribed"
                      ? "Transcribed"
                      : asset.uploadState === "uploaded"
                        ? "Uploaded"
                        : asset.uploadState}
                  </Badge>
                </div>
                {asset.transcript ? (
                  <div
                    aria-label={`Transcript for ${asset.fileName}`}
                    className="mt-3 rounded-xl bg-muted/40 p-3"
                  >
                    <p className="text-xs font-medium">
                      Attributed transcript · version {asset.transcriptVersion}
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
                      {asset.transcript}
                    </p>
                  </div>
                ) : null}
                {asset.downloadUrl ? (
                  <a
                    className="mt-3 inline-flex text-sm font-medium underline underline-offset-4"
                    href={asset.downloadUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open evidence file
                  </a>
                ) : null}
                {feedback.length ? (
                  <div
                    aria-label={`Feedback for ${asset.fileName}`}
                    className="mt-3 space-y-2"
                  >
                    {feedback.map((entry) => (
                      <div
                        className="rounded-xl border px-3 py-2 text-sm"
                        key={entry.feedbackId}
                      >
                        <p>{entry.body}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.author.displayName}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </section>
        ) : null}

        {view.submissions.length ? (
          <section aria-label="Immutable submission history">
            <h5 className="text-sm font-medium">Submission history</h5>
            <ol className="mt-2 space-y-3">
              {view.submissions.map((submission) => (
                <li
                  className="rounded-2xl border p-3"
                  key={submission.submissionId}
                >
                  <p className="text-xs text-muted-foreground">
                    Revision {submission.workspaceRevision} submitted by{" "}
                    {submission.respondent.displayName} at{" "}
                    {new Date(submission.submittedAt).toLocaleString()}
                  </p>
                  {submission.batchText.trim() ? (
                    <div className="mt-3">
                      <h6 className="text-xs font-medium">
                        Complete response snapshot
                      </h6>
                      <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
                        {submission.batchText}
                      </p>
                    </div>
                  ) : null}
                  {submission.questionAnswers.length ? (
                    <div className="mt-3 space-y-3">
                      <h6 className="text-xs font-medium">
                        Question response snapshots
                      </h6>
                      {submission.questionAnswers.map((answer) => (
                        <div key={answer.questionId}>
                          <p className="text-xs font-medium">
                            {snapshotQuestionLabel(
                              submission,
                              answer.questionId
                            )}
                          </p>
                          <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
                            {answer.text || "No response provided."}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {submission.assetSnapshots?.length ? (
                    <div className="mt-3">
                      <h6 className="text-xs font-medium">
                        Evidence snapshot membership
                      </h6>
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {submission.assetSnapshots.map((snapshot) => {
                          const currentAsset = view.assets?.find(
                            ({ asset }) => asset.assetId === snapshot.assetId
                          )?.asset
                          return (
                            <li key={`${snapshot.assetId}:${snapshot.version}`}>
                              {currentAsset?.fileName ?? snapshot.assetId} ·{" "}
                              {snapshot.kind} · asset version {snapshot.version}
                              {snapshot.kind === "audio"
                                ? ` · transcript version ${snapshot.transcriptVersion}`
                                : ""}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <form
          className="space-y-2 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            void sendFeedback()
          }}
        >
          <label
            className="block text-sm font-medium"
            htmlFor={`${view.grantId}-feedback-target`}
          >
            Feedback target
          </label>
          <select
            className="h-9 w-full rounded-2xl border bg-background px-3 text-sm"
            disabled={disabled || pending !== null}
            id={`${view.grantId}-feedback-target`}
            onChange={(event) => setFeedbackTarget(event.target.value)}
            value={feedbackTarget}
          >
            <option value="workspace">Whole response</option>
            {view.workspace.questionAnswers.map(({ questionId }) => (
              <option key={questionId} value={questionId}>
                {questionLabel(view, questionId)}
              </option>
            ))}
            {view.assets?.map(({ asset }) => (
              <option key={asset.assetId} value={`asset:${asset.assetId}`}>
                Evidence: {asset.fileName}
              </option>
            ))}
          </select>
          <label
            className="block text-sm font-medium"
            htmlFor={`${view.grantId}-feedback-body`}
          >
            Feedback
          </label>
          <Textarea
            disabled={disabled || pending !== null}
            id={`${view.grantId}-feedback-body`}
            onChange={(event) => setFeedbackBody(event.target.value)}
            placeholder="Leave guidance without changing the respondent’s evidence."
            value={feedbackBody}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={disabled || pending !== null || !feedbackBody.trim()}
              type="submit"
              variant="secondary"
            >
              {pending === "feedback" ? "Adding feedback…" : "Add feedback"}
            </Button>
            {view.workspace.locked ? (
              <Button
                disabled={disabled || pending !== null}
                onClick={() => void reopen()}
                type="button"
                variant="outline"
              >
                {pending === "reopen" ? "Reopening…" : "Reopen response"}
              </Button>
            ) : null}
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}

export function GuestResponseAdminPanel({
  views,
  disabled = false,
  onAddFeedback,
  onReopen,
}: {
  views: Array<GuestResponseAdminView>
  disabled?: boolean
  onAddFeedback: (input: {
    grantId: string
    scope: FeedbackScope
    body: string
  }) => Promise<GuestResponseAdminFeedback | GuestResponseAdminAssetFeedback>
  onReopen: (grantId: string) => Promise<unknown>
}) {
  if (!views.length) return null
  return (
    <section
      aria-labelledby="guest-response-admin-heading"
      className="space-y-3"
    >
      <div>
        <h3
          className="font-heading text-lg font-semibold"
          id="guest-response-admin-heading"
        >
          Guest responses
        </h3>
        <p className="text-sm text-muted-foreground">
          Inspect respondent evidence read-only, leave targeted feedback, or
          reopen a submitted workspace.
        </p>
      </div>
      {views.map((view) => (
        <GuestResponseAdminCard
          disabled={disabled}
          key={view.grantId}
          onAddFeedback={onAddFeedback}
          onReopen={onReopen}
          view={view}
        />
      ))}
    </section>
  )
}

export function GuestResponseAdminServerPanel({
  views,
  disabled = false,
}: {
  views: Array<GuestResponseAdminView>
  disabled?: boolean
}) {
  const router = useRouter()
  const addFeedback = useServerFn(addGuestResponseFeedback)
  const addAssetFeedback = useServerFn(addGuestResponseAssetFeedback)
  const reopenWorkspace = useServerFn(reopenGuestResponseWorkspace)
  const feedbackAttempts = useRef(new Map<string, string>())
  const reopenAttempts = useRef(new Map<string, string>())

  const refresh = () => router.invalidate()

  return (
    <GuestResponseAdminPanel
      disabled={disabled}
      views={views}
      onAddFeedback={async ({ grantId, scope, body }) => {
        const attemptKey = JSON.stringify({ grantId, scope, body })
        const correlationId =
          feedbackAttempts.current.get(attemptKey) ?? crypto.randomUUID()
        feedbackAttempts.current.set(attemptKey, correlationId)
        const result =
          scope.kind === "asset"
            ? await addAssetFeedback({
                data: {
                  grantId,
                  assetId: scope.assetId,
                  body,
                  correlationId,
                },
              })
            : await addFeedback({
                data: { grantId, scope, body, correlationId },
              })
        await refresh()
        feedbackAttempts.current.delete(attemptKey)
        return result
      }}
      onReopen={async (grantId) => {
        const correlationId =
          reopenAttempts.current.get(grantId) ?? crypto.randomUUID()
        reopenAttempts.current.set(grantId, correlationId)
        const result = await reopenWorkspace({
          data: { grantId, correlationId },
        })
        await refresh()
        reopenAttempts.current.delete(grantId)
        return result
      }}
    />
  )
}
