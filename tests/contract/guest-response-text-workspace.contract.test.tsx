// @vitest-environment jsdom
import { useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { GuestResponseWorkspace } from "@/application/content-requests"
import { GuestResponseTextWorkspace } from "@/components/guest-response-text-workspace"

const initialWorkspace: GuestResponseWorkspace = {
  answerMode: "one_by_one",
  batchText: "A retained batch answer.",
  questionAnswers: [
    { questionId: "question-1", text: "" },
    { questionId: "question-2", text: "" },
  ],
  progress: { completed: 0, total: 2 },
  revision: 0,
  editorLease: {
    active: false,
    generation: 0,
    expiresAt: null,
  },
}

const questions = [
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
] as const

afterEach(cleanup)

function Harness() {
  const [workspace, setWorkspace] = useState(initialWorkspace)

  return (
    <GuestResponseTextWorkspace
      onAnswerModeChange={(answerMode) =>
        setWorkspace((current) => ({ ...current, answerMode }))
      }
      onBatchTextChange={(batchText) =>
        setWorkspace((current) => ({ ...current, batchText }))
      }
      onQuestionAnswerChange={(questionId, text) =>
        setWorkspace((current) => ({
          ...current,
          questionAnswers: current.questionAnswers.map((answer) =>
            answer.questionId === questionId ? { ...answer, text } : answer
          ),
        }))
      }
      questions={questions}
      renderQuestionSupplement={(questionId) => (
        <p>Feedback for {questionId}</p>
      )}
      workspace={workspace}
    />
  )
}

describe("GuestResponseTextWorkspace", () => {
  it("renders and edits both text modes without lease, evidence, or submission capabilities", () => {
    render(<Harness />)

    expect(screen.getByText("0 of 2 answered")).toBeTruthy()
    expect(screen.getByText("All questions")).toBeTruthy()
    expect(
      document.querySelector("[data-guest-response-footer-spacer]")
    ).toBeTruthy()
    const secondQuestion = screen.getByRole("button", {
      name: "2. Which warning sign matters?",
    })
    expect(secondQuestion.getAttribute("aria-expanded")).toBe("false")

    fireEvent.click(secondQuestion)
    expect(
      screen.getByRole("heading", { name: "Which warning sign matters?" })
    ).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
      target: { value: "Watch for an unconfirmed payout statement." },
    })
    expect(screen.getByText("1 of 2 answered")).toBeTruthy()
    expect(screen.getByText("Feedback for question-2")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Previous" }))
    expect(
      screen.getByRole("heading", { name: "What happens first?" })
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Answer all at once" }))
    expect(
      (
        screen.getByRole("textbox", {
          name: "Your complete response",
        }) as HTMLTextAreaElement
      ).value
    ).toBe("A retained batch answer.")
    expect(screen.getByText("Feedback for question-1")).toBeTruthy()
    expect(screen.getByText("Feedback for question-2")).toBeTruthy()

    fireEvent.change(
      screen.getByRole("textbox", { name: "Your complete response" }),
      { target: { value: "A revised batch answer." } }
    )
    expect(screen.getByText("2 of 2 answered")).toBeTruthy()

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
})
