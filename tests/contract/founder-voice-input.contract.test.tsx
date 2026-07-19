// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useFounderVoiceInput } from "@/hooks/use-founder-voice-input"
import type {
  QueuedVoiceCapture,
  VoiceCaptureQueue,
} from "@/lib/voice-capture-queue"

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported() {
    return true
  }

  state: RecordingState = "inactive"
  mimeType = "audio/webm"
  ondataavailable: ((event: BlobEvent) => void) | null = null

  start() {
    this.state = "recording"
  }

  pause() {
    this.state = "paused"
  }

  resume() {
    this.state = "recording"
  }

  stop() {
    this.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent)
    this.state = "inactive"
    this.dispatchEvent(new Event("stop"))
  }
}

function memoryQueue() {
  const captures = new Map<string, QueuedVoiceCapture>()
  const queue: VoiceCaptureQueue = {
    put: vi.fn(async (capture) => {
      captures.set(capture.clientCaptureId, capture)
    }),
    list: vi.fn(async (requestHumanId: string) =>
      [...captures.values()].filter(
        (capture) => capture.requestHumanId === requestHumanId
      )
    ),
    remove: vi.fn(async (captureId) => {
      captures.delete(captureId)
    }),
  }
  return { captures, queue }
}

describe("founder voice input browser contract", () => {
  const stopTrack = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        }),
      },
    })
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("records, pauses, resumes, and queues audio offline before reconnect upload", async () => {
    const { captures, queue } = memoryQueue()
    const queueFactory = vi.fn(() => queue)
    const finalize = vi.fn().mockResolvedValue({})
    const transport = {
      createUploadUrl: vi.fn().mockResolvedValue("https://upload.test/audio"),
      finalize,
      list: vi.fn().mockResolvedValue([]),
      retry: vi.fn(),
      markMerged: vi.fn(),
    }
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ storageId: "storage-voice-1" }, { status: 200 })
        )
    )
    const view = renderHook(() =>
      useFounderVoiceInput({
        requestHumanId: "CR-000001",
        ownerKey: "org:founder",
        transport,
        appendTranscript: vi.fn(),
        ensureDurablySynced: vi.fn().mockResolvedValue(true),
        queueFactory,
      })
    )
    await waitFor(() => expect(view.result.current.supported).toBe(true))

    await act(() => view.result.current.start())
    expect(view.result.current.state).toBe("recording")
    act(() => view.result.current.pause())
    expect(view.result.current.state).toBe("paused")
    act(() => view.result.current.resume())
    expect(view.result.current.state).toBe("recording")
    await act(() => view.result.current.stop())

    expect(captures.size).toBe(1)
    expect(view.result.current.queuedCount).toBe(1)
    expect(transport.createUploadUrl).not.toHaveBeenCalled()

    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    })
    act(() => window.dispatchEvent(new Event("online")))
    await waitFor(() => expect(finalize).toHaveBeenCalledOnce())
    expect(captures.size).toBe(0)
    expect(stopTrack).toHaveBeenCalled()
    view.unmount()
  })

  it("reports permission denial without appending or corrupting typed input", async () => {
    const { queue } = memoryQueue()
    const appendTranscript = vi.fn()
    const queueFactory = () => queue
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      new DOMException("Denied", "NotAllowedError")
    )
    const view = renderHook(() =>
      useFounderVoiceInput({
        requestHumanId: "CR-000001",
        ownerKey: "org:founder",
        transport: {
          createUploadUrl: vi.fn(),
          finalize: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
          retry: vi.fn(),
          markMerged: vi.fn(),
        },
        appendTranscript,
        ensureDurablySynced: vi.fn().mockResolvedValue(true),
        queueFactory,
      })
    )
    await waitFor(() => expect(view.result.current.supported).toBe(true))
    await act(() => view.result.current.start())
    expect(view.result.current).toMatchObject({
      state: "failed",
      errorCode: "PERMISSION_DENIED",
    })
    expect(appendTranscript).not.toHaveBeenCalled()
    view.unmount()
  })

  it("stops an acquired stream when recorder construction fails", async () => {
    class BrokenMediaRecorder {
      static isTypeSupported() {
        return true
      }
      constructor() {
        throw new DOMException("Unsupported", "NotSupportedError")
      }
    }
    vi.stubGlobal("MediaRecorder", BrokenMediaRecorder)
    const { queue } = memoryQueue()
    const queueFactory = () => queue
    const view = renderHook(() =>
      useFounderVoiceInput({
        requestHumanId: "CR-000001",
        ownerKey: "org:founder",
        transport: {
          createUploadUrl: vi.fn(),
          finalize: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
          retry: vi.fn(),
          markMerged: vi.fn(),
        },
        appendTranscript: vi.fn(),
        ensureDurablySynced: vi.fn().mockResolvedValue(true),
        queueFactory,
      })
    )
    await waitFor(() => expect(view.result.current.supported).toBe(true))
    await act(() => view.result.current.start())
    expect(stopTrack).toHaveBeenCalled()
    expect(view.result.current.errorCode).toBe("RECORDING_UNAVAILABLE")
    view.unmount()
  })

  it("clears an inactive recorder when recorder start fails", async () => {
    class StartFailureRecorder extends FakeMediaRecorder {
      start() {
        throw new DOMException("Start failed", "NotSupportedError")
      }
    }
    vi.stubGlobal("MediaRecorder", StartFailureRecorder)
    const { queue } = memoryQueue()
    const queueFactory = () => queue
    const view = renderHook(() =>
      useFounderVoiceInput({
        requestHumanId: "CR-000001",
        ownerKey: "org:founder",
        transport: {
          createUploadUrl: vi.fn(),
          finalize: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
          retry: vi.fn(),
          markMerged: vi.fn(),
        },
        appendTranscript: vi.fn(),
        ensureDurablySynced: vi.fn().mockResolvedValue(true),
        queueFactory,
      })
    )
    await waitFor(() => expect(view.result.current.supported).toBe(true))
    await act(() => view.result.current.start())
    expect(view.result.current.errorCode).toBe("RECORDING_UNAVAILABLE")
    expect(() => view.unmount()).not.toThrow()
  })

  it("retains multiple stopped recordings when IndexedDB fails and retries them", async () => {
    const { captures, queue } = memoryQueue()
    const queueFactory = () => queue
    vi.mocked(queue.put)
      .mockRejectedValueOnce(new DOMException("Quota", "QuotaExceededError"))
      .mockRejectedValueOnce(new DOMException("Quota", "QuotaExceededError"))
      .mockImplementationOnce(async (capture) => {
        captures.set(capture.clientCaptureId, capture)
      })
      .mockRejectedValueOnce(new DOMException("Quota", "QuotaExceededError"))
      .mockImplementation(async (capture) => {
        captures.set(capture.clientCaptureId, capture)
      })
    const view = renderHook(() =>
      useFounderVoiceInput({
        requestHumanId: "CR-000001",
        ownerKey: "org:founder",
        transport: {
          createUploadUrl: vi.fn(),
          finalize: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
          retry: vi.fn(),
          markMerged: vi.fn(),
        },
        appendTranscript: vi.fn(),
        ensureDurablySynced: vi.fn().mockResolvedValue(true),
        queueFactory,
      })
    )
    await waitFor(() => expect(view.result.current.supported).toBe(true))
    await act(() => view.result.current.start())
    await act(() => view.result.current.stop())
    expect(view.result.current.errorCode).toBe("LOCAL_AUDIO_SAVE_FAILED")
    await act(() => view.result.current.start())
    await act(() => view.result.current.stop())
    await act(() => view.result.current.retry())
    expect(captures.size).toBe(1)
    expect(view.result.current.queuedCount).toBe(1)
    expect(view.result.current.errorCode).toBe("LOCAL_AUDIO_SAVE_FAILED")
    await act(() => view.result.current.retry())
    expect(captures.size).toBe(2)
    expect(view.result.current.queuedCount).toBe(2)
    expect(view.result.current.state).toBe("saving")
    view.unmount()
  })

  it("appends a completed transcript once and marks it only after durable sync", async () => {
    const { queue } = memoryQueue()
    const appendTranscript = vi.fn()
    const ensureDurablySynced = vi.fn().mockResolvedValue(true)
    const markMerged = vi.fn().mockResolvedValue({})
    const capture = {
      captureId: "capture-transcribed",
      clientCaptureId: "client-transcribed",
      mimeType: "audio/webm",
      sizeBytes: 10,
      durationMs: 1_000,
      recordedAt: 1,
      status: "transcribed" as const,
      transcript: "Spoken founder insight.",
      failureCode: null,
      transcriptMergedAt: null,
      createdAt: 1,
      updatedAt: 2,
    }
    const queueFactory = () => queue
    const view = renderHook(() =>
      useFounderVoiceInput({
        requestHumanId: "CR-000001",
        ownerKey: "org:founder",
        transport: {
          createUploadUrl: vi.fn(),
          finalize: vi.fn(),
          list: vi.fn().mockResolvedValue([capture]),
          retry: vi.fn(),
          markMerged,
        },
        appendTranscript,
        ensureDurablySynced,
        queueFactory,
      })
    )

    await waitFor(() => expect(markMerged).toHaveBeenCalledOnce())
    expect(appendTranscript).toHaveBeenCalledOnce()
    expect(appendTranscript).toHaveBeenCalledWith(
      "capture-transcribed",
      "Spoken founder insight.",
      1
    )
    expect(ensureDurablySynced).toHaveBeenCalledOnce()
    view.unmount()
  })

  it("does not drain another request's offline audio", async () => {
    const { queue } = memoryQueue()
    await queue.put({
      requestHumanId: "CR-000001",
      clientCaptureId: "capture-for-a",
      blob: new Blob(["audio"], { type: "audio/webm" }),
      mimeType: "audio/webm",
      durationMs: 1_000,
      createdAt: 1,
    })
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    })
    const createUploadUrl = vi.fn()
    const queueFactory = () => queue
    const view = renderHook(() =>
      useFounderVoiceInput({
        requestHumanId: "CR-000002",
        ownerKey: "org:founder",
        transport: {
          createUploadUrl,
          finalize: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
          retry: vi.fn(),
          markMerged: vi.fn(),
        },
        appendTranscript: vi.fn(),
        ensureDurablySynced: vi.fn().mockResolvedValue(true),
        queueFactory,
      })
    )
    await waitFor(() => expect(view.result.current.queuedCount).toBe(0))
    expect(createUploadUrl).not.toHaveBeenCalled()
    expect(await queue.list("CR-000001")).toHaveLength(1)
    view.unmount()
  })

  it("resumes finalize with the persisted storage id after a lost response", async () => {
    const { queue } = memoryQueue()
    await queue.put({
      requestHumanId: "CR-000001",
      clientCaptureId: "capture-lost-response",
      blob: new Blob(["audio"], { type: "audio/webm" }),
      mimeType: "audio/webm",
      durationMs: 1_000,
      createdAt: 1,
    })
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    })
    const finalize = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({})
    const upload = vi
      .fn()
      .mockResolvedValue(Response.json({ storageId: "stable-storage" }))
    vi.stubGlobal("fetch", upload)
    const queueFactory = () => queue
    const view = renderHook(() =>
      useFounderVoiceInput({
        requestHumanId: "CR-000001",
        ownerKey: "org:founder",
        transport: {
          createUploadUrl: vi.fn().mockResolvedValue("https://upload.test"),
          finalize,
          list: vi.fn().mockResolvedValue([]),
          retry: vi.fn(),
          markMerged: vi.fn(),
        },
        appendTranscript: vi.fn(),
        ensureDurablySynced: vi.fn().mockResolvedValue(true),
        queueFactory,
      })
    )
    await waitFor(() => expect(finalize).toHaveBeenCalledOnce())
    act(() => window.dispatchEvent(new Event("online")))
    await waitFor(() => expect(finalize).toHaveBeenCalledTimes(2))
    expect(upload).toHaveBeenCalledOnce()
    expect(finalize.mock.calls[1]?.[0].storageId).toBe("stable-storage")
    expect(await queue.list("CR-000001")).toHaveLength(0)
    view.unmount()
  })
})
