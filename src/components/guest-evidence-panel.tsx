"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { FileText, RotateCcw, Trash2 } from "lucide-react"

import type {
  GuestResponseAsset,
  GuestResponseAssetScope,
} from "@/application/content-requests"
import {
  beginGuestEvidenceUpload,
  discardGuestEvidence,
  finalizeGuestEvidenceUpload,
  listGuestEvidence,
  markGuestEvidenceUploadFailed,
  registerGuestEvidenceUpload,
  retryGuestEvidence,
} from "@/application/content-request-server-functions"
import {
  FounderVoiceRecorder,
  type FounderVoiceController,
} from "@/components/founder-voice-recorder"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  createVoiceCaptureQueue,
  type QueuedVoiceCapture,
  type VoiceCaptureQueue,
} from "@/lib/voice-capture-queue"

const ACCEPTED_FILES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
].join(",")
const ACCEPTED_AUDIO = "audio/webm,audio/mp4,audio/mpeg,audio/wav,audio/ogg"

export type GuestEvidenceTransport = {
  list(): Promise<Array<GuestResponseAsset>>
  upload(
    file: File | Blob,
    input: {
      clientAssetId: string
      kind: "audio" | "attachment"
      scope: GuestResponseAssetScope
      fileName: string
      mimeType: string
    }
  ): Promise<GuestResponseAsset>
  retry(
    assetId: string,
    replacement?: File | Blob,
    requiresUpload?: boolean
  ): Promise<void>
  discard(assetId: string): Promise<void>
}

function evidenceState(asset: GuestResponseAsset) {
  if (asset.uploadState === "failed" || asset.transcriptionState === "failed")
    return "error" as const
  if (asset.uploadState === "uploading") return "uploading" as const
  if (
    asset.transcriptionState === "queued" ||
    asset.transcriptionState === "transcribing"
  )
    return "processing" as const
  return "done" as const
}

function guestEvidenceErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "code" in error.data &&
    typeof error.data.code === "string"
  )
    return error.data.code
  if (error instanceof Error) {
    if (error.message.includes("ACCESS_DENIED")) return "ACCESS_DENIED"
    if (error.message.includes("UPLOAD_SESSION_SETTLED"))
      return "UPLOAD_SESSION_SETTLED"
  }
  return null
}

type GuestVoiceController = FounderVoiceController & {
  queueHydrated: boolean
}

function useGuestRecorder({
  disabled,
  ownerKey,
  scope,
  transport,
  refresh,
  queueFactory = createVoiceCaptureQueue,
}: {
  disabled: boolean
  ownerKey: string
  scope: GuestResponseAssetScope
  transport: GuestEvidenceTransport
  refresh(): Promise<void>
  queueFactory?: (ownerKey: string) => VoiceCaptureQueue
}): GuestVoiceController {
  const [state, setState] = useState<FounderVoiceController["state"]>("idle")
  const [elapsedMs, setElapsedMs] = useState(0)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [queuedCount, setQueuedCount] = useState(0)
  const [queueHydrated, setQueueHydrated] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Array<Blob>>([])
  const startedAt = useRef(0)
  const scopeAtStart = useRef(scope)
  const timer = useRef<number | null>(null)
  const cancelled = useRef(false)
  const mediaRequestGeneration = useRef(0)
  const disabledRef = useRef(disabled)
  const mounted = useRef(false)
  const queue = useRef<VoiceCaptureQueue | null>(null)
  const syncing = useRef(false)
  const pendingLocal = useRef<Array<QueuedVoiceCapture>>([])
  const transportRef = useRef(transport)
  const refreshRef = useRef(refresh)
  const queueRequestId = `GUEST:${ownerKey}`.trim().toUpperCase()

  useEffect(() => {
    disabledRef.current = disabled
    transportRef.current = transport
    refreshRef.current = refresh
  }, [disabled, refresh, transport])

  useEffect(() => {
    scopeAtStart.current = scope
  }, [scope])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancelled.current = true
      mediaRequestGeneration.current += 1
      if (timer.current !== null) window.clearInterval(timer.current)
      const activeRecorder = recorder.current
      if (activeRecorder && activeRecorder.state !== "inactive")
        activeRecorder.stop()
      stream.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const syncQueue = useCallback(async () => {
    const activeQueue = queue.current
    if (
      !activeQueue ||
      syncing.current ||
      !navigator.onLine ||
      disabledRef.current
    )
      return
    syncing.current = true
    try {
      const drain = async () => {
        const captures = await activeQueue.list(queueRequestId)
        const serverAssets = await transportRef.current.list()
        if (mounted.current) setQueuedCount(captures.length)
        for (const capture of captures) {
          if (disabledRef.current) break
          const metadata = capture.metadata ?? {}
          const scopeValue: GuestResponseAssetScope =
            metadata.scopeKind === "question" && metadata.questionId
              ? { kind: "question", questionId: metadata.questionId }
              : { kind: "batch" }
          const assetId = metadata.assetId
          if (assetId) {
            await transportRef.current.retry(assetId, capture.blob, true)
          } else {
            const existingAsset = serverAssets.find(
              (asset) =>
                asset.clientAssetId ===
                (metadata.clientAssetId || capture.clientCaptureId)
            )
            if (existingAsset?.uploadState === "uploaded") {
              await activeQueue.remove(capture.clientCaptureId)
              continue
            }
            if (existingAsset) {
              await activeQueue.put({
                ...capture,
                metadata: {
                  ...metadata,
                  assetId: existingAsset.assetId,
                },
              })
              if (existingAsset.uploadState !== "failed")
                throw new Error("UPLOAD_SESSION_PENDING")
              await transportRef.current.retry(
                existingAsset.assetId,
                capture.blob,
                true
              )
              await activeQueue.remove(capture.clientCaptureId)
              continue
            }
            try {
              await transportRef.current.upload(capture.blob, {
                clientAssetId:
                  metadata.clientAssetId || capture.clientCaptureId,
                kind: "audio",
                scope: scopeValue,
                fileName:
                  metadata.fileName ||
                  `expert-response-${capture.createdAt}.webm`,
                mimeType: capture.mimeType,
              })
            } catch (caught) {
              const failedAssetId =
                caught instanceof Error &&
                "assetId" in caught &&
                typeof caught.assetId === "string"
                  ? caught.assetId
                  : null
              if (failedAssetId) {
                await activeQueue.put({
                  ...capture,
                  metadata: { ...metadata, assetId: failedAssetId },
                })
              }
              throw caught
            }
          }
          await activeQueue.remove(capture.clientCaptureId)
        }
        const remaining = await activeQueue.list(queueRequestId)
        if (mounted.current) {
          setQueuedCount(remaining.length)
          setErrorCode(null)
          setState((current) =>
            ["requesting", "recording", "paused"].includes(current)
              ? current
              : remaining.length
                ? "saving"
                : "idle"
          )
          setElapsedMs(0)
        }
        await refreshRef.current()
      }
      const lockName = `fairlend-guest-voice-sync:${encodeURIComponent(ownerKey)}`
      if (navigator.locks) await navigator.locks.request(lockName, drain)
      else await drain()
    } catch (caught) {
      if (mounted.current) {
        setState(navigator.onLine ? "failed" : "saving")
        setErrorCode(
          caught instanceof Error ? caught.message : "VOICE_UPLOAD_FAILED"
        )
        await refreshRef.current()
      }
    } finally {
      syncing.current = false
    }
  }, [ownerKey, queueRequestId])

  useEffect(() => {
    queue.current = queueFactory(ownerKey)
    queueMicrotask(() => {
      if (mounted.current) setQueueHydrated(false)
    })
    void queue.current
      .list(queueRequestId)
      .then((captures) => {
        if (mounted.current) {
          setQueuedCount(captures.length)
          setQueueHydrated(true)
        }
      })
      .catch(() => {
        if (mounted.current) setErrorCode("VOICE_QUEUE_UNAVAILABLE")
      })
      .then(() => syncQueue())
    const reconnect = () => void syncQueue()
    window.addEventListener("online", reconnect)
    return () => window.removeEventListener("online", reconnect)
  }, [ownerKey, queueFactory, queueRequestId, syncQueue])

  useEffect(() => {
    if (!disabled) {
      void syncQueue()
      return
    }
    cancelled.current = true
    mediaRequestGeneration.current += 1
    chunks.current = []
    const activeRecorder = recorder.current
    if (activeRecorder && activeRecorder.state !== "inactive")
      activeRecorder.stop()
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
    queueMicrotask(() => {
      if (!mounted.current) return
      setState("idle")
      setElapsedMs(0)
    })
  }, [disabled, syncQueue])

  useEffect(() => {
    if (disabled || queuedCount === 0) return
    const interval = window.setInterval(() => void syncQueue(), 3_000)
    return () => window.clearInterval(interval)
  }, [disabled, queuedCount, syncQueue])

  const start = useCallback(async () => {
    if (disabledRef.current || !navigator.mediaDevices?.getUserMedia) return
    const requestGeneration = mediaRequestGeneration.current + 1
    mediaRequestGeneration.current = requestGeneration
    cancelled.current = false
    setState("requesting")
    setErrorCode(null)
    let acquiredStream: MediaStream | null = null
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })
      acquiredStream = nextStream
      if (
        requestGeneration !== mediaRequestGeneration.current ||
        cancelled.current ||
        disabledRef.current ||
        !mounted.current
      ) {
        nextStream.getTracks().forEach((track) => track.stop())
        if (mounted.current) setState("idle")
        return
      }
      const nextRecorder = new MediaRecorder(nextStream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : undefined,
      })
      if (
        requestGeneration !== mediaRequestGeneration.current ||
        disabledRef.current ||
        !mounted.current
      ) {
        nextStream.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current = nextStream
      recorder.current = nextRecorder
      chunks.current = []
      scopeAtStart.current = scope
      nextRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunks.current.push(event.data)
      })
      nextRecorder.addEventListener(
        "stop",
        () => {
          const mimeType = nextRecorder.mimeType || "audio/webm"
          const recording = new Blob(chunks.current, { type: mimeType })
          recorder.current = null
          nextStream.getTracks().forEach((track) => track.stop())
          stream.current = null
          if (timer.current !== null) window.clearInterval(timer.current)
          timer.current = null
          if (cancelled.current) {
            chunks.current = []
            if (mounted.current) {
              setState("idle")
              setElapsedMs(0)
            }
            return
          }
          if (!recording.size) {
            setErrorCode("EMPTY_RECORDING")
            setState("failed")
            return
          }
          setState("saving")
          const clientAssetId = crypto.randomUUID()
          const createdAt = Date.now()
          const activeScope = scopeAtStart.current
          const queuedCapture: QueuedVoiceCapture = {
            requestHumanId: queueRequestId,
            clientCaptureId: clientAssetId,
            blob: recording,
            mimeType,
            durationMs: Math.max(1, Date.now() - startedAt.current),
            createdAt,
            metadata: {
              clientAssetId,
              fileName: `expert-response-${createdAt}.webm`,
              scopeKind: activeScope.kind,
              ...(activeScope.kind === "question"
                ? { questionId: activeScope.questionId }
                : {}),
            },
          }
          void (async () => {
            const activeQueue = queue.current
            if (!activeQueue) {
              pendingLocal.current.push(queuedCapture)
              if (mounted.current) {
                setState("failed")
                setErrorCode("LOCAL_AUDIO_SAVE_FAILED")
              }
              return
            }
            try {
              await activeQueue.put(queuedCapture)
              if (mounted.current) setQueuedCount((count) => count + 1)
              await syncQueue()
            } catch {
              pendingLocal.current.push(queuedCapture)
              if (mounted.current) {
                setState("failed")
                setErrorCode("LOCAL_AUDIO_SAVE_FAILED")
              }
            }
          })()
        },
        { once: true }
      )
      startedAt.current = Date.now()
      setElapsedMs(0)
      nextRecorder.start(500)
      setState("recording")
      timer.current = window.setInterval(
        () => setElapsedMs(Date.now() - startedAt.current),
        250
      )
    } catch {
      acquiredStream?.getTracks().forEach((track) => track.stop())
      if (requestGeneration === mediaRequestGeneration.current) {
        if (stream.current === acquiredStream) stream.current = null
        recorder.current = null
        setErrorCode("PERMISSION_DENIED")
        setState("failed")
      }
    }
  }, [queueRequestId, scope, syncQueue])

  const retry = useCallback(async () => {
    setErrorCode(null)
    const activeQueue = queue.current
    if (activeQueue && pendingLocal.current.length) {
      try {
        for (const capture of [...pendingLocal.current]) {
          await activeQueue.put(capture)
          pendingLocal.current = pendingLocal.current.filter(
            ({ clientCaptureId }) => clientCaptureId !== capture.clientCaptureId
          )
          if (mounted.current) setQueuedCount((count) => count + 1)
        }
      } catch {
        setState("failed")
        setErrorCode("LOCAL_AUDIO_SAVE_FAILED")
        return
      }
    }
    await syncQueue()
  }, [syncQueue])

  const discardPending = useCallback(async () => {
    const activeQueue = queue.current
    if (activeQueue) {
      const captures = await activeQueue.list(queueRequestId)
      for (const capture of captures)
        await activeQueue.remove(capture.clientCaptureId)
    }
    pendingLocal.current = []
    setQueuedCount(0)
    setErrorCode(null)
    setState("idle")
  }, [queueRequestId])

  return {
    supported:
      !disabled &&
      typeof MediaRecorder !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia),
    state,
    elapsedMs,
    errorCode,
    queueHydrated,
    queuedCount,
    captures: [],
    start,
    pause() {
      recorder.current?.pause()
      setState("paused")
    },
    resume() {
      recorder.current?.resume()
      setState("recording")
    },
    stop() {
      recorder.current?.stop()
    },
    retry,
    discard() {},
    discardPending,
  }
}

export function GuestEvidencePanel({
  transport,
  questions,
  disabled = false,
  onBlockingStateChange,
  onMaterialModesChange,
  onAccessDenied,
  ownerKey = "anonymous-guest",
  queueFactory,
}: {
  transport: GuestEvidenceTransport
  questions: Array<{ id: string; question: string }>
  disabled?: boolean
  onBlockingStateChange?(blocked: boolean): void
  onMaterialModesChange?(modes: {
    batchHasMaterial: boolean
    oneByOneHasMaterial: boolean
  }): void
  onAccessDenied?(): void
  ownerKey?: string
  queueFactory?: (ownerKey: string) => VoiceCaptureQueue
}) {
  const [assets, setAssets] = useState<Array<GuestResponseAsset>>([])
  const [scopeValue, setScopeValue] = useState("batch")
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryAssetId, setRetryAssetId] = useState<string | null>(null)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [accessDenied, setAccessDenied] = useState(false)
  const accessDeniedRef = useRef(false)
  const onAccessDeniedRef = useRef(onAccessDenied)

  useEffect(() => {
    onAccessDeniedRef.current = onAccessDenied
  }, [onAccessDenied])
  const scope = useMemo<GuestResponseAssetScope>(
    () =>
      scopeValue === "batch"
        ? { kind: "batch" }
        : { kind: "question", questionId: scopeValue },
    [scopeValue]
  )
  const refresh = useCallback(async () => {
    if (accessDeniedRef.current) return
    try {
      setAssets(await transport.list())
      setClockNow(Date.now())
    } catch (caught) {
      const code = guestEvidenceErrorCode(caught)
      if (
        !["ACCESS_DENIED", "ARCHIVED_REQUEST", "EXPIRED_REQUEST"].includes(
          code ?? ""
        ) ||
        accessDeniedRef.current
      )
        return
      accessDeniedRef.current = true
      setAssets([])
      setAccessDenied(true)
      onAccessDeniedRef.current?.()
    }
  }, [transport])
  useEffect(() => {
    if (accessDenied) return
    const initial = window.setTimeout(() => void refresh(), 0)
    const interval = window.setInterval(() => void refresh(), 2_500)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [accessDenied, refresh])
  const evidenceDisabled = disabled || accessDenied
  const voice = useGuestRecorder({
    disabled: evidenceDisabled,
    ownerKey,
    scope,
    transport,
    refresh,
    queueFactory,
  })
  const voiceBlocksSubmission =
    !evidenceDisabled &&
    (!voice.queueHydrated ||
      ["requesting", "recording", "paused", "saving"].includes(voice.state) ||
      voice.queuedCount > 0 ||
      voice.errorCode === "LOCAL_AUDIO_SAVE_FAILED" ||
      voice.errorCode === "VOICE_QUEUE_UNAVAILABLE" ||
      uploading)
  useEffect(() => {
    onBlockingStateChange?.(voiceBlocksSubmission)
    return () => onBlockingStateChange?.(false)
  }, [onBlockingStateChange, voiceBlocksSubmission])
  useEffect(() => {
    onMaterialModesChange?.({
      batchHasMaterial: assets.some((asset) => asset.scope.kind === "batch"),
      oneByOneHasMaterial: assets.some(
        (asset) => asset.scope.kind === "question"
      ),
    })
    return () =>
      onMaterialModesChange?.({
        batchHasMaterial: false,
        oneByOneHasMaterial: false,
      })
  }, [assets, onMaterialModesChange])

  const attach = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      await transport.upload(file, {
        clientAssetId: crypto.randomUUID(),
        kind: "attachment",
        scope,
        fileName: file.name,
        mimeType: file.type,
      })
      await refresh()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not upload the file."
      )
    } finally {
      setUploading(false)
    }
  }

  return (
    <section
      aria-labelledby="guest-evidence-title"
      className="mt-8 space-y-4 rounded-3xl border bg-muted/20 p-4 md:p-5"
    >
      <div>
        <h3 className="font-semibold" id="guest-evidence-title">
          Voice and supporting evidence
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Record context or attach a permitted file. Transcripts stay separate
          from your written answer and remain attributed to their recording.
        </p>
      </div>
      <label className="block text-sm font-medium" htmlFor="evidence-scope">
        Attach to
      </label>
      <NativeSelect
        className="w-full"
        disabled={evidenceDisabled}
        id="evidence-scope"
        onChange={(event) => setScopeValue(event.target.value)}
        size="touch"
        value={scopeValue}
      >
        <NativeSelectOption value="batch">Complete response</NativeSelectOption>
        {questions.map((question) => (
          <NativeSelectOption key={question.id} value={question.id}>
            {question.question}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <FounderVoiceRecorder
        idleInstruction="Tap anywhere in this area. Your transcript stays attached as attributed evidence."
        readOnly={evidenceDisabled}
        readOnlyMessage="Voice recording is unavailable while this response is read-only or another editor has control."
        transcribingDetail="Your recording is saved. Its transcript will remain attached as attributed evidence."
        voice={voice}
      />
      <div>
        <label
          aria-disabled={evidenceDisabled || uploading}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border bg-background px-4 text-sm font-medium shadow-xs transition-colors hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          {uploading ? "Uploading file…" : "Attach supporting file"}
          <Input
            accept={ACCEPTED_FILES}
            className="sr-only"
            disabled={evidenceDisabled || uploading}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void attach(file)
              event.currentTarget.value = ""
            }}
            type="file"
          />
        </label>
        <p className="mt-2 text-xs text-muted-foreground">
          PDF, DOCX, TXT, JPEG, PNG, or WebP · 15 MB maximum
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <AttachmentGroup aria-label="Response evidence">
        {assets.map((asset) => (
          <Attachment key={asset.assetId} state={evidenceState(asset)}>
            <AttachmentMedia>
              <FileText />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{asset.fileName}</AttachmentTitle>
              <AttachmentDescription
                aria-atomic="true"
                aria-live="polite"
                role="status"
              >
                {asset.scope.kind === "batch"
                  ? "Complete response"
                  : questions.find((question) => {
                      const questionId =
                        asset.scope.kind === "question"
                          ? asset.scope.questionId
                          : ""
                      return question.id === questionId
                    })?.question || "Interview question"}
                {" · "}
                {asset.transcriptionState === "transcribed"
                  ? "Transcript ready"
                  : asset.transcriptionState === "transcribing" ||
                      asset.transcriptionState === "queued"
                    ? "Transcribing"
                    : asset.failureCode || asset.uploadState}
              </AttachmentDescription>
              {asset.transcript ? (
                <blockquote
                  aria-label={`Transcript for ${asset.fileName}`}
                  className="mt-2 max-w-xl text-xs whitespace-pre-wrap"
                >
                  <strong>Recording transcript:</strong> {asset.transcript}
                </blockquote>
              ) : null}
            </AttachmentContent>
            {!evidenceDisabled &&
            (asset.uploadState === "failed" ||
              asset.transcriptionState === "failed" ||
              (asset.transcriptionState === "transcribing" &&
                (asset.transcriptionLeaseExpiresAt ?? Infinity) <=
                  clockNow)) ? (
              <AttachmentActions>
                <AttachmentAction
                  aria-label={`Retry ${asset.fileName}`}
                  onClick={() => {
                    setError(null)
                    void transport
                      .retry(
                        asset.assetId,
                        undefined,
                        asset.uploadState === "failed"
                      )
                      .then(refresh)
                      .catch((caught) => {
                        const message =
                          caught instanceof Error
                            ? caught.message
                            : "Could not retry this evidence."
                        setError(message)
                        if (message === "RESELECT_FILE_REQUIRED")
                          setRetryAssetId(asset.assetId)
                      })
                  }}
                >
                  <RotateCcw />
                </AttachmentAction>
                <AttachmentAction
                  aria-label={`Discard ${asset.fileName}`}
                  onClick={() =>
                    void transport.discard(asset.assetId).then(refresh)
                  }
                >
                  <Trash2 />
                </AttachmentAction>
                {retryAssetId === asset.assetId ? (
                  <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border px-3 py-1 text-xs font-medium">
                    Select {asset.kind === "audio" ? "audio" : "file"} again
                    <Input
                      accept={
                        asset.kind === "audio" ? ACCEPTED_AUDIO : ACCEPTED_FILES
                      }
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (!file) return
                        setError(null)
                        void transport
                          .retry(asset.assetId, file, true)
                          .then(async () => {
                            setRetryAssetId(null)
                            await refresh()
                          })
                          .catch((caught) =>
                            setError(
                              caught instanceof Error
                                ? caught.message
                                : "Could not retry this evidence."
                            )
                          )
                        event.currentTarget.value = ""
                      }}
                      type="file"
                    />
                  </label>
                ) : null}
              </AttachmentActions>
            ) : null}
            {asset.feedback.length ? (
              <div
                aria-label={`Administrator feedback for ${asset.fileName}`}
                className="mt-2 space-y-2"
              >
                {asset.feedback.map((entry) => (
                  <p
                    className="rounded-xl border bg-background p-2 text-xs"
                    key={entry.feedbackId}
                  >
                    <strong>{entry.author.displayName}:</strong> {entry.body}
                  </p>
                ))}
              </div>
            ) : null}
          </Attachment>
        ))}
      </AttachmentGroup>
    </section>
  )
}

export function GuestEvidenceServerPanel({
  token,
  ownerKey,
  leaseId,
  leaseGeneration,
  questions,
  disabled = false,
  onBlockingStateChange,
  onMaterialModesChange,
  onAccessDenied,
}: {
  token: string
  ownerKey: string
  leaseId: string
  leaseGeneration: number
  questions: Array<{ id: string; question: string }>
  disabled?: boolean
  onBlockingStateChange?(blocked: boolean): void
  onMaterialModesChange?(modes: {
    batchHasMaterial: boolean
    oneByOneHasMaterial: boolean
  }): void
  onAccessDenied?(): void
}) {
  const begin = useServerFn(beginGuestEvidenceUpload)
  const finalize = useServerFn(finalizeGuestEvidenceUpload)
  const registerUpload = useServerFn(registerGuestEvidenceUpload)
  const markFailed = useServerFn(markGuestEvidenceUploadFailed)
  const list = useServerFn(listGuestEvidence)
  const retry = useServerFn(retryGuestEvidence)
  const discard = useServerFn(discardGuestEvidence)
  const pendingBytes = useRef(new Map<string, File | Blob>())
  const retryOperations = useRef(new Map<string, string>())
  const transport = useMemo<GuestEvidenceTransport>(
    () => ({
      list: () => list({ data: { token } }),
      async upload(file, input) {
        const begun = await begin({
          data: {
            token,
            leaseId,
            leaseGeneration,
            ...input,
            sizeBytes: file.size,
          },
        })
        pendingBytes.current.set(begun.asset.assetId, file)
        try {
          const response = await fetch(begun.uploadUrl, {
            method: "POST",
            headers: { "Content-Type": input.mimeType },
            body: file,
          })
          if (!response.ok) throw new Error(`UPLOAD_${response.status}`)
          const payload = (await response.json()) as { storageId?: unknown }
          if (typeof payload.storageId !== "string")
            throw new Error("UPLOAD_INVALID_RESPONSE")
          await registerUpload({
            data: {
              assetId: begun.asset.assetId,
              uploadSessionId: begun.uploadSessionId,
              storageId: payload.storageId,
              uploadRegistrationToken: begun.uploadRegistrationToken,
            },
          })
          const finalized = await finalize({
            data: {
              token,
              leaseId,
              leaseGeneration,
              assetId: begun.asset.assetId,
              uploadSessionId: begun.uploadSessionId,
              storageId: payload.storageId,
            },
          })
          if (finalized.uploadState === "failed")
            throw new Error(finalized.failureCode ?? "UPLOAD_METADATA_MISMATCH")
          pendingBytes.current.delete(begun.asset.assetId)
          return finalized
        } catch (caught) {
          const uploadError =
            caught instanceof Error ? caught : new Error("UPLOAD_FAILED")
          Object.assign(uploadError, { assetId: begun.asset.assetId })
          try {
            await markFailed({
              data: {
                token,
                leaseId,
                leaseGeneration,
                assetId: begun.asset.assetId,
                uploadSessionId: begun.uploadSessionId,
                failureCode: uploadError.message.slice(0, 100),
              },
            })
          } catch {
            // A lease change can reject this client write; the server watchdog
            // owns recovery for the still-issued upload session.
          }
          throw uploadError
        }
      },
      async retry(assetId, replacement, requiresUpload = false) {
        if (replacement) pendingBytes.current.set(assetId, replacement)
        const bytes = pendingBytes.current.get(assetId)
        if (requiresUpload && !bytes) throw new Error("RESELECT_FILE_REQUIRED")
        const operationId =
          retryOperations.current.get(assetId) ?? crypto.randomUUID()
        retryOperations.current.set(assetId, operationId)
        let result: Awaited<ReturnType<typeof retry>>
        try {
          result = await retry({
            data: {
              token,
              leaseId,
              leaseGeneration,
              assetId,
              operationId,
            },
          })
        } catch (caught) {
          if (guestEvidenceErrorCode(caught) === "UPLOAD_SESSION_SETTLED")
            retryOperations.current.delete(assetId)
          throw caught
        }
        if (
          !result.uploadUrl ||
          !result.uploadSessionId ||
          !result.uploadRegistrationToken
        ) {
          retryOperations.current.delete(assetId)
          return
        }
        if (!bytes) throw new Error("RESELECT_FILE_REQUIRED")
        try {
          const response = await fetch(result.uploadUrl, {
            method: "POST",
            headers: { "Content-Type": result.asset.mimeType },
            body: bytes,
          })
          if (!response.ok) throw new Error(`UPLOAD_${response.status}`)
          const payload = (await response.json()) as { storageId?: unknown }
          if (typeof payload.storageId !== "string")
            throw new Error("UPLOAD_INVALID_RESPONSE")
          await registerUpload({
            data: {
              assetId: result.asset.assetId,
              uploadSessionId: result.uploadSessionId,
              storageId: payload.storageId,
              uploadRegistrationToken: result.uploadRegistrationToken,
            },
          })
          const finalized = await finalize({
            data: {
              token,
              leaseId,
              leaseGeneration,
              assetId,
              uploadSessionId: result.uploadSessionId,
              storageId: payload.storageId,
            },
          })
          if (finalized.uploadState === "failed")
            throw new Error(finalized.failureCode ?? "UPLOAD_METADATA_MISMATCH")
          pendingBytes.current.delete(assetId)
          retryOperations.current.delete(assetId)
        } catch (caught) {
          const uploadError =
            caught instanceof Error ? caught : new Error("UPLOAD_FAILED")
          Object.assign(uploadError, { assetId })
          try {
            await markFailed({
              data: {
                token,
                leaseId,
                leaseGeneration,
                assetId,
                uploadSessionId: result.uploadSessionId,
                failureCode: uploadError.message.slice(0, 100),
              },
            })
          } catch {
            // A lease change can reject this client write; the server watchdog
            // owns recovery for the still-issued upload session.
          }
          retryOperations.current.delete(assetId)
          throw uploadError
        }
      },
      async discard(assetId) {
        await discard({
          data: {
            token,
            leaseId,
            leaseGeneration,
            assetId,
            operationId: crypto.randomUUID(),
          },
        })
        pendingBytes.current.delete(assetId)
        retryOperations.current.delete(assetId)
      },
    }),
    [
      begin,
      discard,
      finalize,
      leaseGeneration,
      leaseId,
      list,
      markFailed,
      retry,
      registerUpload,
      token,
    ]
  )
  return (
    <GuestEvidencePanel
      disabled={disabled}
      onAccessDenied={onAccessDenied}
      onBlockingStateChange={onBlockingStateChange}
      onMaterialModesChange={onMaterialModesChange}
      ownerKey={ownerKey}
      questions={questions}
      transport={transport}
    />
  )
}
