// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/guest-submission-control", () => ({
  GuestSubmissionControl: ({
    onSubmit,
    submitted,
  }: {
    onSubmit(): void
    submitted: boolean
  }) => (
    <button onClick={onSubmit} type="button">
      {submitted ? "Expertise submitted" : "Submit expertise"}
    </button>
  ),
}))

import {
  FocusedProoflineBatchAnswers,
  FocusedProoflineQuestionAnswers,
  type FocusedProoflineAnswerQuestion,
} from "@/components/focused-proofline-answer-surfaces"

const questions: FocusedProoflineAnswerQuestion[] = [
  {
    id: "question-1",
    question: "What happens first?",
    motivation: "Generic sources omit the operational sequence.",
    proofLabel: "Process",
    required: true,
  },
  {
    id: "question-2",
    question: "Which warning sign matters?",
    motivation: "Readers need a transferable decision rule.",
    proofLabel: "Decision rule",
    required: false,
  },
]

afterEach(cleanup)

describe("Focused Proofline reusable answer surfaces", () => {
  it("preserves the expanded batch hierarchy and delegates composer actions", () => {
    const onDraftChange = vi.fn()
    const onRecordingChange = vi.fn()
    const onSubmit = vi.fn()

    render(
      <FocusedProoflineBatchAnswers
        draft="Call the lawyer first."
        onDraftChange={onDraftChange}
        onRecordingChange={onRecordingChange}
        onSubmit={onSubmit}
        questions={questions}
        recording={false}
        submitted={false}
        variantLabel="Focused Proofline"
      />
    )

    expect(screen.getByText("2 questions · expanded")).toBeTruthy()
    expect(screen.getByText("What happens first?")).toBeTruthy()
    expect(
      screen.getByText("Generic sources omit the operational sequence.")
    ).toBeTruthy()
    expect(screen.getByText("Required")).toBeTruthy()
    expect(screen.getByText("Optional")).toBeTruthy()

    fireEvent.change(screen.getByRole("textbox", { name: "Batch response" }), {
      target: { value: "Call the lawyer, then verify the gap." },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Record batch response" })
    )
    fireEvent.click(screen.getByRole("button", { name: "Submit expertise" }))

    expect(onDraftChange).toHaveBeenCalledWith(
      "Call the lawyer, then verify the gap."
    )
    expect(onRecordingChange).toHaveBeenCalledWith(true)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("exposes a production composer slot without duplicating the question hierarchy", () => {
    render(
      <FocusedProoflineBatchAnswers
        draft=""
        onDraftChange={vi.fn()}
        onRecordingChange={vi.fn()}
        onSubmit={vi.fn()}
        presentation="production"
        questions={questions}
        recording={false}
        renderComposer={({ questionCount }) => (
          <div>Persisted composer for {questionCount} questions</div>
        )}
        submitted={false}
      />
    )

    expect(screen.getByText("Persisted composer for 2 questions")).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "Batch response" })).toBeNull()
    expect(screen.getByText("Which warning sign matters?")).toBeTruthy()
  })

  it("owns focused navigation while delegating answer persistence by stable question ID", () => {
    const onAnswer = vi.fn()
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    const onSkip = vi.fn()
    const onJump = vi.fn()

    render(
      <FocusedProoflineQuestionAnswers
        activeQuestionIndex={0}
        answers={{ "question-1": "", "question-2": "Existing answer" }}
        onAnswer={onAnswer}
        onJump={onJump}
        onNext={onNext}
        onPrevious={onPrevious}
        onSkip={onSkip}
        questions={questions}
        skipped={["question-1"]}
      />
    )

    expect(
      screen.getByRole("heading", { name: "What happens first?" })
    ).toBeTruthy()
    expect(screen.getByText("1 answered · 1 skipped")).toBeTruthy()
    expect(
      screen.getByRole("button", {
        name: "2 Which warning sign matters?",
      })
    ).toBeTruthy()

    fireEvent.change(
      screen.getByRole("textbox", { name: "Answer to question 1" }),
      {
        target: { value: "Call the closing lawyer." },
      }
    )
    fireEvent.click(screen.getByRole("button", { name: "Save & next" }))
    fireEvent.click(screen.getByRole("button", { name: "Skip" }))

    expect(onAnswer).toHaveBeenCalledWith(
      "question-1",
      "Call the closing lawyer."
    )
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onSkip).toHaveBeenCalledWith("question-1")
    expect(
      screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled")
    ).toBe(true)
  })

  it("lets a production caller replace the focused editor at the same seam", () => {
    render(
      <FocusedProoflineQuestionAnswers
        activeQuestionIndex={1}
        answers={{ "question-1": "", "question-2": "Retained answer" }}
        onAnswer={vi.fn()}
        onJump={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        onSkip={vi.fn()}
        presentation="production"
        questions={questions}
        renderAnswerEditor={({ question, answer }) => (
          <div>
            Persisted editor: {question.id} · {answer}
          </div>
        )}
      />
    )

    expect(
      screen.getByText("Persisted editor: question-2 · Retained answer")
    ).toBeTruthy()
    expect(
      screen.queryByRole("textbox", { name: "Answer to question 2" })
    ).toBeNull()
  })
})
