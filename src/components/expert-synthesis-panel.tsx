import { useEffect, useRef, useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"

import type {
  ExpertInterviewProcessingInput,
  ExpertInterviewSubmissionSummary,
} from "@/application/expert-interviews"
import type { Deliverable } from "@/application/content-requests"
import {
  completeExpertInterviewProcessingInput,
  prepareExpertInterviewProcessingInput,
  setExpertInterviewSubmissionInclusion,
} from "@/application/content-request-server-functions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonAnchor } from "@/components/ui/button-link"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"

function isInvalidProcessingSnapshot(error: unknown) {
  if (!(error instanceof Error)) return false
  return (
    error.message.includes("EXPERT_SYNTHESIS_SNAPSHOT_STALE") ||
    error.message.includes("INVALID_EXPERT_SYNTHESIS_SNAPSHOT")
  )
}

export function ExpertSynthesisPanel({
  submissions,
  disabled = false,
  onSetInclusion,
  deliverables = [],
  onPrepare,
  onComplete,
}: {
  submissions: Array<ExpertInterviewSubmissionSummary>
  disabled?: boolean
  onSetInclusion: (submissionId: string, included: boolean) => Promise<unknown>
  deliverables?: Array<Deliverable>
  onPrepare?: (
    submissionIds: Array<string>,
    synthesisInstructions?: string
  ) => Promise<ExpertInterviewProcessingInput>
  onComplete?: (input: {
    processing: ExpertInterviewProcessingInput
    body: string
    deliverableId?: string
    name?: string
  }) => Promise<unknown>
}) {
  const [pendingSubmissionId, setPendingSubmissionId] = useState<string | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] =
    useState<ExpertInterviewProcessingInput | null>(null)
  const [preparedSelectionSignature, setPreparedSelectionSignature] = useState<
    string | null
  >(null)
  const [synthesisInstructions, setSynthesisInstructions] = useState("")
  const [body, setBody] = useState("")
  const [deliverableId, setDeliverableId] = useState("")
  const [name, setName] = useState("Expert interview article draft")
  const [preparing, setPreparing] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [completionReplayPending, setCompletionReplayPending] = useState(false)
  const [completionMessage, setCompletionMessage] = useState<string | null>(
    null
  )

  useEffect(() => {
    if (!processing || completionReplayPending) return
    const expiresIn = processing.processingSnapshot.expiresAt - Date.now()
    const timeout = window.setTimeout(
      () => {
        setProcessing(null)
        setPreparedSelectionSignature(null)
        setError("The attributed processing bundle expired. Prepare it again.")
      },
      Math.max(0, Math.min(expiresIn, 2_147_483_647))
    )
    return () => window.clearTimeout(timeout)
  }, [completionReplayPending, processing])

  if (!submissions.length) return null

  const selectionSignature = JSON.stringify(
    submissions.map(({ submissionId, inclusion }) => ({
      submissionId,
      state: inclusion.state,
      decidedAt: inclusion.decidedAt,
    }))
  )
  const activeProcessing =
    preparedSelectionSignature === selectionSignature ? processing : null

  const decide = async (submissionId: string, included: boolean) => {
    if (pendingSubmissionId || completionReplayPending) return
    setPendingSubmissionId(submissionId)
    setError(null)
    try {
      await onSetInclusion(submissionId, included)
      setProcessing(null)
      setPreparedSelectionSignature(null)
      setCompletionReplayPending(false)
      setBody("")
      setCompletionMessage(null)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save the synthesis selection."
      )
    } finally {
      setPendingSubmissionId(null)
    }
  }
  const includedSubmissionIds = submissions
    .filter(({ inclusion }) => inclusion.state === "included")
    .map(({ submissionId }) => submissionId)
  const hasUndecidedSubmissions = submissions.some(
    ({ inclusion }) => inclusion.state === "undecided"
  )

  const prepare = async () => {
    if (!onPrepare || preparing || !includedSubmissionIds.length) return
    setPreparing(true)
    setError(null)
    setCompletionMessage(null)
    try {
      const prepared = await onPrepare(
        includedSubmissionIds,
        synthesisInstructions.trim() || undefined
      )
      setProcessing(prepared)
      setPreparedSelectionSignature(selectionSignature)
      setCompletionReplayPending(false)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not prepare the attributed processing bundle."
      )
    } finally {
      setPreparing(false)
    }
  }

  const complete = async () => {
    if (!activeProcessing || !onComplete || completing || !body.trim()) return
    if (
      !completionReplayPending &&
      activeProcessing.processingSnapshot.expiresAt <= Date.now()
    ) {
      setProcessing(null)
      setPreparedSelectionSignature(null)
      setError("The attributed processing bundle expired. Prepare it again.")
      return
    }
    setCompleting(true)
    setCompletionReplayPending(true)
    setError(null)
    setCompletionMessage(null)
    try {
      await onComplete({
        processing: activeProcessing,
        body,
        deliverableId: deliverableId || undefined,
        name: deliverableId ? undefined : name,
      })
      setProcessing(null)
      setPreparedSelectionSignature(null)
      setCompletionReplayPending(false)
      setBody("")
      setCompletionMessage("Synthesis committed with immutable provenance.")
    } catch (caught) {
      if (isInvalidProcessingSnapshot(caught)) {
        setProcessing(null)
        setPreparedSelectionSignature(null)
        setCompletionReplayPending(false)
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not commit the synthesis."
      )
    } finally {
      setCompleting(false)
    }
  }

  return (
    <section aria-labelledby="expert-synthesis-heading" className="space-y-3">
      <div>
        <h3
          className="font-heading text-lg font-semibold"
          id="expert-synthesis-heading"
        >
          Expert synthesis selection
        </h3>
        <p className="text-sm text-muted-foreground">
          Include or exclude every immutable Submission explicitly. Undecided
          evidence is never silently sent to synthesis.
        </p>
      </div>
      {submissions.map((submission) => {
        const state = submission.inclusion.state
        const isPending = pendingSubmissionId === submission.submissionId
        const accessibleSubmissionLabel = `${submission.respondent.displayName}, revision ${submission.workspaceRevision}, submission ${submission.submissionId}`
        return (
          <Card
            aria-label={accessibleSubmissionLabel}
            key={submission.submissionId}
            role="article"
            size="sm"
          >
            <CardHeader>
              <CardTitle as="h4">{submission.respondent.displayName}</CardTitle>
              <CardDescription>
                Submitted {new Date(submission.submittedAt).toLocaleString()} ·
                revision {submission.workspaceRevision}
              </CardDescription>
              <CardAction>
                <Badge variant={state === "included" ? "secondary" : "outline"}>
                  {state === "included"
                    ? "Included"
                    : state === "excluded"
                      ? "Excluded"
                      : "Not decided"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {submission.sourceSummary}
              </p>
              {submission.inclusion.decidedBy ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Decided by {submission.inclusion.decidedBy.displayName}
                </p>
              ) : null}
              <div
                aria-label={`Synthesis decision for ${accessibleSubmissionLabel}`}
                className="mt-4 flex flex-wrap gap-2"
                role="group"
              >
                <Button
                  aria-label={`Include ${accessibleSubmissionLabel} in synthesis`}
                  aria-pressed={state === "included"}
                  className="min-h-11"
                  disabled={
                    disabled ||
                    pendingSubmissionId !== null ||
                    completionReplayPending
                  }
                  onClick={() => void decide(submission.submissionId, true)}
                  type="button"
                  variant={state === "included" ? "default" : "outline"}
                >
                  {isPending ? "Saving…" : "Include"}
                </Button>
                <Button
                  aria-label={`Exclude ${accessibleSubmissionLabel} from synthesis`}
                  aria-pressed={state === "excluded"}
                  className="min-h-11"
                  disabled={
                    disabled ||
                    pendingSubmissionId !== null ||
                    completionReplayPending
                  }
                  onClick={() => void decide(submission.submissionId, false)}
                  type="button"
                  variant={state === "excluded" ? "secondary" : "outline"}
                >
                  {isPending ? "Saving…" : "Exclude"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
      {onPrepare ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle as="h4">Attributed processing bundle</CardTitle>
            <CardDescription>
              Prepare the same immutable package used by CLI, HTTP, and MCP,
              then inspect or export it before committing a draft.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="grid gap-1 text-sm">
              Priority synthesis instructions
              <Textarea
                className="min-h-24"
                disabled={disabled || preparing || completionReplayPending}
                onChange={(event) => {
                  setSynthesisInstructions(event.currentTarget.value)
                  setProcessing(null)
                  setPreparedSelectionSignature(null)
                  setBody("")
                  setCompletionMessage(null)
                }}
                value={synthesisInstructions}
              />
            </label>
            <Button
              disabled={
                disabled ||
                preparing ||
                completionReplayPending ||
                hasUndecidedSubmissions ||
                includedSubmissionIds.length === 0
              }
              onClick={() => void prepare()}
              type="button"
            >
              {preparing ? "Preparing…" : "Prepare attributed bundle"}
            </Button>
            {hasUndecidedSubmissions ? (
              <p className="text-xs text-muted-foreground">
                Include or exclude every Submission before preparing the bundle.
              </p>
            ) : null}
            {activeProcessing ? (
              <div className="space-y-4">
                <p className="text-xs break-all text-muted-foreground">
                  Payload SHA-256: {activeProcessing.payloadDigest}
                </p>
                <ButtonAnchor
                  className="min-h-11"
                  download={`${activeProcessing.request.humanId}-expert-synthesis-bundle.json`}
                  href={`data:application/json;charset=utf-8,${encodeURIComponent(
                    activeProcessing.processingSnapshot.canonicalBundle
                  )}`}
                  variant="outline"
                >
                  Export attributed bundle
                </ButtonAnchor>
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    Inspect shared prompt and bundle
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                    {activeProcessing.prompt}
                    {"\n\nEXACT CANONICAL BUNDLE (SHA-256 INPUT)\n"}
                    {activeProcessing.processingSnapshot.canonicalBundle}
                  </pre>
                </details>
                <label className="grid gap-1 text-sm">
                  Publication-ready Markdown
                  <Textarea
                    className="min-h-64 font-mono text-sm"
                    disabled={disabled || completing || completionReplayPending}
                    onChange={(event) => setBody(event.currentTarget.value)}
                    value={body}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Deliverable target
                  <NativeSelect
                    className="w-full [&_select]:min-h-11"
                    disabled={disabled || completing || completionReplayPending}
                    onChange={(event) =>
                      setDeliverableId(event.currentTarget.value)
                    }
                    value={deliverableId}
                  >
                    <NativeSelectOption value="">
                      Create a new article Deliverable
                    </NativeSelectOption>
                    {deliverables
                      .filter(
                        (deliverable) => deliverable.kind === "blog_article"
                      )
                      .map((deliverable) => (
                        <NativeSelectOption
                          key={deliverable.deliverableId}
                          value={deliverable.deliverableId}
                        >
                          Add a version to {deliverable.name} (
                          {deliverable.deliverableId})
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </label>
                {!deliverableId ? (
                  <label className="grid gap-1 text-sm">
                    New Deliverable name
                    <Input
                      className="min-h-11"
                      disabled={
                        disabled || completing || completionReplayPending
                      }
                      onChange={(event) => setName(event.currentTarget.value)}
                      value={name}
                    />
                  </label>
                ) : null}
                <Button
                  disabled={disabled || completing || !body.trim()}
                  onClick={() => void complete()}
                  type="button"
                >
                  {completing
                    ? "Committing synthesis…"
                    : completionReplayPending
                      ? "Retry exact completion"
                      : "Complete synthesis"}
                </Button>
                {completionReplayPending && !completing ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    The completion outcome is unknown. Retry sends the exact
                    same snapshot and draft without creating a new operation.
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {completionMessage ? (
        <p className="text-sm text-foreground" role="status">
          {completionMessage}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

export function ExpertSynthesisServerPanel({
  humanId,
  submissions,
  deliverables,
  disabled = false,
}: {
  humanId: string
  submissions: Array<ExpertInterviewSubmissionSummary>
  deliverables: Array<Deliverable>
  disabled?: boolean
}) {
  const router = useRouter()
  const setInclusion = useServerFn(setExpertInterviewSubmissionInclusion)
  const prepareProcessing = useServerFn(prepareExpertInterviewProcessingInput)
  const completeProcessing = useServerFn(completeExpertInterviewProcessingInput)
  const preparationAttempts = useRef(new Map<string, string>())
  const completionAttempts = useRef(new Map<string, string>())
  const inclusionAttempts = useRef(new Map<string, string>())
  const founderJobLeaseToken = useRef<string | null>(null)

  return (
    <ExpertSynthesisPanel
      disabled={disabled}
      deliverables={deliverables}
      submissions={submissions}
      onPrepare={async (submissionIds, synthesisInstructions) => {
        const attemptKey = JSON.stringify({
          humanId,
          submissionIds,
          synthesisInstructions: synthesisInstructions ?? null,
        })
        const correlationId =
          preparationAttempts.current.get(attemptKey) ?? crypto.randomUUID()
        preparationAttempts.current.set(attemptKey, correlationId)
        const result = await prepareProcessing({
          data: {
            humanId,
            submissionIds,
            synthesisInstructions,
            correlationId,
          },
        }).catch((error: unknown) => {
          if (
            error instanceof Error &&
            error.message.includes("IDEMPOTENCY_KEY_REUSED")
          )
            preparationAttempts.current.delete(attemptKey)
          throw error
        })
        preparationAttempts.current.delete(attemptKey)
        return result
      }}
      onComplete={async ({ processing, body, deliverableId, name }) => {
        founderJobLeaseToken.current ??= crypto.randomUUID()
        const attemptKey = JSON.stringify({
          humanId,
          payloadDigest: processing.payloadDigest,
          body,
          deliverableId,
          name,
        })
        const correlationId =
          completionAttempts.current.get(attemptKey) ?? crypto.randomUUID()
        completionAttempts.current.set(attemptKey, correlationId)
        const result = await completeProcessing({
          data: {
            humanId,
            submissionIds: processing.processingSnapshot.submissionIds,
            processingToken: processing.processingSnapshot.processingToken,
            payloadDigest: processing.payloadDigest,
            body,
            deliverableId,
            name,
            jobLeaseToken: founderJobLeaseToken.current,
            correlationId,
          },
        }).catch((error: unknown) => {
          if (isInvalidProcessingSnapshot(error)) {
            preparationAttempts.current.clear()
            completionAttempts.current.delete(attemptKey)
          }
          throw error
        })
        await router.invalidate()
        completionAttempts.current.delete(attemptKey)
        founderJobLeaseToken.current = null
        return result
      }}
      onSetInclusion={async (submissionId, included) => {
        const attemptKey = JSON.stringify({ humanId, submissionId, included })
        const correlationId =
          inclusionAttempts.current.get(attemptKey) ?? crypto.randomUUID()
        inclusionAttempts.current.set(attemptKey, correlationId)
        const result = await setInclusion({
          data: {
            humanId,
            submissionId,
            included,
            correlationId,
          },
        })
        await router.invalidate()
        inclusionAttempts.current.delete(attemptKey)
        preparationAttempts.current.clear()
        return result
      }}
    />
  )
}
