import { Mic, Pause, Play, RotateCcw, Square } from "lucide-react"

import { Button } from "@/components/ui/button"

export type FounderVoiceController = {
  supported: boolean
  state:
    | "idle"
    | "requesting"
    | "recording"
    | "paused"
    | "saving"
    | "transcribing"
    | "failed"
  elapsedMs: number
  errorCode: string | null
  queuedCount: number
  captures: Array<{
    captureId: string
    status: "uploaded" | "transcribing" | "transcribed" | "failed"
    failureCode: string | null
    transcriptMergedAt: number | null
    discardedAt: number | null
  }>
  start(): void | Promise<void>
  pause(): void
  resume(): void
  stop(): void | Promise<void>
  retry(captureId?: string): void | Promise<void>
  discard(captureId: string): void | Promise<void>
  discardPending(): void | Promise<void>
}

function formatElapsed(elapsedMs: number) {
  const minutes = Math.floor(elapsedMs / 60_000)
    .toString()
    .padStart(2, "0")
  const seconds = Math.floor((elapsedMs % 60_000) / 1_000)
    .toString()
    .padStart(2, "0")
  return `${minutes}:${seconds}`
}

function stateContent(
  voice: FounderVoiceController,
  transcribingDetail: string
) {
  if (voice.errorCode === "PERMISSION_DENIED") {
    return {
      title: "Microphone access denied",
      detail:
        "Allow microphone access in your browser, then try again. Your typed input is unchanged.",
    }
  }
  if (voice.errorCode) {
    return {
      title: "Voice input needs attention",
      detail: `Could not finish voice input (${voice.errorCode}). Your typed input is safe.`,
    }
  }
  if (voice.state === "recording") {
    return {
      title: "Recording",
      detail:
        "Speak naturally. Pause or stop when your perspective is complete.",
    }
  }
  if (voice.state === "paused") {
    return {
      title: "Recording paused",
      detail: "Resume when you are ready, or stop to save this recording.",
    }
  }
  if (voice.state === "requesting") {
    return {
      title: "Waiting for microphone access",
      detail: "Use the browser prompt to allow this recording.",
    }
  }
  if (voice.state === "failed") {
    return {
      title: "A recording needs attention",
      detail: "Retry transcription or discard the recording to continue.",
    }
  }
  if (voice.state === "saving") {
    return {
      title: "Audio saved locally",
      detail:
        voice.queuedCount > 0
          ? `${voice.queuedCount} recording${voice.queuedCount === 1 ? " is" : "s are"} queued for upload.`
          : "Securing your recording before upload.",
    }
  }
  return {
    title: "Transcribing audio",
    detail: transcribingDetail,
  }
}

export function FounderVoiceRecorder({
  voice,
  readOnly = false,
  readOnlyMessage = "Founder input was submitted and is now read-only.",
  idleInstruction = "Tap anywhere in this area. Your transcript will be added to Type.",
  transcribingDetail = "Your recording is saved. The transcript will appear in Type mode.",
}: {
  voice?: FounderVoiceController
  readOnly?: boolean
  readOnlyMessage?: string
  idleInstruction?: string
  transcribingDetail?: string
}) {
  if (readOnly) {
    return (
      <div className="unified-editor__record-state" role="status">
        {readOnlyMessage}
      </div>
    )
  }

  if (!voice?.supported) {
    return (
      <div className="unified-editor__record-state" role="status">
        <span className="unified-editor__record-icon" aria-hidden="true">
          <Mic />
        </span>
        <span className="unified-editor__record-copy">
          <strong>Voice recording unavailable</strong>
          <span>
            This browser cannot capture audio. Use Type to add your perspective.
          </span>
        </span>
      </div>
    )
  }

  if (voice.state === "idle") {
    return (
      <Button
        type="button"
        variant="ghost"
        className="unified-editor__record-trigger"
        aria-label="Press to record"
        aria-describedby="voice-record-instructions"
        onClick={() => void voice.start()}
      >
        <span className="unified-editor__record-icon" aria-hidden="true">
          <Mic />
        </span>
        <span className="unified-editor__record-copy">
          <strong>Press to record</strong>
          <span id="voice-record-instructions">{idleInstruction}</span>
        </span>
      </Button>
    )
  }

  const content = stateContent(voice, transcribingDetail)
  const elapsed = formatElapsed(voice.elapsedMs)
  const canRestart = [
    "PERMISSION_DENIED",
    "RECORDING_UNAVAILABLE",
    "EMPTY_RECORDING",
  ].includes(voice.errorCode ?? "")
  const failedCaptures = voice.captures.filter(
    (capture) => capture.status === "failed" && !capture.discardedAt
  )

  return (
    <div
      className="unified-editor__record-state"
      data-state={voice.state}
      aria-busy={
        ["requesting", "saving", "transcribing"].includes(voice.state)
          ? "true"
          : undefined
      }
    >
      <span className="unified-editor__record-icon" aria-hidden="true">
        <Mic />
      </span>
      <span
        className="unified-editor__record-copy"
        role="status"
        aria-live="polite"
      >
        <strong>{content.title}</strong>
        <span>{content.detail}</span>
      </span>
      {voice.state === "recording" || voice.state === "paused" ? (
        <time
          className="unified-editor__record-time"
          dateTime={`PT${Math.floor(voice.elapsedMs / 1_000)}S`}
          aria-label={`${elapsed} elapsed`}
        >
          {elapsed}
        </time>
      ) : null}
      <div className="unified-editor__record-actions">
        {voice.state === "recording" ? (
          <Button type="button" variant="outline" onClick={voice.pause}>
            <Pause /> Pause recording
          </Button>
        ) : null}
        {voice.state === "paused" ? (
          <Button type="button" variant="outline" onClick={voice.resume}>
            <Play /> Resume recording
          </Button>
        ) : null}
        {["recording", "paused"].includes(voice.state) ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => void voice.stop()}
          >
            <Square /> Stop and save
          </Button>
        ) : null}
        {voice.state === "failed" &&
        (voice.errorCode || failedCaptures.length === 0) ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void (canRestart ? voice.start() : voice.retry())}
          >
            <RotateCcw /> {canRestart ? "Try recording again" : "Retry upload"}
          </Button>
        ) : null}
        {voice.queuedCount > 0 ||
        voice.errorCode === "LOCAL_AUDIO_SAVE_FAILED" ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void voice.discardPending()}
          >
            Discard pending recordings
          </Button>
        ) : null}
        {failedCaptures.map((capture) => (
          <span
            className="unified-editor__record-capture-actions"
            key={capture.captureId}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void voice.retry(capture.captureId)}
            >
              Retry transcription
              {capture.failureCode ? ` (${capture.failureCode})` : ""}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void voice.discard(capture.captureId)}
            >
              Discard recording
            </Button>
          </span>
        ))}
      </div>
    </div>
  )
}
