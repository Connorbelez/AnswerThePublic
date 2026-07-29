// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  GuestResponseWorkspace,
  SaveGuestResponseWorkspaceResult,
} from "@/application/content-requests"

const mocks = vi.hoisted(() => ({
  acquireGuestEditorLease: vi.fn(),
  heartbeatGuestEditorLease: vi.fn(),
  saveGuestResponseWorkspace: vi.fn(),
  submitGuestResponseWorkspace: vi.fn(),
  takeoverGuestEditorLease: vi.fn(),
}))

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (serverFn: symbol) => {
    if (serverFn.description === "acquireGuestEditorLease")
      return mocks.acquireGuestEditorLease
    if (serverFn.description === "heartbeatGuestEditorLease")
      return mocks.heartbeatGuestEditorLease
    if (serverFn.description === "submitGuestResponseWorkspace")
      return mocks.submitGuestResponseWorkspace
    if (serverFn.description === "takeoverGuestEditorLease")
      return mocks.takeoverGuestEditorLease
    return mocks.saveGuestResponseWorkspace
  },
}))

vi.mock("@/application/content-request-server-functions", () => ({
  acquireGuestEditorLease: Symbol("acquireGuestEditorLease"),
  heartbeatGuestEditorLease: Symbol("heartbeatGuestEditorLease"),
  saveGuestResponseWorkspace: Symbol("saveGuestResponseWorkspace"),
  submitGuestResponseWorkspace: Symbol("submitGuestResponseWorkspace"),
  takeoverGuestEditorLease: Symbol("takeoverGuestEditorLease"),
}))

vi.mock("@/components/guest-evidence-panel", () => ({
  GuestEvidenceServerPanel: () => null,
}))

import { GuestResponseComposer } from "@/components/guest-response-composer"

const initialWorkspace: GuestResponseWorkspace = {
  answerMode: "batch",
  batchText: "",
  questionAnswers: [{ questionId: "question-1", text: "" }],
  progress: { completed: 0, total: 1 },
  revision: 0,
  editorLease: {
    active: true,
    generation: 1,
    expiresAt: Date.now() + 45_000,
  },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function savedWorkspace(
  batchText: string,
  revision: number
): SaveGuestResponseWorkspaceResult {
  return {
    status: "saved",
    workspace: {
      ...initialWorkspace,
      batchText,
      progress: { completed: batchText ? 1 : 0, total: 1 },
      revision,
    },
  }
}

function renderComposer() {
  return render(
    <GuestResponseComposer
      token="guest-token"
      initialWorkspace={initialWorkspace}
      questions={[
        {
          id: "question-1",
          question: "What actually happens?",
          motivation: "The answer needs practitioner evidence.",
        },
      ]}
    />
  )
}

function renderTwoQuestionComposer(workspace: GuestResponseWorkspace) {
  return render(
    <GuestResponseComposer
      token="guest-token"
      initialWorkspace={workspace}
      questions={[
        {
          id: "question-1",
          question: "What happens first?",
          motivation: "Readers need the operational sequence.",
        },
        {
          id: "question-2",
          question: "Which warning sign matters?",
          motivation: "Readers need a transferable decision rule.",
        },
      ]}
    />
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.acquireGuestEditorLease.mockReset()
  mocks.acquireGuestEditorLease.mockResolvedValue({
    status: "editing",
    editorLease: initialWorkspace.editorLease,
  })
  mocks.heartbeatGuestEditorLease.mockReset()
  mocks.heartbeatGuestEditorLease.mockResolvedValue({
    status: "editing",
    editorLease: initialWorkspace.editorLease,
  })
  mocks.saveGuestResponseWorkspace.mockReset()
  mocks.submitGuestResponseWorkspace.mockReset()
  mocks.takeoverGuestEditorLease.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("GuestResponseComposer autosave", () => {
  it("keeps the server render independent from the client draft journal", () => {
    const serverWorkspace = savedWorkspace(
      "Server-rendered draft.",
      1
    ).workspace
    globalThis.sessionStorage.setItem(
      "fairlend-guest-response-draft:grant-hydration-safe",
      JSON.stringify({
        baseRevision: 1,
        answerMode: "batch",
        batchText: "Client-only recovered draft.",
        questionAnswers: [{ questionId: "question-1", text: "" }],
      })
    )

    const html = renderToString(
      <GuestResponseComposer
        grantId="grant-hydration-safe"
        initialWorkspace={serverWorkspace}
        questions={[
          {
            id: "question-1",
            question: "What actually happens?",
            motivation: "The answer needs practitioner evidence.",
          },
        ]}
        token="guest-token"
      />
    )

    expect(html).toContain("Server-rendered draft.")
    expect(html).not.toContain("Client-only recovered draft.")
    expect(html).toContain('data-draft-ready="false"')
    expect(html).toContain("Saving…")
    expect(html).not.toContain(">Saved<")
  })

  it("updates progress optimistically before the debounced save completes", async () => {
    renderComposer()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.change(
      screen.getByRole("textbox", { name: "Your complete response" }),
      { target: { value: "The first call is to the closing lawyer." } }
    )

    expect(screen.getByText("1 of 1 answered")).toBeTruthy()
    expect(mocks.saveGuestResponseWorkspace).not.toHaveBeenCalled()
  })

  it("keeps mode drafts independent and starts one-at-a-time questions collapsed", async () => {
    renderTwoQuestionComposer({
      ...initialWorkspace,
      answerMode: "one_by_one",
      batchText: "A retained batch response.",
      questionAnswers: [
        { questionId: "question-1", text: "Call the lawyer first." },
        { questionId: "question-2", text: "" },
      ],
      progress: { completed: 1, total: 2 },
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const firstQuestion = screen.getByRole("button", {
      name: "1. What happens first?",
    })
    const secondQuestion = screen.getByRole("button", {
      name: "2. Which warning sign matters?",
    })
    expect(firstQuestion.getAttribute("aria-expanded")).toBe("false")
    expect(secondQuestion.getAttribute("aria-expanded")).toBe("false")

    fireEvent.click(secondQuestion)
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
      target: { value: "Watch for an unconfirmed payout statement." },
    })
    expect(screen.getByText("2 of 2 answered")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Answer all at once" }))
    const batchResponse = screen.getByRole("textbox", {
      name: "Your complete response",
    })
    expect((batchResponse as HTMLTextAreaElement).value).toBe(
      "A retained batch response."
    )
    fireEvent.change(batchResponse, {
      target: { value: "A revised independent batch response." },
    })

    fireEvent.click(
      screen.getByRole("button", { name: "Answer one at a time" })
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: "2. Which warning sign matters?",
      })
    )
    expect(
      (
        screen.getByRole("textbox", {
          name: "Your answer",
        }) as HTMLTextAreaElement
      ).value
    ).toBe("Watch for an unconfirmed payout statement.")
  })

  it("flushes the current draft when the page is hidden before the debounce expires", async () => {
    mocks.saveGuestResponseWorkspace.mockResolvedValue(
      savedWorkspace("A navigation-safe response.", 1)
    )
    renderComposer()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.change(
      screen.getByRole("textbox", { name: "Your complete response" }),
      { target: { value: "A navigation-safe response." } }
    )

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"))
      await Promise.resolve()
    })

    expect(mocks.saveGuestResponseWorkspace).toHaveBeenCalledWith({
      data: expect.objectContaining({
        batchText: "A navigation-safe response.",
        expectedRevision: 0,
      }),
    })
  })

  it("restores a grant-scoped draft journal after an immediate unmount", async () => {
    const firstRender = render(
      <GuestResponseComposer
        grantId="grant-navigation-safe"
        initialWorkspace={initialWorkspace}
        questions={[
          {
            id: "question-1",
            question: "What actually happens?",
            motivation: "The answer needs practitioner evidence.",
          },
        ]}
        token="guest-token"
      />
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.change(
      screen.getByRole("textbox", { name: "Your complete response" }),
      { target: { value: "A journaled response." } }
    )
    firstRender.unmount()

    render(
      <GuestResponseComposer
        grantId="grant-navigation-safe"
        initialWorkspace={initialWorkspace}
        questions={[
          {
            id: "question-1",
            question: "What actually happens?",
            motivation: "The answer needs practitioner evidence.",
          },
        ]}
        token="guest-token"
      />
    )
    expect(
      (
        screen.getByRole("textbox", {
          name: "Your complete response",
        }) as HTMLTextAreaElement
      ).value
    ).toBe("A journaled response.")
  })

  it("journals newer typing when navigation happens during an in-flight save", async () => {
    const inFlightSave = deferred<SaveGuestResponseWorkspaceResult>()
    mocks.saveGuestResponseWorkspace.mockReturnValue(inFlightSave.promise)
    const firstRender = render(
      <GuestResponseComposer
        grantId="grant-in-flight-navigation"
        initialWorkspace={initialWorkspace}
        questions={[
          {
            id: "question-1",
            question: "What actually happens?",
            motivation: "The answer needs practitioner evidence.",
          },
        ]}
        token="guest-token"
      />
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const response = screen.getByRole("textbox", {
      name: "Your complete response",
    })
    fireEvent.change(response, { target: { value: "Saving draft." } })
    await act(() => vi.advanceTimersByTimeAsync(650))
    fireEvent.change(response, {
      target: { value: "Newer typing before navigation." },
    })
    firstRender.unmount()
    const olderCommittedWorkspace = savedWorkspace("Saving draft.", 1).workspace
    await act(async () => {
      inFlightSave.resolve({
        status: "saved",
        workspace: olderCommittedWorkspace,
      })
      await Promise.resolve()
    })

    const recoveryRender = render(
      <GuestResponseComposer
        grantId="grant-in-flight-navigation"
        initialWorkspace={olderCommittedWorkspace}
        questions={[
          {
            id: "question-1",
            question: "What actually happens?",
            motivation: "The answer needs practitioner evidence.",
          },
        ]}
        token="guest-token"
      />
    )
    expect(
      (
        screen.getByRole("textbox", {
          name: "Your complete response",
        }) as HTMLTextAreaElement
      ).value
    ).toBe("Newer typing before navigation.")
    expect(
      screen.getByText("Your draft needs a conflict check", { exact: true })
    ).toBeTruthy()
    expect(mocks.saveGuestResponseWorkspace).toHaveBeenCalledTimes(1)

    recoveryRender.unmount()
    render(
      <GuestResponseComposer
        grantId="grant-in-flight-navigation"
        initialWorkspace={olderCommittedWorkspace}
        questions={[
          {
            id: "question-1",
            question: "What actually happens?",
            motivation: "The answer needs practitioner evidence.",
          },
        ]}
        token="guest-token"
      />
    )
    expect(
      (
        screen.getByRole("textbox", {
          name: "Your complete response",
        }) as HTMLTextAreaElement
      ).value
    ).toBe("Newer typing before navigation.")
    expect(
      screen.getByText("Your draft needs a conflict check", { exact: true })
    ).toBeTruthy()
    expect(mocks.saveGuestResponseWorkspace).toHaveBeenCalledTimes(1)
  })

  it("retains a conflicting local draft for explicit recovery on the latest revision", async () => {
    const staleSave = deferred<SaveGuestResponseWorkspaceResult>()
    mocks.saveGuestResponseWorkspace
      .mockReturnValueOnce(staleSave.promise)
      .mockResolvedValueOnce(savedWorkspace("Newer local typing.", 5))
    renderComposer()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const response = screen.getByRole("textbox", {
      name: "Your complete response",
    })
    fireEvent.change(response, { target: { value: "Initial local draft." } })
    await act(() => vi.advanceTimersByTimeAsync(650))
    fireEvent.change(response, { target: { value: "Newer local typing." } })

    await act(async () => {
      staleSave.resolve({
        status: "conflict",
        workspace: {
          ...initialWorkspace,
          batchText: "Saved by another editor.",
          progress: { completed: 1, total: 1 },
          revision: 4,
        },
      })
      await staleSave.promise
    })

    expect((response as HTMLTextAreaElement).value).toBe("Newer local typing.")
    expect(
      screen.getByRole("button", { name: "Save recovered draft" })
    ).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(650))
    expect(mocks.saveGuestResponseWorkspace).toHaveBeenCalledTimes(1)

    fireEvent.click(
      screen.getByRole("button", { name: "Save recovered draft" })
    )
    expect(mocks.saveGuestResponseWorkspace).toHaveBeenCalledTimes(2)
    expect(mocks.saveGuestResponseWorkspace).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        batchText: "Newer local typing.",
        expectedRevision: 4,
      }),
    })
  })

  it("retries an ambiguous submission with the same operation ID", async () => {
    const persistedWorkspace: GuestResponseWorkspace = {
      ...initialWorkspace,
      batchText: "The retained practitioner response.",
      progress: { completed: 1, total: 1 },
    }
    mocks.submitGuestResponseWorkspace
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({
        status: "submitted",
        workspace: { locked: true, revision: 0 },
        submission: {
          submissionId: "submission-1",
          requestHumanId: "CR-0241",
          respondent: {
            personId: "person-priya",
            displayName: "Priya Shah",
            email: "priya@example.ca",
          },
          workspaceRevision: 0,
          answerMode: "batch",
          batchText: "The retained practitioner response.",
          questionAnswers: [{ questionId: "question-1", text: "" }],
          questions: [],
          submittedAt: Date.now(),
        },
      })

    render(
      <GuestResponseComposer
        initialWorkspace={persistedWorkspace}
        questions={[
          {
            id: "question-1",
            question: "What actually happens?",
            motivation: "The answer needs practitioner evidence.",
          },
        ]}
        token="guest-token"
      />
    )
    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole("button", { name: "Submit response" }))
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Yes, submit response" })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    const firstOperationId =
      mocks.submitGuestResponseWorkspace.mock.calls[0]?.[0].data.operationId

    fireEvent.click(screen.getByRole("button", { name: "Submit response" }))
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Yes, submit response" })
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.submitGuestResponseWorkspace).toHaveBeenCalledTimes(2)
    expect(
      mocks.submitGuestResponseWorkspace.mock.calls[1]?.[0].data.operationId
    ).toBe(firstOperationId)
    expect(
      mocks.submitGuestResponseWorkspace.mock.calls[1]?.[0].data
        .selectedAnswerMode
    ).toBe("batch")
    expect(
      screen.getByRole("button", { name: "Response submitted" })
    ).toBeTruthy()
  })

  it("passes the respondent's explicit material choice when both modes have saved drafts", async () => {
    const mixedWorkspace: GuestResponseWorkspace = {
      ...initialWorkspace,
      answerMode: "batch",
      batchText: "Saved batch material.",
      questionAnswers: [
        { questionId: "question-1", text: "Saved per-question material." },
      ],
      progress: { completed: 1, total: 1 },
    }
    mocks.submitGuestResponseWorkspace.mockResolvedValue({
      status: "submitted",
      workspace: { locked: true, revision: 0 },
      submission: {
        submissionId: "submission-mixed",
        requestHumanId: "CR-0241",
        respondent: {
          personId: "person-priya",
          displayName: "Priya Shah",
          email: "priya@example.ca",
        },
        workspaceRevision: 0,
        answerMode: "one_by_one",
        selectedAnswerMode: "one_by_one",
        selectionMethod: "respondent_choice",
        batchText: "",
        questionAnswers: [
          {
            questionId: "question-1",
            text: "Saved per-question material.",
          },
        ],
        questions: [],
        submittedAt: Date.now(),
      },
    })

    render(
      <GuestResponseComposer
        initialWorkspace={mixedWorkspace}
        questions={[
          {
            id: "question-1",
            question: "What actually happens?",
            motivation: "The answer needs practitioner evidence.",
          },
        ]}
        token="guest-token"
      />
    )
    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole("button", { name: "Submit response" }))
    fireEvent.click(
      screen.getByRole("radio", {
        name: /^Answer one question at a time/,
      })
    )
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Yes, submit response" })
      )
      await Promise.resolve()
    })

    expect(mocks.submitGuestResponseWorkspace).toHaveBeenCalledWith({
      data: expect.objectContaining({
        confirmed: true,
        selectedAnswerMode: "one_by_one",
      }),
    })
  })

  it("preserves newer typing when an older in-flight save resolves", async () => {
    const firstSave = deferred<SaveGuestResponseWorkspaceResult>()
    const secondSave = deferred<SaveGuestResponseWorkspaceResult>()
    mocks.saveGuestResponseWorkspace
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise)

    renderComposer()
    await act(async () => {
      await Promise.resolve()
    })
    const response = screen.getByRole("textbox", {
      name: "Your complete response",
    })

    fireEvent.change(response, { target: { value: "First draft" } })
    await act(() => vi.advanceTimersByTimeAsync(650))
    expect(mocks.saveGuestResponseWorkspace).toHaveBeenCalledTimes(1)

    fireEvent.change(response, {
      target: { value: "First draft with newer typing" },
    })
    await act(async () => {
      firstSave.resolve(savedWorkspace("First draft", 1))
      await firstSave.promise
    })

    expect((response as HTMLTextAreaElement).value).toBe(
      "First draft with newer typing"
    )

    await act(() => vi.advanceTimersByTimeAsync(650))
    expect(mocks.saveGuestResponseWorkspace).toHaveBeenCalledTimes(2)
    const firstOperationId =
      mocks.saveGuestResponseWorkspace.mock.calls[0]?.[0].data.operationId
    const secondOperationId =
      mocks.saveGuestResponseWorkspace.mock.calls[1]?.[0].data.operationId
    expect(secondOperationId).not.toBe(firstOperationId)
    expect(mocks.saveGuestResponseWorkspace).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        batchText: "First draft with newer typing",
        expectedRevision: 1,
      }),
    })

    await act(async () => {
      secondSave.resolve(savedWorkspace("First draft with newer typing", 2))
      await secondSave.promise
    })
    expect(screen.getByText("Saved")).toBeTruthy()
  })

  it("retries transient failures with bounded backoff and supports manual retry", async () => {
    mocks.saveGuestResponseWorkspace.mockRejectedValue(
      new Error("temporary network failure")
    )

    renderComposer()
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.change(
      screen.getByRole("textbox", { name: "Your complete response" }),
      { target: { value: "A response worth saving" } }
    )

    await act(() => vi.advanceTimersByTimeAsync(650))
    await act(() => vi.advanceTimersByTimeAsync(500))
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    await act(() => vi.advanceTimersByTimeAsync(2_000))

    expect(mocks.saveGuestResponseWorkspace).toHaveBeenCalledTimes(4)
    const retryOperationIds = mocks.saveGuestResponseWorkspace.mock.calls.map(
      ([input]) => input.data.operationId
    )
    expect(new Set(retryOperationIds)).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Retry save" })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry save" }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.saveGuestResponseWorkspace).toHaveBeenCalledTimes(5)
    expect(
      mocks.saveGuestResponseWorkspace.mock.calls[4]?.[0].data.operationId
    ).toBe(retryOperationIds[0])
  })
})

describe("GuestResponseComposer editor lease recovery", () => {
  it("drains an explicit recovered save after pending lease acquisition completes", async () => {
    const acquire = deferred<{
      status: "editing"
      editorLease: GuestResponseWorkspace["editorLease"]
    }>()
    const serverWorkspace = savedWorkspace(
      "Older committed draft.",
      1
    ).workspace
    globalThis.sessionStorage.setItem(
      "fairlend-guest-response-draft:grant-recovery-before-lease",
      JSON.stringify({
        baseRevision: 0,
        answerMode: "batch",
        batchText: "Recovered before lease.",
        questionAnswers: [{ questionId: "question-1", text: "" }],
      })
    )
    mocks.acquireGuestEditorLease.mockReturnValue(acquire.promise)
    mocks.saveGuestResponseWorkspace.mockResolvedValue(
      savedWorkspace("Recovered before lease.", 2)
    )

    render(
      <GuestResponseComposer
        grantId="grant-recovery-before-lease"
        initialWorkspace={serverWorkspace}
        questions={[
          {
            id: "question-1",
            question: "What actually happens?",
            motivation: "The answer needs practitioner evidence.",
          },
        ]}
        token="guest-token"
      />
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Save recovered draft" })
    )
    expect(mocks.saveGuestResponseWorkspace).not.toHaveBeenCalled()

    await act(async () => {
      acquire.resolve({
        status: "editing",
        editorLease: initialWorkspace.editorLease,
      })
      await acquire.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.saveGuestResponseWorkspace).toHaveBeenCalledTimes(1)
    expect(mocks.saveGuestResponseWorkspace).toHaveBeenCalledWith({
      data: expect.objectContaining({
        batchText: "Recovered before lease.",
        expectedRevision: 1,
      }),
    })
  })

  it("waits for this device to acquire the lease even when the projection says a lease is active", async () => {
    const acquire = deferred<{
      status: "editing"
      editorLease: GuestResponseWorkspace["editorLease"]
    }>()
    mocks.acquireGuestEditorLease.mockReturnValue(acquire.promise)

    renderComposer()
    const response = screen.getByRole("textbox", {
      name: "Your complete response",
    })
    expect((response as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.getByText("Checking editor access…")).toBeTruthy()

    await act(async () => {
      acquire.resolve({
        status: "editing",
        editorLease: initialWorkspace.editorLease,
      })
      await acquire.promise
    })

    expect((response as HTMLTextAreaElement).disabled).toBe(false)
    expect(screen.getByText("Editing on this device")).toBeTruthy()
  })

  it("retries an ambiguous heartbeat with the same operation ID", async () => {
    mocks.heartbeatGuestEditorLease
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({
        status: "editing",
        editorLease: {
          ...initialWorkspace.editorLease,
          expiresAt: Date.now() + 45_000,
        },
      })

    renderComposer()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(
      screen.getByRole("button", { name: "Retry editor access" })
    ).toBeTruthy()
    const firstOperationId =
      mocks.heartbeatGuestEditorLease.mock.calls[0]?.[0].data.operationId

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Retry editor access" })
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.heartbeatGuestEditorLease).toHaveBeenCalledTimes(2)
    expect(
      mocks.heartbeatGuestEditorLease.mock.calls[1]?.[0].data.operationId
    ).toBe(firstOperationId)
    expect(screen.getByText("Editing on this device")).toBeTruthy()
  })

  it("retries an ambiguous takeover with the same operation ID", async () => {
    mocks.acquireGuestEditorLease.mockResolvedValue({
      status: "conflict",
      editorLease: initialWorkspace.editorLease,
    })
    mocks.takeoverGuestEditorLease
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({
        status: "editing",
        editorLease: {
          active: true,
          generation: 2,
          expiresAt: Date.now() + 45_000,
        },
      })

    renderComposer()
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Take over editing" }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const firstOperationId =
      mocks.takeoverGuestEditorLease.mock.calls[0]?.[0].data.operationId
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Retry editor access" })
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.takeoverGuestEditorLease).toHaveBeenCalledTimes(2)
    expect(
      mocks.takeoverGuestEditorLease.mock.calls[1]?.[0].data.operationId
    ).toBe(firstOperationId)
    expect(screen.getByText("Editing on this device")).toBeTruthy()
  })
})
