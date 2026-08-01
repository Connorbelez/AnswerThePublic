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

import type { ExpertInterviewSubmissionSummary } from "@/application/expert-interviews"
import {
  ExpertSynthesisPanel,
  ExpertSynthesisServerPanel,
} from "@/components/expert-synthesis-panel"

const serverPanelMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  invalidate: vi.fn(),
  prepare: vi.fn(),
  setInclusion: vi.fn(),
}))

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: serverPanelMocks.invalidate }),
}))

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (serverFunction: unknown) => serverFunction,
}))

vi.mock("@/application/content-request-server-functions", () => ({
  completeExpertInterviewProcessingInput: serverPanelMocks.complete,
  prepareExpertInterviewProcessingInput: serverPanelMocks.prepare,
  setExpertInterviewSubmissionInclusion: serverPanelMocks.setInclusion,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

function evidence(
  submissionId: string,
  displayName: string,
  state: ExpertInterviewSubmissionSummary["inclusion"]["state"]
): ExpertInterviewSubmissionSummary {
  return {
    submissionId,
    source: "guest",
    requestHumanId: "CR-0241",
    respondent: {
      personId: `person-${submissionId}`,
      displayName,
      email: `${displayName.toLowerCase()}@example.test`,
    },
    workspaceRevision: 2,
    progress: { completed: 1, total: 1 },
    sourceSummary: "1 of 1 answers complete · 0 supporting files",
    inclusion: {
      state,
      decidedBy:
        state === "undecided"
          ? null
          : { principalId: "principal-1", displayName: "Operator" },
      decidedAt: state === "undecided" ? null : 100,
    },
    submittedAt: 50,
  }
}

describe("ExpertSynthesisPanel", () => {
  it("shows every immutable Submission and makes inclusion plus exclusion explicit", () => {
    const onSetInclusion = vi.fn().mockResolvedValue(undefined)
    render(
      <ExpertSynthesisPanel
        disabled={false}
        onSetInclusion={onSetInclusion}
        submissions={[
          evidence("submission-a", "Alex", "undecided"),
          evidence("submission-b", "Blair", "excluded"),
        ]}
      />
    )

    expect(screen.getByText("Alex")).toBeTruthy()
    expect(screen.getByText("Blair")).toBeTruthy()
    expect(screen.getByText("Not decided")).toBeTruthy()
    expect(screen.getByText("Excluded")).toBeTruthy()
    expect(
      screen.getAllByText("1 of 1 answers complete · 0 supporting files")
    ).toHaveLength(2)

    fireEvent.click(
      screen.getByRole("button", {
        name: "Include Alex, revision 2, submission submission-a in synthesis",
      })
    )
    expect(onSetInclusion).toHaveBeenCalledWith("submission-a", true)
    expect(
      screen
        .getByRole("button", {
          name: "Exclude Blair, revision 2, submission submission-b from synthesis",
        })
        .getAttribute("aria-pressed")
    ).toBe("true")
  })

  it("keeps the decision recoverable after a failed save and retries the same choice", async () => {
    const onSetInclusion = vi
      .fn()
      .mockRejectedValueOnce(new Error("Selection save failed"))
      .mockResolvedValueOnce(undefined)
    render(
      <ExpertSynthesisPanel
        onSetInclusion={onSetInclusion}
        submissions={[evidence("submission-a", "Alex", "undecided")]}
      />
    )
    const include = screen.getByRole("button", {
      name: "Include Alex, revision 2, submission submission-a in synthesis",
    })

    fireEvent.click(include)
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Selection save failed"
    )
    expect(include.getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(include)
    await waitFor(() => expect(onSetInclusion).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })

  it("does not prepare while any Submission is still undecided", () => {
    render(
      <ExpertSynthesisPanel
        onPrepare={vi.fn()}
        onSetInclusion={vi.fn()}
        submissions={[
          evidence("submission-a", "Alex", "included"),
          evidence("submission-b", "Blair", "undecided"),
        ]}
      />
    )

    expect(
      screen
        .getByRole("button", { name: "Prepare attributed bundle" })
        .hasAttribute("disabled")
    ).toBe(true)
    expect(
      screen.getByText(
        "Include or exclude every Submission before preparing the bundle."
      )
    ).toBeTruthy()
  })

  it("invalidates a prepared bundle after a successful inclusion change", async () => {
    const processing = {
      request: { humanId: "CR-0241", title: "Delayed closings" },
      payloadDigest: "a".repeat(64),
      processingPayload: {
        request: {
          requestId: "request-1",
          humanId: "CR-0241",
          title: "Delayed closings",
          requestType: "expert_interview",
        },
        selectedSubmissions: [{ submissionId: "submission-a" }],
      },
      processingSnapshot: {
        processingToken: "signed-token",
        submissionIds: ["submission-a"],
        contextVersionIds: ["context-version-1"],
        payloadDigest: "a".repeat(64),
        canonicalBundle: '{"exact":"server-hashed"}',
        issuedAt: 1,
        expiresAt: Date.now() + 60_000,
      },
      prompt: "Grounded synthesis prompt",
    } as never
    const onSetInclusion = vi.fn().mockResolvedValue(undefined)
    render(
      <ExpertSynthesisPanel
        onPrepare={vi.fn().mockResolvedValue(processing)}
        onSetInclusion={onSetInclusion}
        submissions={[evidence("submission-a", "Alex", "included")]}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Prepare attributed bundle" })
    )
    await screen.findByText(`Payload SHA-256: ${"a".repeat(64)}`)

    fireEvent.click(
      screen.getByRole("button", {
        name: "Exclude Alex, revision 2, submission submission-a from synthesis",
      })
    )
    await waitFor(() =>
      expect(onSetInclusion).toHaveBeenCalledWith("submission-a", false)
    )
    await waitFor(() =>
      expect(
        screen.queryByText(`Payload SHA-256: ${"a".repeat(64)}`)
      ).toBeNull()
    )
  })

  it("invalidates a prepared bundle when priority instructions change", async () => {
    const processing = {
      request: { humanId: "CR-0241", title: "Delayed closings" },
      payloadDigest: "a".repeat(64),
      processingSnapshot: {
        processingToken: "signed-token",
        submissionIds: ["submission-a"],
        contextVersionIds: ["context-version-1"],
        payloadDigest: "a".repeat(64),
        canonicalBundle: '{"exact":"server-hashed"}',
        issuedAt: 1,
        expiresAt: Date.now() + 60_000,
      },
      prompt: "Grounded synthesis prompt",
    } as never
    render(
      <ExpertSynthesisPanel
        onPrepare={vi.fn().mockResolvedValue(processing)}
        onSetInclusion={vi.fn()}
        submissions={[evidence("submission-a", "Alex", "included")]}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Prepare attributed bundle" })
    )
    await screen.findByText(`Payload SHA-256: ${"a".repeat(64)}`)
    fireEvent.change(screen.getByLabelText("Priority synthesis instructions"), {
      target: { value: "Use a newly prioritized structure." },
    })

    expect(screen.queryByText(`Payload SHA-256: ${"a".repeat(64)}`)).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Complete synthesis" })
    ).toBeNull()
  })

  it("invalidates a prepared bundle when the external selection signature drifts", async () => {
    const processing = {
      request: { humanId: "CR-0241", title: "Delayed closings" },
      payloadDigest: "a".repeat(64),
      processingSnapshot: {
        processingToken: "signed-token",
        submissionIds: ["submission-a"],
        contextVersionIds: ["context-version-1"],
        payloadDigest: "a".repeat(64),
        canonicalBundle: '{"exact":"server-hashed"}',
        issuedAt: 1,
        expiresAt: Date.now() + 60_000,
      },
      prompt: "Grounded synthesis prompt",
    } as never
    const original = evidence("submission-a", "Alex", "included")
    const view = render(
      <ExpertSynthesisPanel
        onPrepare={vi.fn().mockResolvedValue(processing)}
        onSetInclusion={vi.fn()}
        submissions={[original]}
      />
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare attributed bundle" })
    )
    await screen.findByText(`Payload SHA-256: ${"a".repeat(64)}`)

    view.rerender(
      <ExpertSynthesisPanel
        onPrepare={vi.fn().mockResolvedValue(processing)}
        onSetInclusion={vi.fn()}
        submissions={[
          {
            ...original,
            inclusion: { ...original.inclusion, decidedAt: 101 },
          },
        ]}
      />
    )

    expect(screen.queryByText(`Payload SHA-256: ${"a".repeat(64)}`)).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Complete synthesis" })
    ).toBeNull()
  })

  it("prepares, displays, exports, and completes the shared attributed bundle with an explicit target", async () => {
    const exactCanonicalBundle = '{"exact":"server-hashed"}'
    const processing = {
      request: { humanId: "CR-0241", title: "Delayed closings" },
      payloadDigest: "a".repeat(64),
      processingPayload: {
        request: {
          requestId: "request-1",
          humanId: "CR-0241",
          title: "Delayed closings",
          requestType: "expert_interview",
        },
        selectedSubmissions: [{ submissionId: "submission-a" }],
      },
      processingSnapshot: {
        processingToken: "signed-token",
        submissionIds: ["submission-a"],
        contextVersionIds: ["context-version-1"],
        payloadDigest: "a".repeat(64),
        canonicalBundle: exactCanonicalBundle,
        issuedAt: 1,
        expiresAt: Date.now() + 60_000,
      },
      prompt: "Grounded synthesis prompt",
    } as never
    const onPrepare = vi.fn().mockResolvedValue(processing)
    const onComplete = vi.fn().mockResolvedValue(undefined)
    render(
      <ExpertSynthesisPanel
        deliverables={[
          {
            deliverableId: "deliverable-1",
            requestHumanId: "CR-0241",
            kind: "blog_article",
            name: "Existing article",
            isPrimary: false,
            currentCandidateVersionId: "version-1",
            promotedVersionId: null,
            versions: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        onComplete={onComplete}
        onPrepare={onPrepare}
        onSetInclusion={vi.fn()}
        submissions={[evidence("submission-a", "Alex", "included")]}
      />
    )

    fireEvent.change(screen.getByLabelText("Priority synthesis instructions"), {
      target: { value: "Lead with the recovery sequence." },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare attributed bundle" })
    )
    await screen.findByText(`Payload SHA-256: ${"a".repeat(64)}`)
    expect(onPrepare).toHaveBeenCalledWith(
      ["submission-a"],
      "Lead with the recovery sequence."
    )
    expect(
      screen
        .getByRole("link", { name: "Export attributed bundle" })
        .getAttribute("download")
    ).toBe("CR-0241-expert-synthesis-bundle.json")
    expect(
      decodeURIComponent(
        screen
          .getByRole("link", { name: "Export attributed bundle" })
          .getAttribute("href")!
          .split(",")[1]!
      )
    ).toBe(exactCanonicalBundle)

    fireEvent.change(screen.getByLabelText("Publication-ready Markdown"), {
      target: { value: "# Attributed draft" },
    })
    fireEvent.change(screen.getByLabelText("Deliverable target"), {
      target: { value: "deliverable-1" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Complete synthesis" }))
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        processing,
        body: "# Attributed draft",
        deliverableId: "deliverable-1",
        name: undefined,
      })
    )
    expect(
      await screen.findByText("Synthesis committed with immutable provenance.")
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Complete synthesis" })
    ).toBeNull()
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("expires an active processing bundle without discarding the draft body", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const expiringProcessing = {
      request: { humanId: "CR-0241", title: "Delayed closings" },
      payloadDigest: "a".repeat(64),
      processingPayload: {
        request: {
          requestId: "request-1",
          humanId: "CR-0241",
          title: "Delayed closings",
          requestType: "expert_interview",
        },
        selectedSubmissions: [{ submissionId: "submission-a" }],
      },
      processingSnapshot: {
        processingToken: "signed-expiring-token",
        submissionIds: ["submission-a"],
        contextVersionIds: ["context-version-1"],
        payloadDigest: "a".repeat(64),
        canonicalBundle: '{"snapshot":"expiring"}',
        issuedAt: 1_000,
        expiresAt: 1_100,
      },
      prompt: "Grounded synthesis prompt",
    }
    const onPrepare = vi
      .fn()
      .mockResolvedValueOnce(expiringProcessing)
      .mockResolvedValueOnce({
        ...expiringProcessing,
        processingSnapshot: {
          ...expiringProcessing.processingSnapshot,
          processingToken: "signed-fresh-token",
          expiresAt: 10_000,
        },
      })
    render(
      <ExpertSynthesisPanel
        onComplete={vi.fn()}
        onPrepare={onPrepare}
        onSetInclusion={vi.fn()}
        submissions={[evidence("submission-a", "Alex", "included")]}
      />
    )

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Prepare attributed bundle" })
      )
      await Promise.resolve()
    })
    fireEvent.change(screen.getByLabelText("Publication-ready Markdown"), {
      target: { value: "# Preserved draft" },
    })
    expect(
      screen.getByRole("button", { name: "Complete synthesis" })
    ).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(101)
    })

    expect(
      screen.queryByRole("button", { name: "Complete synthesis" })
    ).toBeNull()
    expect(screen.getByRole("alert").textContent).toContain(
      "processing bundle expired"
    )
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Prepare attributed bundle" })
      )
      await Promise.resolve()
    })
    expect(
      (
        screen.getByLabelText(
          "Publication-ready Markdown"
        ) as HTMLTextAreaElement
      ).value
    ).toBe("# Preserved draft")
  })

  it("clears an invalid processing bundle after completion while preserving the draft body", async () => {
    const invalidProcessing = {
      request: { humanId: "CR-0241", title: "Delayed closings" },
      payloadDigest: "a".repeat(64),
      processingPayload: {
        request: {
          requestId: "request-1",
          humanId: "CR-0241",
          title: "Delayed closings",
          requestType: "expert_interview",
        },
        selectedSubmissions: [{ submissionId: "submission-a" }],
      },
      processingSnapshot: {
        processingToken: "signed-invalid-token",
        submissionIds: ["submission-a"],
        contextVersionIds: ["context-version-1"],
        payloadDigest: "a".repeat(64),
        canonicalBundle: '{"snapshot":"invalid"}',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
      prompt: "Grounded synthesis prompt",
    }
    const onPrepare = vi
      .fn()
      .mockResolvedValueOnce(invalidProcessing)
      .mockResolvedValueOnce({
        ...invalidProcessing,
        processingSnapshot: {
          ...invalidProcessing.processingSnapshot,
          processingToken: "signed-recovered-token",
        },
      })
    const onComplete = vi
      .fn()
      .mockRejectedValue(new Error("INVALID_EXPERT_SYNTHESIS_SNAPSHOT"))
    render(
      <ExpertSynthesisPanel
        onComplete={onComplete}
        onPrepare={onPrepare}
        onSetInclusion={vi.fn()}
        submissions={[evidence("submission-a", "Alex", "included")]}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Prepare attributed bundle" })
    )
    await screen.findByText(`Payload SHA-256: ${"a".repeat(64)}`)
    fireEvent.change(screen.getByLabelText("Publication-ready Markdown"), {
      target: { value: "# Recoverable draft" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Complete synthesis" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "INVALID_EXPERT_SYNTHESIS_SNAPSHOT"
    )

    expect(
      screen.queryByRole("button", { name: "Complete synthesis" })
    ).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare attributed bundle" })
    )
    await screen.findByRole("button", { name: "Complete synthesis" })
    expect(
      (
        screen.getByLabelText(
          "Publication-ready Markdown"
        ) as HTMLTextAreaElement
      ).value
    ).toBe("# Recoverable draft")
  })

  it("preserves an in-flight completion across expiry for one exact retry", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const processing = {
      request: { humanId: "CR-0241", title: "Delayed closings" },
      payloadDigest: "a".repeat(64),
      processingPayload: {
        request: {
          requestId: "request-1",
          humanId: "CR-0241",
          title: "Delayed closings",
          requestType: "expert_interview",
        },
        selectedSubmissions: [{ submissionId: "submission-a" }],
      },
      processingSnapshot: {
        processingToken: "signed-ambiguous-token",
        submissionIds: ["submission-a"],
        contextVersionIds: ["context-version-1"],
        payloadDigest: "a".repeat(64),
        canonicalBundle: '{"snapshot":"ambiguous"}',
        issuedAt: 1_000,
        expiresAt: 1_100,
      },
      prompt: "Grounded synthesis prompt",
    }
    let rejectFirstCompletion: (error: Error) => void = () => undefined
    const firstCompletion = new Promise<never>((_resolve, reject) => {
      rejectFirstCompletion = reject
    })
    const onComplete = vi
      .fn()
      .mockReturnValueOnce(firstCompletion)
      .mockResolvedValueOnce(undefined)
    render(
      <ExpertSynthesisPanel
        onComplete={onComplete}
        onPrepare={vi.fn().mockResolvedValue(processing)}
        onSetInclusion={vi.fn()}
        submissions={[evidence("submission-a", "Alex", "included")]}
      />
    )

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Prepare attributed bundle" })
      )
      await Promise.resolve()
    })
    fireEvent.change(screen.getByLabelText("Publication-ready Markdown"), {
      target: { value: "# Ambiguous draft" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Complete synthesis" }))
    act(() => vi.advanceTimersByTime(101))
    await act(async () => {
      rejectFirstCompletion(new Error("NETWORK_RESPONSE_LOST"))
      await Promise.resolve()
    })

    expect(
      screen.getByRole("button", { name: "Retry exact completion" })
    ).toBeTruthy()
    expect(
      (
        screen.getByLabelText(
          "Publication-ready Markdown"
        ) as HTMLTextAreaElement
      ).value
    ).toBe("# Ambiguous draft")
    expect(
      (
        screen.getByLabelText(
          "Publication-ready Markdown"
        ) as HTMLTextAreaElement
      ).disabled
    ).toBe(true)

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Retry exact completion" })
      )
      await Promise.resolve()
    })
    expect(
      screen.getByText("Synthesis committed with immutable provenance.")
    ).toBeTruthy()
    expect(onComplete).toHaveBeenCalledTimes(2)
    expect(onComplete.mock.calls[1]).toEqual(onComplete.mock.calls[0])
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("rotates a stale preparation attempt while retaining the founder job lease for the corrected completion", async () => {
    const processing = (snapshotId: string, digestCharacter: string) =>
      ({
        request: { humanId: "CR-0241", title: "Delayed closings" },
        payloadDigest: digestCharacter.repeat(64),
        processingPayload: {
          request: {
            requestId: "request-1",
            humanId: "CR-0241",
            title: "Delayed closings",
            requestType: "expert_interview",
          },
          selectedSubmissions: [{ submissionId: "submission-a" }],
        },
        processingSnapshot: {
          snapshotId,
          processingToken: `signed-${snapshotId}`,
          submissionIds: ["submission-a"],
          contextVersionIds: ["context-version-1"],
          payloadDigest: digestCharacter.repeat(64),
          canonicalBundle: `{"snapshot":"${snapshotId}"}`,
          issuedAt: 1,
          expiresAt: Date.now() + 60_000,
        },
        prompt: `Grounded synthesis prompt for ${snapshotId}`,
      }) as never
    serverPanelMocks.prepare
      .mockResolvedValueOnce(processing("snapshot-stale", "a"))
      .mockResolvedValueOnce(processing("snapshot-current", "b"))
    serverPanelMocks.complete
      .mockRejectedValueOnce(
        new Error("EXPERT_SYNTHESIS_SNAPSHOT_STALE: prepare again")
      )
      .mockResolvedValueOnce({ provenance: { versionId: "version-2" } })
    serverPanelMocks.setInclusion.mockResolvedValue(undefined)

    render(
      <ExpertSynthesisServerPanel
        deliverables={[]}
        humanId="CR-0241"
        submissions={[evidence("submission-a", "Alex", "included")]}
      />
    )

    const prepareButton = screen.getByRole("button", {
      name: "Prepare attributed bundle",
    })
    fireEvent.click(prepareButton)
    await screen.findByText(`Payload SHA-256: ${"a".repeat(64)}`)
    fireEvent.change(screen.getByLabelText("Publication-ready Markdown"), {
      target: { value: "# Correctable draft" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Complete synthesis" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "EXPERT_SYNTHESIS_SNAPSHOT_STALE"
    )

    fireEvent.click(prepareButton)
    await screen.findByText(`Payload SHA-256: ${"b".repeat(64)}`)
    fireEvent.click(screen.getByRole("button", { name: "Complete synthesis" }))
    await screen.findByText("Synthesis committed with immutable provenance.")

    const firstPreparation = serverPanelMocks.prepare.mock.calls[0]![0].data
    const secondPreparation = serverPanelMocks.prepare.mock.calls[1]![0].data
    expect(secondPreparation.correlationId).not.toBe(
      firstPreparation.correlationId
    )
    const firstCompletion = serverPanelMocks.complete.mock.calls[0]![0].data
    const secondCompletion = serverPanelMocks.complete.mock.calls[1]![0].data
    expect(secondCompletion.correlationId).not.toBe(
      firstCompletion.correlationId
    )
    expect(secondCompletion.jobLeaseToken).toBe(firstCompletion.jobLeaseToken)
    expect(serverPanelMocks.invalidate).toHaveBeenCalledTimes(1)
  })

  it("rotates preparation identity after an authoritative inclusion round-trip", async () => {
    const processing = (snapshotId: string) =>
      ({
        request: { humanId: "CR-0241", title: "Delayed closings" },
        payloadDigest: "a".repeat(64),
        processingPayload: {
          request: {
            requestId: "request-1",
            humanId: "CR-0241",
            title: "Delayed closings",
            requestType: "expert_interview",
          },
          selectedSubmissions: [{ submissionId: "submission-a" }],
        },
        processingSnapshot: {
          snapshotId,
          processingToken: `signed-${snapshotId}`,
          submissionIds: ["submission-a"],
          contextVersionIds: ["context-version-1"],
          payloadDigest: "a".repeat(64),
          canonicalBundle: `{"snapshot":"${snapshotId}"}`,
          issuedAt: 1,
          expiresAt: Date.now() + 60_000,
        },
        prompt: `Grounded synthesis prompt for ${snapshotId}`,
      }) as never
    serverPanelMocks.prepare
      .mockResolvedValueOnce(processing("snapshot-before-decisions"))
      .mockResolvedValueOnce(processing("snapshot-after-decisions"))
    serverPanelMocks.setInclusion.mockResolvedValue(undefined)

    const view = render(
      <ExpertSynthesisServerPanel
        deliverables={[]}
        humanId="CR-0241"
        submissions={[evidence("submission-a", "Alex", "included")]}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Prepare attributed bundle" })
    )
    await screen.findByText(`Payload SHA-256: ${"a".repeat(64)}`)
    fireEvent.click(
      screen.getByRole("button", {
        name: "Exclude Alex, revision 2, submission submission-a from synthesis",
      })
    )
    await waitFor(() =>
      expect(serverPanelMocks.setInclusion).toHaveBeenCalledTimes(1)
    )
    view.rerender(
      <ExpertSynthesisServerPanel
        deliverables={[]}
        humanId="CR-0241"
        submissions={[evidence("submission-a", "Alex", "excluded")]}
      />
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: "Include Alex, revision 2, submission submission-a in synthesis",
      })
    )
    await waitFor(() =>
      expect(serverPanelMocks.setInclusion).toHaveBeenCalledTimes(2)
    )
    view.rerender(
      <ExpertSynthesisServerPanel
        deliverables={[]}
        humanId="CR-0241"
        submissions={[evidence("submission-a", "Alex", "included")]}
      />
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare attributed bundle" })
    )
    await waitFor(() =>
      expect(serverPanelMocks.prepare).toHaveBeenCalledTimes(2)
    )

    const firstPreparation = serverPanelMocks.prepare.mock.calls[0]![0].data
    const secondPreparation = serverPanelMocks.prepare.mock.calls[1]![0].data
    expect(secondPreparation.correlationId).not.toBe(
      firstPreparation.correlationId
    )
  })

  it("rotates preparation identity after a deterministic idempotency rejection", async () => {
    serverPanelMocks.prepare
      .mockRejectedValueOnce(new Error("IDEMPOTENCY_KEY_REUSED"))
      .mockResolvedValueOnce({
        request: { humanId: "CR-0241", title: "Delayed closings" },
        payloadDigest: "a".repeat(64),
        processingPayload: {
          request: {
            requestId: "request-1",
            humanId: "CR-0241",
            title: "Delayed closings",
            requestType: "expert_interview",
          },
          selectedSubmissions: [{ submissionId: "submission-a" }],
        },
        processingSnapshot: {
          snapshotId: "snapshot-recovered",
          processingToken: "signed-snapshot-recovered",
          submissionIds: ["submission-a"],
          contextVersionIds: ["context-version-1"],
          payloadDigest: "a".repeat(64),
          canonicalBundle: '{"snapshot":"snapshot-recovered"}',
          issuedAt: 1,
          expiresAt: Date.now() + 60_000,
        },
        prompt: "Grounded synthesis prompt",
      })
    serverPanelMocks.setInclusion.mockResolvedValue(undefined)

    render(
      <ExpertSynthesisServerPanel
        deliverables={[]}
        humanId="CR-0241"
        submissions={[evidence("submission-a", "Alex", "included")]}
      />
    )

    const prepareButton = screen.getByRole("button", {
      name: "Prepare attributed bundle",
    })
    fireEvent.click(prepareButton)
    expect((await screen.findByRole("alert")).textContent).toContain(
      "IDEMPOTENCY_KEY_REUSED"
    )
    fireEvent.click(prepareButton)
    await waitFor(() =>
      expect(serverPanelMocks.prepare).toHaveBeenCalledTimes(2)
    )

    const firstPreparation = serverPanelMocks.prepare.mock.calls[0]![0].data
    const secondPreparation = serverPanelMocks.prepare.mock.calls[1]![0].data
    expect(secondPreparation.correlationId).not.toBe(
      firstPreparation.correlationId
    )
  })
})
