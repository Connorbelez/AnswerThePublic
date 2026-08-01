"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { Check, Cloud, RefreshCw } from "lucide-react"

import type {
  GuestAnswerMode,
  GuestEditorLease,
  GuestResponseWorkspace,
} from "@/application/content-requests"
import {
  acquireGuestEditorLease,
  heartbeatGuestEditorLease,
  saveGuestResponseWorkspace,
  submitGuestResponseWorkspace,
  takeoverGuestEditorLease,
} from "@/application/content-request-server-functions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { GuestEvidenceServerPanel } from "@/components/guest-evidence-panel"
import { GuestResponseTextWorkspace } from "@/components/guest-response-text-workspace"
import { GuestSubmissionControl } from "@/components/guest-submission-control"

const AUTOSAVE_DELAY_MS = 650
const AUTOSAVE_RETRY_DELAYS_MS = [500, 1_000, 2_000] as const

type ResponseQuestion = {
  id: string
  question: string
  motivation: string
}

type GuestResponseComposerProps = {
  token: string
  grantId?: string
  initialWorkspace: GuestResponseWorkspace
  questions: Array<ResponseQuestion>
}

type PendingWorkspaceSave = {
  operationId: string
  submittedWorkspace: GuestResponseWorkspace
  submittedFingerprint: string
  leaseGeneration: number
}

type PendingSubmission = {
  operationId: string
  leaseGeneration: number
  expectedRevision: number
  selectedAnswerMode?: GuestAnswerMode
}

type LeaseRecoveryAction = "acquire" | "heartbeat" | "takeover"

function fingerprint(workspace: GuestResponseWorkspace) {
  return JSON.stringify({
    answerMode: workspace.answerMode,
    batchText: workspace.batchText,
    questionAnswers: workspace.questionAnswers,
  })
}

function operationId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `guest-save-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

function editorLeaseId() {
  const storageKey = "fairlend-guest-editor-lease"
  const existing = globalThis.sessionStorage?.getItem(storageKey)
  if (existing) return existing
  const created = operationId()
  globalThis.sessionStorage?.setItem(storageKey, created)
  return created
}

function draftJournalKey(grantId: string) {
  return `fairlend-guest-response-draft:${grantId}`
}

type DraftRecovery = {
  workspace: GuestResponseWorkspace
  revisionConflict: boolean
  journalBaseRevision: number
}

function restoreDraftJournal(
  initialWorkspace: GuestResponseWorkspace,
  grantId?: string
): DraftRecovery {
  const unchanged = {
    workspace: initialWorkspace,
    revisionConflict: false,
    journalBaseRevision: initialWorkspace.revision,
  }
  if (!grantId || initialWorkspace.locked) return unchanged
  try {
    const serialized = globalThis.sessionStorage?.getItem(
      draftJournalKey(grantId)
    )
    if (!serialized) return unchanged
    const journal = JSON.parse(serialized) as {
      baseRevision: number
      answerMode: GuestAnswerMode
      batchText: string
      questionAnswers: Array<{ questionId: string; text: string }>
    }
    if (journal.baseRevision > initialWorkspace.revision) return unchanged
    const journalAnswers = new Map(
      journal.questionAnswers.map(({ questionId, text }) => [questionId, text])
    )
    const questionAnswers = initialWorkspace.questionAnswers.map(
      ({ questionId, text }) => ({
        questionId,
        text: journalAnswers.get(questionId) ?? text,
      })
    )
    const completed =
      journal.answerMode === "batch"
        ? journal.batchText.trim()
          ? questionAnswers.length
          : 0
        : questionAnswers.filter(({ text }) => text.trim()).length
    const workspace = {
      ...initialWorkspace,
      answerMode: journal.answerMode,
      batchText: journal.batchText,
      questionAnswers,
      progress: {
        completed,
        total: questionAnswers.length,
      },
    }
    return {
      workspace,
      revisionConflict:
        journal.baseRevision !== initialWorkspace.revision &&
        fingerprint(workspace) !== fingerprint(initialWorkspace),
      journalBaseRevision: journal.baseRevision,
    }
  } catch {
    return unchanged
  }
}

export function GuestResponseComposer({
  token,
  grantId,
  initialWorkspace,
  questions,
}: GuestResponseComposerProps) {
  const acquireLease = useServerFn(acquireGuestEditorLease)
  const heartbeatLease = useServerFn(heartbeatGuestEditorLease)
  const saveWorkspace = useServerFn(saveGuestResponseWorkspace)
  const submitWorkspace = useServerFn(submitGuestResponseWorkspace)
  const takeoverLease = useServerFn(takeoverGuestEditorLease)
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [draftJournalReady, setDraftJournalReady] = useState(!grantId)
  const [editorLease, setEditorLease] = useState<GuestEditorLease>(
    initialWorkspace.editorLease
  )
  const [leaseState, setLeaseState] = useState<
    "acquiring" | "editing" | "conflict" | "error" | "locked"
  >(initialWorkspace.locked ? "locked" : "acquiring")
  const [leaseRecoveryAction, setLeaseRecoveryAction] =
    useState<LeaseRecoveryAction | null>(null)
  const [saveState, setSaveState] = useState<
    "saved" | "saving" | "conflict" | "error"
  >("saved")
  const [submissionState, setSubmissionState] = useState<
    "idle" | "submitting" | "submitted" | "error"
  >(initialWorkspace.locked ? "submitted" : "idle")
  const [evidenceBlocksSubmission, setEvidenceBlocksSubmission] =
    useState(false)
  const [evidenceMaterialModes, setEvidenceMaterialModes] = useState({
    batchHasMaterial: false,
    oneByOneHasMaterial: false,
  })
  const persistedFingerprint = useRef(fingerprint(initialWorkspace))
  const [persistedDraftFingerprint, setPersistedDraftFingerprint] = useState(
    fingerprint(initialWorkspace)
  )
  const latestWorkspace = useRef(initialWorkspace)
  const journalBaseRevision = useRef(initialWorkspace.revision)
  const unresolvedRevisionConflict = useRef(false)
  const saveWorkspaceRef = useRef(saveWorkspace)
  const tokenRef = useRef(token)
  const autosaveTimer = useRef<number | null>(null)
  const retryTimer = useRef<number | null>(null)
  const retryCount = useRef(0)
  const saveInFlight = useRef(false)
  const saveRequested = useRef(false)
  const pendingSave = useRef<PendingWorkspaceSave | null>(null)
  const pendingAcquireOperationId = useRef<string | null>(null)
  const pendingHeartbeat = useRef<{
    operationId: string
    leaseGeneration: number
  } | null>(null)
  const pendingTakeover = useRef<{
    operationId: string
    expectedGeneration: number
  } | null>(null)
  const pendingSubmission = useRef<PendingSubmission | null>(null)
  const heartbeatInFlight = useRef(false)
  const takeoverInFlight = useRef(false)
  const mounted = useRef(true)
  const [leaseId] = useState(editorLeaseId)
  const drainSave = useRef<() => void>(() => undefined)
  const draftFingerprint = useMemo(() => fingerprint(workspace), [workspace])

  useEffect(() => {
    const recovery = restoreDraftJournal(initialWorkspace, grantId)
    journalBaseRevision.current = recovery.journalBaseRevision
    unresolvedRevisionConflict.current = recovery.revisionConflict
    latestWorkspace.current = recovery.workspace
    // Draft recovery is intentionally a post-hydration state replacement: the
    // server render must not depend on browser session storage.
    /* eslint-disable react-hooks/set-state-in-effect */
    setWorkspace(recovery.workspace)
    setSaveState(recovery.revisionConflict ? "conflict" : "saved")
    setDraftJournalReady(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [grantId, initialWorkspace])

  useEffect(() => {
    latestWorkspace.current = workspace
    saveWorkspaceRef.current = saveWorkspace
    tokenRef.current = token
  }, [saveWorkspace, token, workspace])

  useEffect(() => {
    if (!grantId || !draftJournalReady) return
    if (fingerprint(workspace) === persistedFingerprint.current) {
      globalThis.sessionStorage?.removeItem(draftJournalKey(grantId))
      return
    }
    globalThis.sessionStorage?.setItem(
      draftJournalKey(grantId),
      JSON.stringify({
        baseRevision: unresolvedRevisionConflict.current
          ? journalBaseRevision.current
          : workspace.revision,
        answerMode: workspace.answerMode,
        batchText: workspace.batchText,
        questionAnswers: workspace.questionAnswers,
      })
    )
  }, [draftJournalReady, grantId, workspace])

  useEffect(() => {
    drainSave.current = () => {
      if (
        !mounted.current ||
        leaseState !== "editing" ||
        saveInFlight.current ||
        !saveRequested.current
      ) {
        return
      }

      const currentWorkspace = latestWorkspace.current
      const currentFingerprint = fingerprint(currentWorkspace)
      if (
        !pendingSave.current &&
        currentFingerprint === persistedFingerprint.current
      ) {
        saveRequested.current = false
        setSaveState("saved")
        return
      }

      const saveAttempt =
        pendingSave.current ??
        ({
          operationId: operationId(),
          submittedWorkspace: currentWorkspace,
          submittedFingerprint: currentFingerprint,
          leaseGeneration: editorLease.generation,
        } satisfies PendingWorkspaceSave)
      pendingSave.current = saveAttempt
      saveRequested.current = false
      saveInFlight.current = true
      setSaveState("saving")

      void Promise.resolve(
        saveWorkspaceRef.current({
          data: {
            token: tokenRef.current,
            leaseId,
            leaseGeneration: saveAttempt.leaseGeneration,
            operationId: saveAttempt.operationId,
            expectedRevision: saveAttempt.submittedWorkspace.revision,
            answerMode: saveAttempt.submittedWorkspace.answerMode,
            batchText: saveAttempt.submittedWorkspace.batchText,
            questionAnswers: saveAttempt.submittedWorkspace.questionAnswers,
          },
        })
      )
        .then((result) => {
          if (!mounted.current) return
          if (!result)
            throw new Error("Guest response autosave returned no result")
          if (result.status === "lease_conflict") {
            pendingSave.current = null
            setEditorLease(result.editorLease)
            setLeaseState("conflict")
            setSaveState("conflict")
            return
          }

          const savedFingerprint = fingerprint(result.workspace)
          persistedFingerprint.current = savedFingerprint
          setPersistedDraftFingerprint(savedFingerprint)
          retryCount.current = 0
          pendingSave.current = null

          const currentWorkspace = latestWorkspace.current
          const hasNewerLocalDraft =
            fingerprint(currentWorkspace) !== saveAttempt.submittedFingerprint
          const localDraft = hasNewerLocalDraft
            ? currentWorkspace
            : saveAttempt.submittedWorkspace
          const reconciledWorkspace =
            hasNewerLocalDraft || result.status === "conflict"
              ? {
                  ...result.workspace,
                  answerMode: localDraft.answerMode,
                  batchText: localDraft.batchText,
                  questionAnswers: localDraft.questionAnswers,
                }
              : result.workspace
          if (result.status === "conflict") {
            unresolvedRevisionConflict.current = true
            journalBaseRevision.current =
              saveAttempt.submittedWorkspace.revision
          }

          latestWorkspace.current = reconciledWorkspace
          setWorkspace(reconciledWorkspace)
          setSaveState(result.status === "conflict" ? "conflict" : "saved")
        })
        .catch(() => {
          if (!mounted.current) return
          setSaveState("error")

          const retryDelay =
            AUTOSAVE_RETRY_DELAYS_MS[retryCount.current] ?? null
          retryCount.current += 1
          if (retryDelay === null) return

          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null
            saveRequested.current = true
            drainSave.current()
          }, retryDelay)
        })
        .finally(() => {
          saveInFlight.current = false
          if (!mounted.current) return
          if (saveRequested.current) drainSave.current()
        })
    }
  }, [editorLease.generation, leaseId, leaseState])

  useEffect(() => {
    if (leaseState === "editing" && saveRequested.current) {
      drainSave.current()
    }
  }, [leaseState])

  useEffect(() => {
    mounted.current = true
    const flushPendingDraft = () => {
      if (unresolvedRevisionConflict.current) return
      if (fingerprint(latestWorkspace.current) === persistedFingerprint.current)
        return
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current)
        autosaveTimer.current = null
      }
      saveRequested.current = true
      drainSave.current()
    }
    window.addEventListener("pagehide", flushPendingDraft)
    return () => {
      window.removeEventListener("pagehide", flushPendingDraft)
      flushPendingDraft()
      mounted.current = false
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current)
      }
      if (retryTimer.current !== null) {
        window.clearTimeout(retryTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    if (workspace.locked) return
    let active = true
    const acquireOperationId =
      pendingAcquireOperationId.current ?? operationId()
    pendingAcquireOperationId.current = acquireOperationId
    void acquireLease({
      data: {
        token,
        leaseId,
        operationId: acquireOperationId,
      },
    })
      .then((result) => {
        if (!active) return
        pendingAcquireOperationId.current = null
        if (!result) {
          setLeaseState("error")
          setLeaseRecoveryAction("acquire")
          return
        }
        setEditorLease(result.editorLease)
        setLeaseRecoveryAction(null)
        setLeaseState(
          result.status === "editing" && result.editorLease.active
            ? "editing"
            : "conflict"
        )
      })
      .catch(() => {
        if (active) {
          setLeaseState("error")
          setLeaseRecoveryAction("acquire")
        }
      })
    return () => {
      active = false
    }
  }, [acquireLease, leaseId, token, workspace.locked])

  useEffect(() => {
    if (leaseState !== "editing") return
    const timer = window.setInterval(() => {
      if (heartbeatInFlight.current) return
      const heartbeat = pendingHeartbeat.current ?? {
        leaseGeneration: editorLease.generation,
        operationId: operationId(),
      }
      pendingHeartbeat.current = heartbeat
      heartbeatInFlight.current = true
      void heartbeatLease({
        data: {
          token,
          leaseId,
          leaseGeneration: heartbeat.leaseGeneration,
          operationId: heartbeat.operationId,
        },
      })
        .then((result) => {
          pendingHeartbeat.current = null
          if (!result) {
            setLeaseState("error")
            setLeaseRecoveryAction("heartbeat")
            return
          }
          setEditorLease(result.editorLease)
          setLeaseRecoveryAction(null)
          setLeaseState(
            result.status === "editing" && result.editorLease.active
              ? "editing"
              : "conflict"
          )
        })
        .catch(() => {
          setLeaseState("error")
          setLeaseRecoveryAction("heartbeat")
        })
        .finally(() => {
          heartbeatInFlight.current = false
        })
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [editorLease.generation, heartbeatLease, leaseId, leaseState, token])

  useEffect(() => {
    if (leaseState !== "editing") return
    if (saveState === "conflict") return
    if (draftFingerprint === persistedFingerprint.current) return

    retryCount.current = 0
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current)
    }
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null
      saveRequested.current = true
      drainSave.current()
    }, AUTOSAVE_DELAY_MS)

    return () => {
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current)
        autosaveTimer.current = null
      }
    }
  }, [draftFingerprint, leaseState, saveState])

  const retrySave = () => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
    retryCount.current = 0
    unresolvedRevisionConflict.current = false
    journalBaseRevision.current = latestWorkspace.current.revision
    saveRequested.current = true
    drainSave.current()
  }

  const takeOverEditing = async (retryPending = false) => {
    if (takeoverInFlight.current) return
    if (!retryPending) pendingTakeover.current = null
    const takeover = pendingTakeover.current ?? {
      expectedGeneration: editorLease.generation,
      operationId: operationId(),
    }
    pendingTakeover.current = takeover
    takeoverInFlight.current = true
    setLeaseState("acquiring")
    try {
      const result = await takeoverLease({
        data: {
          token,
          leaseId,
          expectedGeneration: takeover.expectedGeneration,
          operationId: takeover.operationId,
        },
      })
      pendingTakeover.current = null
      if (!result) {
        setLeaseState("error")
        setLeaseRecoveryAction("takeover")
        return
      }
      setEditorLease(result.editorLease)
      setLeaseRecoveryAction(null)
      setLeaseState(
        result.status === "editing" && result.editorLease.active
          ? "editing"
          : "conflict"
      )
    } catch {
      setLeaseState("error")
      setLeaseRecoveryAction("takeover")
    } finally {
      takeoverInFlight.current = false
    }
  }

  const retryLeaseAction = async () => {
    if (leaseRecoveryAction === "takeover") {
      await takeOverEditing(true)
      return
    }
    if (leaseRecoveryAction === "heartbeat") {
      if (heartbeatInFlight.current) return
      const heartbeat = pendingHeartbeat.current ?? {
        leaseGeneration: editorLease.generation,
        operationId: operationId(),
      }
      pendingHeartbeat.current = heartbeat
      heartbeatInFlight.current = true
      setLeaseState("acquiring")
      try {
        const result = await heartbeatLease({
          data: {
            token,
            leaseId,
            leaseGeneration: heartbeat.leaseGeneration,
            operationId: heartbeat.operationId,
          },
        })
        pendingHeartbeat.current = null
        if (!result) {
          setLeaseState("error")
          return
        }
        setEditorLease(result.editorLease)
        setLeaseRecoveryAction(null)
        setLeaseState(
          result.status === "editing" && result.editorLease.active
            ? "editing"
            : "conflict"
        )
      } catch {
        setLeaseState("error")
      } finally {
        heartbeatInFlight.current = false
      }
      return
    }

    setLeaseState("acquiring")
    const acquireOperationId =
      pendingAcquireOperationId.current ?? operationId()
    pendingAcquireOperationId.current = acquireOperationId
    try {
      const result = await acquireLease({
        data: {
          token,
          leaseId,
          operationId: acquireOperationId,
        },
      })
      pendingAcquireOperationId.current = null
      if (!result) {
        setLeaseState("error")
        return
      }
      setEditorLease(result.editorLease)
      setLeaseRecoveryAction(null)
      setLeaseState(
        result.status === "editing" && result.editorLease.active
          ? "editing"
          : "conflict"
      )
    } catch {
      setLeaseState("error")
    }
  }

  const submitResponse = async (selectedAnswerMode?: GuestAnswerMode) => {
    setSubmissionState("submitting")
    const attempt = pendingSubmission.current ?? {
      operationId: operationId(),
      leaseGeneration: editorLease.generation,
      expectedRevision: workspace.revision,
      selectedAnswerMode,
    }
    pendingSubmission.current = attempt
    try {
      const result = await submitWorkspace({
        data: {
          token,
          leaseId,
          leaseGeneration: attempt.leaseGeneration,
          operationId: attempt.operationId,
          expectedRevision: attempt.expectedRevision,
          confirmed: true,
          selectedAnswerMode: attempt.selectedAnswerMode,
        },
      })
      if (!result) throw new Error("Submission returned no result")
      pendingSubmission.current = null
      const submittedFingerprint = fingerprint(workspace)
      persistedFingerprint.current = submittedFingerprint
      setPersistedDraftFingerprint(submittedFingerprint)
      setWorkspace((current) => ({
        ...current,
        locked: true,
      }))
      setLeaseState("locked")
      setSubmissionState("submitted")
    } catch {
      setSubmissionState("error")
    }
  }

  const updateAnswerMode = (answerMode: GuestAnswerMode) =>
    setWorkspace((current) => ({ ...current, answerMode }))

  const updateQuestionAnswer = (questionId: string, text: string) =>
    setWorkspace((current) => ({
      ...current,
      questionAnswers: current.questionAnswers.map((answer) =>
        answer.questionId === questionId ? { ...answer, text } : answer
      ),
    }))

  const batchHasMaterial =
    Boolean(workspace.batchText.trim()) ||
    evidenceMaterialModes.batchHasMaterial
  const oneByOneHasMaterial =
    workspace.questionAnswers.some(({ text }) => Boolean(text.trim())) ||
    evidenceMaterialModes.oneByOneHasMaterial
  const responseHasContent = batchHasMaterial || oneByOneHasMaterial
  const draftIsPersisted =
    draftJournalReady &&
    draftFingerprint === persistedDraftFingerprint &&
    saveState === "saved"
  const visibleSaveState =
    saveState === "saved" && !draftIsPersisted ? "saving" : saveState
  const workspaceFeedback =
    workspace.feedback?.filter(({ scope }) => scope.kind === "workspace") ?? []
  const questionFeedback = (questionId: string) =>
    workspace.feedback?.filter(
      ({ scope }) =>
        scope.kind === "question" && scope.questionId === questionId
    ) ?? []

  return (
    <section
      aria-labelledby="guest-response-composer-title"
      className="border-t border-border/70 bg-background px-5 py-8 md:px-10"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
            Your response
          </p>
          <h2
            className="mt-2 text-2xl font-semibold tracking-[-0.035em]"
            id="guest-response-composer-title"
          >
            Add your practical evidence
          </h2>
        </div>
        <div className="space-y-1 text-right">
          <p className="text-xs font-medium text-muted-foreground">
            {leaseState === "editing"
              ? "Editing on this device"
              : leaseState === "acquiring"
                ? "Checking editor access…"
                : leaseState === "conflict"
                  ? "Read-only on this device"
                  : leaseState === "locked"
                    ? "Submitted · read-only"
                    : "Editor access unavailable"}
          </p>
          <SaveStatus state={visibleSaveState} />
        </div>
      </div>

      {workspace.locked ? (
        <Alert className="mt-6" role="status">
          <Check />
          <AlertTitle>Response submitted</AlertTitle>
          <AlertDescription>
            FairLend received this read-only snapshot. An administrator can
            reopen the workspace if more evidence is needed.
          </AlertDescription>
        </Alert>
      ) : null}
      {workspaceFeedback.map((feedback) => (
        <Alert className="mt-6" key={feedback.feedbackId}>
          <AlertTitle>Feedback from {feedback.author.displayName}</AlertTitle>
          <AlertDescription>{feedback.body}</AlertDescription>
        </Alert>
      ))}

      {leaseState === "conflict" ? (
        <Alert className="mt-6">
          <RefreshCw />
          <AlertTitle>This response is active on another device</AlertTitle>
          <AlertDescription>
            <span>
              This page is read-only so the active editor cannot be overwritten.
            </span>
            <Button
              className="mt-3"
              onClick={() => void takeOverEditing()}
              size="sm"
              type="button"
            >
              Take over editing
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {leaseState === "error" ? (
        <Alert className="mt-6" variant="destructive">
          <RefreshCw />
          <AlertTitle>Editor access needs attention</AlertTitle>
          <AlertDescription>
            <span>
              Your response is read-only until this device confirms its editor
              lease.
            </span>
            <Button
              className="mt-3"
              onClick={() => void retryLeaseAction()}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry editor access
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {saveState === "conflict" ? (
        <Alert className="mt-6">
          <RefreshCw />
          <AlertTitle>Your draft needs a conflict check</AlertTitle>
          <AlertDescription>
            <span>
              Another save reached this response first. Your local draft is
              still here on the latest revision; review it before saving so
              newer work is never overwritten silently.
            </span>
            <Button
              className="mt-3"
              onClick={retrySave}
              size="sm"
              type="button"
              variant="outline"
            >
              Save recovered draft
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {saveState === "error" ? (
        <Alert className="mt-6" variant="destructive">
          <AlertTitle>Your latest change is not saved yet</AlertTitle>
          <AlertDescription>
            <span>
              Keep this page open. We will retry temporary failures
              automatically.
            </span>
            <Button
              className="mt-3"
              onClick={retrySave}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry save
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <GuestResponseTextWorkspace
        capabilityFooter={
          <>
            <GuestEvidenceServerPanel
              disabled={leaseState !== "editing" || Boolean(workspace.locked)}
              leaseGeneration={editorLease.generation}
              leaseId={leaseId}
              onAccessDenied={() => window.location.reload()}
              onBlockingStateChange={setEvidenceBlocksSubmission}
              onMaterialModesChange={setEvidenceMaterialModes}
              ownerKey={grantId ?? "guest-access"}
              questions={questions}
              token={token}
            />

            {submissionState === "error" ? (
              <Alert className="mt-8" variant="destructive">
                <AlertTitle>Your response was not submitted</AlertTitle>
                <AlertDescription>
                  Confirm this device still has editor access, then try again.
                  Your saved draft is unchanged.
                </AlertDescription>
              </Alert>
            ) : null}

            <div
              className="mt-8 flex justify-end border-t border-border/70 pt-6"
              data-content-ready={responseHasContent}
              data-draft-ready={draftIsPersisted}
              data-evidence-ready={!evidenceBlocksSubmission}
              data-lease-ready={leaseState === "editing"}
              data-testid="guest-submission-readiness"
            >
              <GuestSubmissionControl
                answerModeSelection={{
                  batchHasMaterial,
                  oneByOneHasMaterial,
                }}
                canSubmit={
                  responseHasContent &&
                  draftIsPersisted &&
                  leaseState === "editing" &&
                  !evidenceBlocksSubmission
                }
                onSubmit={submitResponse}
                submitted={submissionState === "submitted"}
                submitting={submissionState === "submitting"}
              />
            </div>
          </>
        }
        disabled={leaseState !== "editing" || Boolean(workspace.locked)}
        onAnswerModeChange={updateAnswerMode}
        onBatchTextChange={(batchText) =>
          setWorkspace((current) => ({ ...current, batchText }))
        }
        onQuestionAnswerChange={updateQuestionAnswer}
        questions={questions}
        renderQuestionSupplement={(questionId) =>
          questionFeedback(questionId).map((feedback) => (
            <Alert className="mb-4" key={feedback.feedbackId}>
              <AlertTitle>
                Feedback from {feedback.author.displayName}
              </AlertTitle>
              <AlertDescription>{feedback.body}</AlertDescription>
            </Alert>
          ))
        }
        savedLabel={
          visibleSaveState === "saving"
            ? "Saving…"
            : visibleSaveState === "error"
              ? "Not saved"
              : visibleSaveState === "conflict"
                ? "Conflict"
                : "Saved"
        }
        workspace={workspace}
      />
    </section>
  )
}

function SaveStatus({
  state,
}: {
  state: "saved" | "saving" | "conflict" | "error"
}) {
  return (
    <p
      aria-live="polite"
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      {state === "saved" ? (
        <Check className="size-4" />
      ) : (
        <Cloud className="size-4" />
      )}
      {state === "saving"
        ? "Saving…"
        : state === "saved"
          ? "Saved"
          : state === "conflict"
            ? "Latest revision restored"
            : "Not saved"}
    </p>
  )
}
