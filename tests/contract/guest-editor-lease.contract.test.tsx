// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  heartbeat: vi.fn(),
  save: vi.fn(),
  submit: vi.fn(),
  takeover: vi.fn(),
}))

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (serverFn: unknown) => serverFn,
}))

vi.mock("@/application/content-request-server-functions", () => ({
  acquireGuestEditorLease: mocks.acquire,
  heartbeatGuestEditorLease: mocks.heartbeat,
  saveGuestResponseWorkspace: mocks.save,
  submitGuestResponseWorkspace: mocks.submit,
  takeoverGuestEditorLease: mocks.takeover,
}))

vi.mock("@/components/guest-evidence-panel", () => ({
  GuestEvidenceServerPanel: () => null,
}))

import { GuestResponseComposer } from "@/components/guest-response-composer"

const workspace = {
  answerMode: "one_by_one" as const,
  batchText: "",
  questionAnswers: [{ questionId: "question-1", text: "" }],
  progress: { completed: 0, total: 1 },
  revision: 0,
  editorLease: { active: false, generation: 0, expiresAt: null },
}

const questions = [
  {
    id: "question-1",
    question: "What happens first?",
    motivation: "Generic sources omit the operational sequence.",
  },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe("GuestResponseComposer editor lease", () => {
  it("acquires an editor lease before enabling respondent mutations", async () => {
    mocks.acquire.mockResolvedValue({
      status: "editing",
      editorLease: {
        active: true,
        generation: 1,
        expiresAt: Date.now() + 45_000,
      },
    })

    render(
      <GuestResponseComposer
        initialWorkspace={workspace}
        questions={questions}
        token="guest-token"
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "1. What happens first?" })
    )
    const answer = screen.getByRole("textbox", { name: "Your answer" })
    expect((answer as HTMLTextAreaElement).disabled).toBe(true)
    await waitFor(() =>
      expect((answer as HTMLTextAreaElement).disabled).toBe(false)
    )
    expect(mocks.acquire).toHaveBeenCalledWith({
      data: {
        token: "guest-token",
        leaseId: expect.any(String),
        operationId: expect.any(String),
      },
    })
    expect(screen.getByText("Editing on this device")).toBeTruthy()
  })

  it("shows a second device read-only until explicit takeover succeeds", async () => {
    mocks.acquire.mockResolvedValue({
      status: "conflict",
      editorLease: {
        active: true,
        generation: 4,
        expiresAt: Date.now() + 30_000,
      },
    })
    mocks.takeover.mockResolvedValue({
      status: "editing",
      editorLease: {
        active: true,
        generation: 5,
        expiresAt: Date.now() + 45_000,
      },
    })

    render(
      <GuestResponseComposer
        initialWorkspace={{
          ...workspace,
          editorLease: {
            active: true,
            generation: 4,
            expiresAt: Date.now() + 30_000,
          },
        }}
        questions={questions}
        token="guest-token"
      />
    )

    expect(
      await screen.findByText("This response is active on another device")
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "1. What happens first?" })
    )
    const answer = screen.getByRole("textbox", { name: "Your answer" })
    expect((answer as HTMLTextAreaElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Take over editing" }))

    await waitFor(() =>
      expect((answer as HTMLTextAreaElement).disabled).toBe(false)
    )
    expect(mocks.takeover).toHaveBeenCalledWith({
      data: {
        token: "guest-token",
        leaseId: expect.any(String),
        expectedGeneration: 4,
        operationId: expect.any(String),
      },
    })
    expect(screen.queryByText(/active on another device/i)).toBeNull()
    expect(screen.getByText("Editing on this device")).toBeTruthy()
  })
})
