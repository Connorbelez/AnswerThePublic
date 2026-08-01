// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { GuestResponseAdminView } from "@/application/content-requests"
import {
  GuestResponseAdminPanel,
  GuestResponseAdminServerPanel,
} from "@/components/guest-response-admin-panel"

const mocks = vi.hoisted(() => ({
  addAssetFeedback: vi.fn(),
  addFeedback: vi.fn(),
  invalidate: vi.fn(),
  reopenWorkspace: vi.fn(),
}))

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
}))

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (serverFn: symbol) => {
    if (serverFn.description === "addGuestResponseFeedback")
      return mocks.addFeedback
    if (serverFn.description === "addGuestResponseAssetFeedback")
      return mocks.addAssetFeedback
    return mocks.reopenWorkspace
  },
}))

vi.mock("@/application/content-request-server-functions", () => ({
  addGuestResponseAssetFeedback: Symbol("addGuestResponseAssetFeedback"),
  addGuestResponseFeedback: Symbol("addGuestResponseFeedback"),
  reopenGuestResponseWorkspace: Symbol("reopenGuestResponseWorkspace"),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const view: GuestResponseAdminView = {
  grantId: "grant-priya",
  requestHumanId: "CR-0241",
  assignedPerson: { displayName: "Priya Shah" },
  readOnly: true,
  questions: [
    {
      questionId: "question-1",
      question: "What happens first?",
      motivation: "Generic sources omit the operational sequence.",
    },
  ],
  workspace: {
    answerMode: "one_by_one",
    batchText: "The retained batch response.",
    questionAnswers: [
      { questionId: "question-1", text: "Permitting starts first." },
    ],
    progress: { completed: 1, total: 1 },
    revision: 4,
    editorLease: { active: false, generation: 2, expiresAt: null },
    locked: true,
    lockedAt: 1_722_000_000_000,
    feedback: [],
  },
  submissions: [
    {
      submissionId: "submission-1",
      requestHumanId: "CR-0241",
      respondent: {
        personId: "person-priya",
        displayName: "Priya Shah",
        email: "priya@example.ca",
      },
      workspaceRevision: 4,
      answerMode: "one_by_one",
      batchText: "The immutable batch snapshot.",
      questionAnswers: [
        {
          questionId: "question-1",
          text: "The immutable per-question snapshot.",
        },
      ],
      questions: [
        {
          questionId: "question-1",
          question: "What happens first?",
          motivation: "Generic sources omit the operational sequence.",
          position: 0,
          version: 1,
        },
      ],
      assetSnapshots: [
        {
          assetId: "asset-audio-1",
          version: 2,
          transcriptVersion: 1,
          kind: "audio",
          scope: { kind: "question", questionId: "question-1" },
        },
      ],
      submittedAt: 1_722_000_000_000,
    },
  ],
  assets: [
    {
      asset: {
        assetId: "asset-audio-1",
        clientAssetId: "browser-audio-1",
        kind: "audio",
        scope: { kind: "question", questionId: "question-1" },
        fileName: "municipal-sequence.webm",
        mimeType: "audio/webm",
        sizeBytes: 2_048,
        uploadState: "uploaded",
        transcriptionState: "transcribed",
        transcript: "Call the municipal planner before filing.",
        transcriptVersion: 1,
        transcriptionLeaseExpiresAt: null,
        failureCode: null,
        retryHistory: [],
        version: 2,
        submittedAt: 1_722_000_000_000,
        discardedAt: null,
        downloadUrl: "https://files.example.test/municipal-sequence.webm",
        feedback: [],
        createdAt: 1_721_999_000_000,
        updatedAt: 1_722_000_000_000,
      },
      feedback: [
        {
          feedbackId: "asset-feedback-1",
          assetId: "asset-audio-1",
          body: "Please name the permit desk.",
          author: { principalId: "principal-1", displayName: "Operator" },
          createdAt: 1_722_000_100_000,
        },
      ],
    },
  ],
}

describe("GuestResponseAdminPanel", () => {
  it("shows provisional progress and approved question copy without exposing editable respondent text", () => {
    const provisionalView: GuestResponseAdminView = {
      ...view,
      workspace: {
        ...view.workspace,
        batchText: "",
        locked: false,
        lockedAt: null,
      },
      submissions: [],
    }

    render(
      <GuestResponseAdminPanel
        onAddFeedback={vi.fn()}
        onReopen={vi.fn()}
        views={[provisionalView]}
      />
    )

    expect(screen.getByText("1 of 1 answered")).toBeTruthy()
    expect(screen.getAllByText("What happens first?").length).toBeGreaterThan(0)
    expect(screen.getByText("Permitting starts first.")).toBeTruthy()
    expect(screen.queryByDisplayValue("Permitting starts first.")).toBeNull()
  })

  it("gives repeated question landmarks respondent-specific accessible names", () => {
    const noahView: GuestResponseAdminView = {
      ...view,
      grantId: "grant-noah",
      assignedPerson: { displayName: "Noah Williams" },
    }

    render(
      <GuestResponseAdminPanel
        onAddFeedback={vi.fn()}
        onReopen={vi.fn()}
        views={[view, noahView]}
      />
    )

    expect(
      screen.getByRole("region", {
        name: "Priya Shah: What happens first?",
      })
    ).toBeTruthy()
    expect(
      screen.getByRole("region", {
        name: "Noah Williams: What happens first?",
      })
    ).toBeTruthy()
  })

  it("keeps respondent evidence read-only and wires targeted feedback and reopening", async () => {
    const onAddFeedback = vi.fn().mockResolvedValue({
      feedbackId: "feedback-1",
      scope: { kind: "question", questionId: "question-1" },
      body: "Please add the municipal checkpoint.",
      author: { principalId: "principal-1", displayName: "Operator" },
      createdAt: 1_722_000_100_000,
    })
    const onReopen = vi.fn().mockResolvedValue({
      locked: false,
      lockedAt: null,
      revision: 5,
    })

    render(
      <GuestResponseAdminPanel
        onAddFeedback={onAddFeedback}
        onReopen={onReopen}
        views={[view]}
      />
    )

    expect(screen.getByText("The retained batch response.")).toBeTruthy()
    expect(screen.getByText("Permitting starts first.")).toBeTruthy()
    expect(screen.getByText("The immutable batch snapshot.")).toBeTruthy()
    expect(
      screen.getByText("The immutable per-question snapshot.")
    ).toBeTruthy()
    expect(screen.getByText(/asset version 2/)).toBeTruthy()
    expect(screen.getByText(/transcript version 1/)).toBeTruthy()
    expect(screen.queryByDisplayValue("Permitting starts first.")).toBeNull()
    expect(
      screen.getByText("Revision 4 submitted by Priya Shah", { exact: false })
    ).toBeTruthy()
    expect(screen.getByText("municipal-sequence.webm")).toBeTruthy()
    expect(
      document.getElementById("guest-access-grant-priya-asset-asset-audio-1")
    ).toBeTruthy()
    expect(
      screen.getByText("Call the municipal planner before filing.")
    ).toBeTruthy()
    expect(screen.getByText("Please name the permit desk.")).toBeTruthy()
    expect(
      screen.getByRole<HTMLAnchorElement>("link", {
        name: "Open evidence file",
      }).href
    ).toBe("https://files.example.test/municipal-sequence.webm")
    expect(
      screen.queryByDisplayValue("Call the municipal planner before filing.")
    ).toBeNull()

    fireEvent.change(screen.getByLabelText("Feedback target"), {
      target: { value: "question-1" },
    })
    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "Please add the municipal checkpoint." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add feedback" }))

    await waitFor(() =>
      expect(onAddFeedback).toHaveBeenCalledWith({
        grantId: "grant-priya",
        scope: { kind: "question", questionId: "question-1" },
        body: "Please add the municipal checkpoint.",
      })
    )

    fireEvent.click(screen.getByRole("button", { name: "Reopen response" }))
    await waitFor(() => expect(onReopen).toHaveBeenCalledWith("grant-priya"))
  })

  it("routes asset feedback through the asset-specific mutation", async () => {
    mocks.addAssetFeedback.mockResolvedValue({
      feedbackId: "asset-feedback-2",
      assetId: "asset-audio-1",
      body: "Confirm the office name.",
      author: { principalId: "principal-1", displayName: "Operator" },
      createdAt: 1_722_000_200_000,
    })
    mocks.invalidate.mockResolvedValue(undefined)

    render(<GuestResponseAdminServerPanel views={[view]} />)

    fireEvent.change(screen.getByLabelText("Feedback target"), {
      target: { value: "asset:asset-audio-1" },
    })
    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "Confirm the office name." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add feedback" }))

    await waitFor(() =>
      expect(mocks.addAssetFeedback).toHaveBeenCalledWith({
        data: {
          grantId: "grant-priya",
          assetId: "asset-audio-1",
          body: "Confirm the office name.",
          correlationId: expect.any(String),
        },
      })
    )
    expect(mocks.addFeedback).not.toHaveBeenCalled()
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)
  })

  it("disables administrator mutations for an inactive request", () => {
    render(
      <GuestResponseAdminPanel
        disabled
        onAddFeedback={vi.fn()}
        onReopen={vi.fn()}
        views={[view]}
      />
    )

    expect(
      (
        screen.getByRole("button", {
          name: "Add feedback",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (
        screen.getByRole("button", {
          name: "Reopen response",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })

  it("reuses feedback and reopen correlation IDs after ambiguous failures", async () => {
    mocks.addFeedback
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({
        feedbackId: "feedback-1",
        scope: { kind: "workspace" },
        body: "Please add the municipal checkpoint.",
        author: { principalId: "principal-1", displayName: "Operator" },
        createdAt: 1_722_000_100_000,
      })
    mocks.reopenWorkspace
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({
        locked: false,
        lockedAt: null,
        revision: 5,
      })
    mocks.invalidate.mockResolvedValue(undefined)

    render(<GuestResponseAdminServerPanel views={[view]} />)
    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "Please add the municipal checkpoint." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add feedback" }))
    await waitFor(() => expect(mocks.addFeedback).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: "Add feedback" }))
    await waitFor(() => expect(mocks.addFeedback).toHaveBeenCalledTimes(2))

    expect(mocks.addFeedback.mock.calls[1]?.[0].data.correlationId).toBe(
      mocks.addFeedback.mock.calls[0]?.[0].data.correlationId
    )

    fireEvent.click(screen.getByRole("button", { name: "Reopen response" }))
    await waitFor(() => expect(mocks.reopenWorkspace).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: "Reopen response" }))
    await waitFor(() => expect(mocks.reopenWorkspace).toHaveBeenCalledTimes(2))

    expect(mocks.reopenWorkspace.mock.calls[1]?.[0].data.correlationId).toBe(
      mocks.reopenWorkspace.mock.calls[0]?.[0].data.correlationId
    )
  })
})
