import { useCallback, useEffect, useRef, useState } from "react"

import type { FounderVoiceCapture } from "@/application/content-requests"
import {
  createVoiceCaptureQueue,
  type QueuedVoiceCapture,
  type VoiceCaptureQueue,
} from "@/lib/voice-capture-queue"

export type VoiceInputState =
  | "idle"
  | "requesting"
  | "recording"
  | "paused"
  | "saving"
  | "transcribing"
  | "failed"

type VoiceTransport = {
  createUploadUrl(): Promise<string>
  finalize(input: {
    clientCaptureId: string
    storageId: string
    mimeType: string
    sizeBytes: number
    durationMs: number
    recordedAt: number
    correlationId: string
  }): Promise<FounderVoiceCapture>
  list(): Promise<Array<FounderVoiceCapture>>
  retry(captureId: string): Promise<FounderVoiceCapture>
  markMerged(captureId: string): Promise<FounderVoiceCapture>
  discard?(captureId: string): Promise<FounderVoiceCapture>
}

export function useFounderVoiceInput({
  requestHumanId,
  ownerKey,
  transport,
  appendTranscript,
  ensureDurablySynced,
  queueFactory = createVoiceCaptureQueue,
  enabled = true,
}: {
  requestHumanId: string
  ownerKey: string
  transport: VoiceTransport
  appendTranscript(
    captureId: string,
    transcript: string,
    recordedAt: number
  ): void
  ensureDurablySynced(): Promise<boolean>
  queueFactory?: (ownerKey: string) => VoiceCaptureQueue
  enabled?: boolean
}) {
  const [supported, setSupported] = useState(false)
  const [state, setState] = useState<VoiceInputState>("idle")
  const [elapsedMs, setElapsedMs] = useState(0)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [captures, setCaptures] = useState<Array<FounderVoiceCapture>>([])
  const [queuedCount, setQueuedCount] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Array<Blob>>([])
  const accumulatedMsRef = useRef(0)
  const activeSinceRef = useRef<number | null>(null)
  const queueRef = useRef<VoiceCaptureQueue | null>(null)
  const syncingRef = useRef(false)
  const pendingLocalCapturesRef = useRef<Array<QueuedVoiceCapture>>([])
  const mountedRef = useRef(false)
  const transportRef = useRef(transport)
  const appendTranscriptRef = useRef(appendTranscript)
  const ensureDurablySyncedRef = useRef(ensureDurablySynced)

  useEffect(() => {
    transportRef.current = transport
    appendTranscriptRef.current = appendTranscript
    ensureDurablySyncedRef.current = ensureDurablySynced
  }, [appendTranscript, ensureDurablySynced, transport])

  const mergeReadyTranscripts = useCallback(
    async (nextCaptures: Array<FounderVoiceCapture>) => {
      const mergedCaptures = [...nextCaptures]
      for (const capture of nextCaptures) {
        if (
          capture.discardedAt ||
          capture.status !== "transcribed" ||
          !capture.transcript ||
          capture.transcriptMergedAt
        ) {
          continue
        }
        appendTranscriptRef.current(
          capture.captureId,
          capture.transcript,
          capture.recordedAt
        )
        try {
          if (!(await ensureDurablySyncedRef.current())) continue
          const merged = await transportRef.current.markMerged(
            capture.captureId
          )
          const index = mergedCaptures.findIndex(
            (candidate) => candidate.captureId === capture.captureId
          )
          if (index >= 0) mergedCaptures[index] = merged
        } catch {
          // Keep the unmerged capture visible; polling retries the durable merge.
        }
      }
      return mergedCaptures
    },
    []
  )

  const refreshCaptures = useCallback(async () => {
    let next: Array<FounderVoiceCapture>
    try {
      next = await transportRef.current.list()
    } catch {
      return []
    }
    const merged = await mergeReadyTranscripts(next)
    if (mountedRef.current) {
      setCaptures(merged)
      if (merged.some((capture) => capture.status === "transcribing")) {
        setState((current) =>
          ["recording", "paused", "requesting", "saving"].includes(current)
            ? current
            : "transcribing"
        )
      } else if (
        merged.some(
          (capture) => capture.status === "failed" && !capture.discardedAt
        )
      ) {
        setState((current) =>
          ["recording", "paused", "requesting", "saving"].includes(current)
            ? current
            : "failed"
        )
      } else {
        setState((current) =>
          ["recording", "paused", "requesting", "saving"].includes(current)
            ? current
            : "idle"
        )
      }
    }
    return merged
  }, [mergeReadyTranscripts])

  const syncQueue = useCallback(async () => {
    const queue = queueRef.current
    if (!queue || syncingRef.current || !navigator.onLine) return
    syncingRef.current = true
    try {
      const drain = async () => {
        const pending = await queue.list(requestHumanId)
        if (mountedRef.current) setQueuedCount(pending.length)
        for (const capture of pending) {
          if (mountedRef.current) setState("saving")
          let storageId = capture.storageId
          if (!storageId) {
            const uploadUrl = await transportRef.current.createUploadUrl()
            const response = await fetch(uploadUrl, {
              method: "POST",
              headers: { "Content-Type": capture.mimeType },
              body: capture.blob,
            })
            if (!response.ok) throw new Error(`VOICE_UPLOAD_${response.status}`)
            const result = (await response.json()) as { storageId?: unknown }
            if (typeof result.storageId !== "string") {
              throw new Error("VOICE_UPLOAD_INVALID_RESPONSE")
            }
            storageId = result.storageId
            await queue.put({ ...capture, storageId })
          }
          await transportRef.current.finalize({
            clientCaptureId: capture.clientCaptureId,
            storageId,
            mimeType: capture.mimeType,
            sizeBytes: capture.blob.size,
            durationMs: capture.durationMs,
            recordedAt: capture.createdAt,
            correlationId: crypto.randomUUID(),
          })
          await queue.remove(capture.clientCaptureId)
        }
        const remaining = await queue.list(requestHumanId)
        if (mountedRef.current) {
          setQueuedCount(remaining.length)
          setErrorCode(null)
        }
        await refreshCaptures()
      }
      const lockName = `fairlend-voice-sync:${encodeURIComponent(ownerKey)}:${requestHumanId}`
      if (navigator.locks) await navigator.locks.request(lockName, drain)
      else await drain()
    } catch (error) {
      if (mountedRef.current) {
        setState(navigator.onLine ? "failed" : "saving")
        setErrorCode(
          error instanceof Error ? error.message : "VOICE_UPLOAD_FAILED"
        )
      }
    } finally {
      syncingRef.current = false
    }
  }, [ownerKey, refreshCaptures, requestHumanId])

  useEffect(() => {
    mountedRef.current = true
    if (!enabled) {
      return () => {
        mountedRef.current = false
      }
    }
    queueRef.current = queueFactory(ownerKey)
    const canRecord =
      typeof MediaRecorder !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function"
    queueMicrotask(() => {
      if (mountedRef.current) setSupported(canRecord)
    })
    void queueRef.current
      .list(requestHumanId)
      .then((pending) => {
        if (mountedRef.current) setQueuedCount(pending.length)
      })
      .then(() => syncQueue())
    void refreshCaptures()
    const reconnect = () => void syncQueue()
    window.addEventListener("online", reconnect)
    return () => {
      mountedRef.current = false
      window.removeEventListener("online", reconnect)
      const recorder = recorderRef.current
      if (recorder && recorder.state !== "inactive") recorder.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [
    enabled,
    ownerKey,
    queueFactory,
    refreshCaptures,
    requestHumanId,
    syncQueue,
  ])

  useEffect(() => {
    if (
      !enabled ||
      !captures.some(
        (capture) =>
          capture.status === "uploaded" ||
          capture.status === "transcribing" ||
          (capture.status === "transcribed" &&
            !capture.transcriptMergedAt &&
            !capture.discardedAt)
      )
    )
      return
    const timer = window.setInterval(() => void refreshCaptures(), 2_000)
    return () => window.clearInterval(timer)
  }, [captures, enabled, refreshCaptures])

  useEffect(() => {
    if (state !== "recording") return
    const timer = window.setInterval(() => {
      const activeSince = activeSinceRef.current
      setElapsedMs(
        accumulatedMsRef.current +
          (activeSince === null ? 0 : performance.now() - activeSince)
      )
    }, 250)
    return () => window.clearInterval(timer)
  }, [state])

  const start = useCallback(async () => {
    if (!enabled || !supported || state === "recording" || state === "paused")
      return
    setState("requesting")
    setErrorCode(null)
    let acquiredStream: MediaStream | null = null
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      acquiredStream = stream
      streamRef.current = stream
      const preferredMimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(
        stream,
        preferredMimeType ? { mimeType: preferredMimeType } : undefined
      )
      chunksRef.current = []
      accumulatedMsRef.current = 0
      activeSinceRef.current = performance.now()
      setElapsedMs(0)
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorderRef.current = recorder
      recorder.start(1_000)
      setState("recording")
    } catch (error) {
      acquiredStream?.getTracks().forEach((track) => track.stop())
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      recorderRef.current = null
      setState("failed")
      setErrorCode(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "PERMISSION_DENIED"
          : "RECORDING_UNAVAILABLE"
      )
    }
  }, [enabled, state, supported])

  const pause = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== "recording") return
    recorder.pause()
    if (activeSinceRef.current !== null) {
      accumulatedMsRef.current += performance.now() - activeSinceRef.current
      activeSinceRef.current = null
    }
    setElapsedMs(accumulatedMsRef.current)
    setState("paused")
  }, [])

  const resume = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== "paused") return
    recorder.resume()
    activeSinceRef.current = performance.now()
    setState("recording")
  }, [])

  const stop = useCallback(async () => {
    const recorder = recorderRef.current
    const queue = queueRef.current
    if (!recorder || !queue || recorder.state === "inactive") return
    if (activeSinceRef.current !== null) {
      accumulatedMsRef.current += performance.now() - activeSinceRef.current
      activeSinceRef.current = null
    }
    const durationMs = Math.max(1, Math.round(accumulatedMsRef.current))
    setElapsedMs(durationMs)
    setState("saving")
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true })
    })
    recorder.stop()
    await stopped
    const mimeType = recorder.mimeType || "audio/webm"
    const blob = new Blob(chunksRef.current, { type: mimeType })
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (blob.size === 0) {
      setState("failed")
      setErrorCode("EMPTY_RECORDING")
      return
    }
    const queuedCapture: QueuedVoiceCapture = {
      requestHumanId: requestHumanId.trim().toUpperCase(),
      clientCaptureId: crypto.randomUUID(),
      blob,
      mimeType,
      durationMs,
      createdAt: Date.now(),
    }
    try {
      await queue.put(queuedCapture)
    } catch {
      pendingLocalCapturesRef.current.push(queuedCapture)
      setState("failed")
      setErrorCode("LOCAL_AUDIO_SAVE_FAILED")
      return
    }
    setQueuedCount((count) => count + 1)
    if (navigator.onLine) await syncQueue()
    else setState("saving")
  }, [requestHumanId, syncQueue])

  const retry = useCallback(
    async (captureId?: string) => {
      setErrorCode(null)
      if (captureId) await transportRef.current.retry(captureId)
      const pendingLocal = [...pendingLocalCapturesRef.current]
      if (pendingLocal.length > 0 && queueRef.current) {
        try {
          for (const capture of pendingLocal) {
            await queueRef.current.put(capture)
            pendingLocalCapturesRef.current =
              pendingLocalCapturesRef.current.filter(
                (retained) =>
                  retained.clientCaptureId !== capture.clientCaptureId
              )
            setQueuedCount((count) => count + 1)
          }
          setState("saving")
        } catch {
          setState("failed")
          setErrorCode("LOCAL_AUDIO_SAVE_FAILED")
          return
        }
      }
      await syncQueue()
      await refreshCaptures()
    },
    [refreshCaptures, syncQueue]
  )

  const discard = useCallback(
    async (captureId: string) => {
      if (!transportRef.current.discard) return
      await transportRef.current.discard(captureId)
      await refreshCaptures()
    },
    [refreshCaptures]
  )

  const discardPending = useCallback(async () => {
    const queue = queueRef.current
    if (queue) {
      const pending = await queue.list(requestHumanId)
      for (const capture of pending) await queue.remove(capture.clientCaptureId)
    }
    pendingLocalCapturesRef.current = []
    setQueuedCount(0)
    setErrorCode(null)
    setState("idle")
  }, [requestHumanId])

  return {
    supported,
    state,
    elapsedMs,
    errorCode,
    queuedCount,
    captures,
    start,
    pause,
    resume,
    stop,
    retry,
    discard,
    discardPending,
  }
}
