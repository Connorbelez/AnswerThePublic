// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { GuestResponseAsset } from "@/application/content-requests"
import {
  GuestEvidencePanel,
  GuestEvidenceServerPanel,
  type GuestEvidenceTransport,
} from "@/components/guest-evidence-panel"
import type {
  QueuedVoiceCapture,
  VoiceCaptureQueue,
} from "@/lib/voice-capture-queue"

const serverMocks = vi.hoisted(() => ({
  begin: vi.fn(),
  discard: vi.fn(),
  finalize: vi.fn(),
  list: vi.fn(),
  markFailed: vi.fn(),
  register: vi.fn(),
  retry: vi.fn(),
}))

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (serverFn: symbol) => {
    const operation = serverFn.description
    if (operation === "beginGuestEvidenceUpload") return serverMocks.begin
    if (operation === "discardGuestEvidence") return serverMocks.discard
    if (operation === "finalizeGuestEvidenceUpload") return serverMocks.finalize
    if (operation === "listGuestEvidence") return serverMocks.list
    if (operation === "markGuestEvidenceUploadFailed")
      return serverMocks.markFailed
    if (operation === "registerGuestEvidenceUpload") return serverMocks.register
    return serverMocks.retry
  },
}))

vi.mock("@/application/content-request-server-functions", () => ({
  beginGuestEvidenceUpload: Symbol("beginGuestEvidenceUpload"),
  discardGuestEvidence: Symbol("discardGuestEvidence"),
  finalizeGuestEvidenceUpload: Symbol("finalizeGuestEvidenceUpload"),
  listGuestEvidence: Symbol("listGuestEvidence"),
  markGuestEvidenceUploadFailed: Symbol("markGuestEvidenceUploadFailed"),
  registerGuestEvidenceUpload: Symbol("registerGuestEvidenceUpload"),
  retryGuestEvidence: Symbol("retryGuestEvidence"),
}))

const originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "mediaDevices"
)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  if (originalMediaDevicesDescriptor) {
    Object.defineProperty(
      navigator,
      "mediaDevices",
      originalMediaDevicesDescriptor
    )
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices")
  }
  vi.restoreAllMocks()
})

const failedAsset: GuestResponseAsset = {
  assetId: "asset-failed",
  clientAssetId: "browser-file-1",
  kind: "attachment",
  scope: { kind: "question", questionId: "question-1" },
  fileName: "permit-sequence.txt",
  mimeType: "text/plain",
  sizeBytes: 16,
  uploadState: "failed",
  transcriptionState: "not_applicable",
  transcript: null,
  transcriptVersion: 0,
  transcriptionLeaseExpiresAt: null,
  failureCode: "NETWORK_FAILED",
  retryHistory: [
    {
      stage: "upload",
      attempt: 1,
      outcome: "failed",
      code: "NETWORK_FAILED",
      at: 1_722_000_000_000,
    },
  ],
  version: 2,
  submittedAt: null,
  discardedAt: null,
  downloadUrl: null,
  feedback: [
    {
      feedbackId: "feedback-asset-1",
      assetId: "asset-failed",
      body: "Please include the permit desk name.",
      author: { displayName: "Operator" },
      createdAt: 1_722_000_100_000,
    },
  ],
  createdAt: 1_721_999_000_000,
  updatedAt: 1_722_000_000_000,
}

function transport(
  overrides: Partial<GuestEvidenceTransport> = {}
): GuestEvidenceTransport {
  return {
    list: vi.fn().mockResolvedValue([failedAsset]),
    upload: vi.fn(),
    retry: vi.fn().mockResolvedValue(undefined),
    discard: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function voiceQueue(): VoiceCaptureQueue {
  const captures = new Map<string, QueuedVoiceCapture>()
  return {
    async put(capture) {
      captures.set(capture.clientCaptureId, capture)
    },
    async list(requestHumanId) {
      return [...captures.values()].filter(
        (capture) => capture.requestHumanId === requestHumanId
      )
    },
    async remove(clientCaptureId) {
      captures.delete(clientCaptureId)
    },
  }
}

function installRecorder(getUserMedia: () => Promise<MediaStream>) {
  const constructed = vi.fn()
  class TestMediaRecorder {
    static isTypeSupported() {
      return true
    }

    readonly mimeType = "audio/webm"
    state: RecordingState = "inactive"
    private listeners = new Map<string, Array<(event: Event) => void>>()

    constructor(readonly stream: MediaStream) {
      constructed()
    }

    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject
    ) {
      const callback =
        typeof listener === "function"
          ? listener
          : (event: Event) => listener.handleEvent(event)
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback])
    }

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
      if (this.state === "inactive") return
      this.state = "inactive"
      const dataEvent = Object.assign(new Event("dataavailable"), {
        data: new Blob(["durable-audio"], { type: "audio/webm" }),
      })
      for (const listener of this.listeners.get("dataavailable") ?? [])
        listener(dataEvent)
      for (const listener of this.listeners.get("stop") ?? [])
        listener(new Event("stop"))
    }
  }
  vi.stubGlobal("MediaRecorder", TestMediaRecorder)
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  })
  return constructed
}

describe("GuestEvidencePanel", () => {
  it("fails closed until the durable voice queue has been inspected", async () => {
    let resolveCaptures!: (captures: Array<QueuedVoiceCapture>) => void
    const captures = new Promise<Array<QueuedVoiceCapture>>((resolve) => {
      resolveCaptures = resolve
    })
    const queue: VoiceCaptureQueue = {
      put: vi.fn(),
      list: vi.fn(() => captures),
      remove: vi.fn(),
    }
    const onBlockingStateChange = vi.fn()

    render(
      <GuestEvidencePanel
        onBlockingStateChange={onBlockingStateChange}
        questions={[]}
        queueFactory={() => queue}
        transport={transport({ list: vi.fn().mockResolvedValue([]) })}
      />
    )

    await waitFor(() =>
      expect(onBlockingStateChange).toHaveBeenLastCalledWith(true)
    )

    resolveCaptures([])

    await waitFor(() =>
      expect(onBlockingStateChange).toHaveBeenLastCalledWith(false)
    )
  })

  it("fails closed and stops polling after guest evidence access is denied", async () => {
    vi.useFakeTimers()
    const denied = Object.assign(new Error("ACCESS_DENIED"), {
      data: { code: "ACCESS_DENIED" },
    })
    const list = vi.fn().mockRejectedValue(denied)
    const onAccessDenied = vi.fn()

    render(
      <GuestEvidencePanel
        onAccessDenied={onAccessDenied}
        questions={[]}
        queueFactory={() => voiceQueue()}
        transport={transport({ list })}
      />
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(onAccessDenied).toHaveBeenCalledTimes(1)
    expect(
      (
        screen.getByRole("combobox", {
          name: "Attach to",
        }) as HTMLSelectElement
      ).disabled
    ).toBe(true)
    const callsAfterDenial = list.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(list).toHaveBeenCalledTimes(callsAfterDenial)
    expect(onAccessDenied).toHaveBeenCalledTimes(1)
  })

  it("keeps queued audio durable and exposes the original upload failure without blocking text work", async () => {
    const queuedCapture: QueuedVoiceCapture = {
      requestHumanId: "GUEST:GRANT-1",
      clientCaptureId: "queued-audio-1",
      blob: new Blob(["recording"], { type: "audio/webm" }),
      mimeType: "audio/webm",
      durationMs: 1_000,
      createdAt: 1_722_000_000_000,
      metadata: {
        clientAssetId: "queued-audio-1",
        fileName: "queued-audio.webm",
        scopeKind: "batch",
      },
    }
    const queue = voiceQueue()
    await queue.put(queuedCapture)
    const upload = vi.fn().mockRejectedValue(new Error("NETWORK_FAILED"))
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    })
    vi.stubGlobal(
      "MediaRecorder",
      class {
        static isTypeSupported() {
          return true
        }
      }
    )

    const onBlockingStateChange = vi.fn()
    render(
      <GuestEvidencePanel
        onBlockingStateChange={onBlockingStateChange}
        ownerKey="grant-1"
        questions={[]}
        queueFactory={() => queue}
        transport={transport({ upload })}
      />
    )

    expect(await screen.findByText("Voice input needs attention")).toBeTruthy()
    expect(
      screen.getByText(
        "Could not finish voice input (NETWORK_FAILED). Your typed input is safe."
      )
    ).toBeTruthy()
    expect(await queue.list("GUEST:GRANT-1")).toHaveLength(1)
    await waitFor(() =>
      expect(onBlockingStateChange).toHaveBeenLastCalledWith(true)
    )
    expect(
      (
        screen.getByRole("combobox", {
          name: "Attach to",
        }) as HTMLSelectElement
      ).disabled
    ).toBe(false)
  })

  it("renders attributed asset feedback and accessible retry/discard controls", async () => {
    const evidence = transport()
    render(
      <GuestEvidencePanel
        questions={[{ id: "question-1", question: "What happens first?" }]}
        queueFactory={() => voiceQueue()}
        transport={evidence}
      />
    )

    expect(
      await screen.findByText("Please include the permit desk name.")
    ).toBeTruthy()
    expect(
      screen.getByLabelText("Administrator feedback for permit-sequence.txt")
    ).toBeTruthy()
    expect(screen.getByLabelText("Retry permit-sequence.txt")).toBeTruthy()
    expect(screen.getByLabelText("Discard permit-sequence.txt")).toBeTruthy()
    expect(screen.getAllByText(/What happens first\?/).length).toBeGreaterThan(
      0
    )
  })

  it("requires explicit reselection when retry bytes are no longer in memory", async () => {
    const retry = vi
      .fn()
      .mockRejectedValueOnce(new Error("RESELECT_FILE_REQUIRED"))
      .mockResolvedValueOnce(undefined)
    const evidence = transport({ retry })
    render(
      <GuestEvidencePanel
        questions={[{ id: "question-1", question: "What happens first?" }]}
        queueFactory={() => voiceQueue()}
        transport={evidence}
      />
    )

    fireEvent.click(await screen.findByLabelText("Retry permit-sequence.txt"))
    expect(await screen.findByText("RESELECT_FILE_REQUIRED")).toBeTruthy()

    const replacement = new File(["replacement"], "permit-sequence.txt", {
      type: "text/plain",
    })
    fireEvent.change(screen.getByLabelText("Select file again"), {
      target: { files: [replacement] },
    })

    await waitFor(() =>
      expect(retry).toHaveBeenLastCalledWith("asset-failed", replacement, true)
    )
  })

  it("persists recorded bytes before upload and drains them after a reload", async () => {
    const durableQueue = voiceQueue()
    const factory = () => durableQueue
    const track = { stop: vi.fn() }
    installRecorder(
      async () =>
        ({
          getTracks: () => [track],
        }) as unknown as MediaStream
    )
    const failedUpload = Object.assign(new Error("UPLOAD_503"), {
      assetId: "asset-audio-1",
    })
    const firstTransport = transport({
      list: vi.fn().mockResolvedValue([]),
      upload: vi.fn().mockRejectedValue(failedUpload),
    })
    const first = render(
      <GuestEvidencePanel
        ownerKey="grant-durable"
        questions={[{ id: "question-1", question: "What happens first?" }]}
        queueFactory={factory}
        transport={firstTransport}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Press to record" }))
    await screen.findByText("Recording", { exact: true })
    fireEvent.click(screen.getByRole("button", { name: "Stop and save" }))
    await screen.findByText("Voice input needs attention")
    const retained = await durableQueue.list("GUEST:GRANT-DURABLE")
    expect(retained).toHaveLength(1)
    expect(retained[0]).toMatchObject({
      blob: expect.any(Blob),
      metadata: { assetId: "asset-audio-1" },
    })
    first.unmount()

    const retry = vi.fn().mockResolvedValue(undefined)
    render(
      <GuestEvidencePanel
        ownerKey="grant-durable"
        questions={[{ id: "question-1", question: "What happens first?" }]}
        queueFactory={factory}
        transport={transport({
          list: vi.fn().mockResolvedValue([]),
          retry,
        })}
      />
    )
    await waitFor(() =>
      expect(retry).toHaveBeenCalledWith(
        "asset-audio-1",
        expect.any(Blob),
        true
      )
    )
    await waitFor(async () =>
      expect(await durableQueue.list("GUEST:GRANT-DURABLE")).toHaveLength(0)
    )
  })

  it("acknowledges a finalized server asset when a crash left its local recording queued", async () => {
    const durableQueue = voiceQueue()
    const queuedCapture: QueuedVoiceCapture = {
      requestHumanId: "GUEST:GRANT-FINALIZED",
      clientCaptureId: "audio-finalized-before-local-delete",
      blob: new Blob(["already-uploaded"], { type: "audio/webm" }),
      mimeType: "audio/webm",
      durationMs: 1_000,
      createdAt: 1_722_000_000_000,
      metadata: {
        clientAssetId: "audio-finalized-before-local-delete",
        fileName: "already-uploaded.webm",
        scopeKind: "batch",
      },
    }
    await durableQueue.put(queuedCapture)
    const uploadedAsset: GuestResponseAsset = {
      ...failedAsset,
      assetId: "asset-already-uploaded",
      clientAssetId: queuedCapture.clientCaptureId,
      kind: "audio",
      scope: { kind: "batch" },
      fileName: "already-uploaded.webm",
      mimeType: "audio/webm",
      sizeBytes: queuedCapture.blob.size,
      uploadState: "uploaded",
      transcriptionState: "queued",
      failureCode: null,
      retryHistory: [],
      feedback: [],
    }
    const upload = vi.fn()
    const retry = vi.fn()

    render(
      <GuestEvidencePanel
        ownerKey="grant-finalized"
        questions={[]}
        queueFactory={() => durableQueue}
        transport={transport({
          list: vi.fn().mockResolvedValue([uploadedAsset]),
          upload,
          retry,
        })}
      />
    )

    await waitFor(async () =>
      expect(await durableQueue.list("GUEST:GRANT-FINALIZED")).toHaveLength(0)
    )
    expect(upload).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
  })

  it("replays retained bytes against a failed matching server asset after reload", async () => {
    const durableQueue = voiceQueue()
    const queuedCapture: QueuedVoiceCapture = {
      requestHumanId: "GUEST:GRANT-FAILED",
      clientCaptureId: "audio-failed-before-asset-id-save",
      blob: new Blob(["retry-me"], { type: "audio/webm" }),
      mimeType: "audio/webm",
      durationMs: 1_000,
      createdAt: 1_722_000_000_000,
      metadata: {
        clientAssetId: "audio-failed-before-asset-id-save",
        fileName: "retry-me.webm",
        scopeKind: "batch",
      },
    }
    await durableQueue.put(queuedCapture)
    const matchingFailedAsset: GuestResponseAsset = {
      ...failedAsset,
      assetId: "asset-failed-before-local-save",
      clientAssetId: queuedCapture.clientCaptureId,
      kind: "audio",
      scope: { kind: "batch" },
      fileName: "retry-me.webm",
      mimeType: "audio/webm",
      sizeBytes: queuedCapture.blob.size,
      feedback: [],
    }
    const upload = vi.fn()
    const retry = vi.fn().mockResolvedValue(undefined)

    render(
      <GuestEvidencePanel
        ownerKey="grant-failed"
        questions={[]}
        queueFactory={() => durableQueue}
        transport={transport({
          list: vi.fn().mockResolvedValue([matchingFailedAsset]),
          upload,
          retry,
        })}
      />
    )

    await waitFor(() =>
      expect(retry).toHaveBeenCalledWith(
        matchingFailedAsset.assetId,
        expect.any(Blob),
        true
      )
    )
    await waitFor(async () =>
      expect(await durableQueue.list("GUEST:GRANT-FAILED")).toHaveLength(0)
    )
    expect(upload).not.toHaveBeenCalled()
  })

  it("stops a pending microphone stream when editor access is lost", async () => {
    const durableQueue = voiceQueue()
    let resolveStream!: (stream: MediaStream) => void
    const pendingStream = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve
    })
    const constructed = installRecorder(() => pendingStream)
    const evidence = transport({ list: vi.fn().mockResolvedValue([]) })
    const rendered = render(
      <GuestEvidencePanel
        ownerKey="grant-lease-race"
        questions={[{ id: "question-1", question: "What happens first?" }]}
        queueFactory={() => durableQueue}
        transport={evidence}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Press to record" }))
    await screen.findByText("Waiting for microphone access")
    rendered.rerender(
      <GuestEvidencePanel
        disabled
        ownerKey="grant-lease-race"
        questions={[{ id: "question-1", question: "What happens first?" }]}
        queueFactory={() => durableQueue}
        transport={evidence}
      />
    )
    const stop = vi.fn()
    await act(async () => {
      resolveStream({
        getTracks: () => [{ stop }],
      } as unknown as MediaStream)
      await pendingStream
    })
    await waitFor(() => expect(stop).toHaveBeenCalled())
    expect(constructed).not.toHaveBeenCalled()
    expect(evidence.upload).not.toHaveBeenCalled()
  })

  it("rotates a terminal retry operation key so a timed-out upload can recover without reload", async () => {
    const settled = Object.assign(new Error("UPLOAD_SESSION_SETTLED"), {
      data: { code: "UPLOAD_SESSION_SETTLED" },
    })
    const uploadedAsset: GuestResponseAsset = {
      ...failedAsset,
      uploadState: "uploaded",
      failureCode: null,
      version: failedAsset.version + 1,
    }
    serverMocks.list.mockResolvedValue([failedAsset])
    serverMocks.retry.mockRejectedValueOnce(settled).mockResolvedValueOnce({
      asset: failedAsset,
      uploadSessionId: "upload-session-replacement",
      uploadUrl: "/api/e2e/storage-upload",
      uploadRegistrationToken: "registration-capability",
    })
    serverMocks.register.mockResolvedValue(null)
    serverMocks.finalize.mockResolvedValue(uploadedAsset)
    serverMocks.markFailed.mockResolvedValue(failedAsset)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "storage-replacement" }),
      })
    )

    render(
      <GuestEvidenceServerPanel
        leaseGeneration={2}
        leaseId="editor-lease"
        ownerKey="grant-retry-timeout"
        questions={[{ id: "question-1", question: "What happens first?" }]}
        token="guest-token"
      />
    )

    fireEvent.click(await screen.findByLabelText("Retry permit-sequence.txt"))
    const replacementInput = await screen.findByLabelText("Select file again")
    fireEvent.change(replacementInput, {
      target: {
        files: [
          new File(["first retry"], "permit-sequence.txt", {
            type: "text/plain",
          }),
        ],
      },
    })
    expect(await screen.findByText("UPLOAD_SESSION_SETTLED")).toBeTruthy()

    fireEvent.change(replacementInput, {
      target: {
        files: [
          new File(["second retry"], "permit-sequence.txt", {
            type: "text/plain",
          }),
        ],
      },
    })

    await waitFor(() => expect(serverMocks.retry).toHaveBeenCalledTimes(2))
    const firstOperationId =
      serverMocks.retry.mock.calls[0]?.[0].data.operationId
    const secondOperationId =
      serverMocks.retry.mock.calls[1]?.[0].data.operationId
    expect(firstOperationId).toEqual(expect.any(String))
    expect(secondOperationId).toEqual(expect.any(String))
    expect(secondOperationId).not.toBe(firstOperationId)
    await waitFor(() => expect(serverMocks.finalize).toHaveBeenCalledTimes(1))
  })
})
