// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const composer = vi.hoisted(() => vi.fn())

vi.mock("@/components/guest-response-composer", () => ({
  GuestResponseComposer: (props: {
    token: string
    grantId?: string
    questions: Array<{
      id: string
      question: string
      motivation: string
    }>
  }) => {
    composer(props)
    return (
      <section aria-label="Standard response composer">
        Existing guest response composer
      </section>
    )
  },
}))

import { GuestAccessResponse } from "@/components/guest-access-response"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Standard Request guest response route", () => {
  it("composes the existing response workspace with the approved prompt and source context", () => {
    render(
      <GuestAccessResponse
        token="standard-response-token"
        view={{
          status: "available",
          grantId: "grant-standard",
          expiresAt: Date.UTC(2026, 6, 30, 12),
          request: {
            humanId: "CR-STANDARD",
            title: "Explain a portable mortgage",
            requestType: "standard",
            brief: {
              question: "Can I take my mortgage with me when I move?",
              body: "The borrower wants a plain-language portability explanation.",
            },
          },
          interview: null,
          questions: [
            {
              id: "standard-prompt:request-id",
              question: "Can I take my mortgage with me when I move?",
              motivation:
                "The borrower wants a plain-language portability explanation.",
            },
          ],
          workspace: {
            answerMode: "one_by_one",
            batchText: "",
            questionAnswers: [
              { questionId: "standard-prompt:request-id", text: "" },
            ],
            progress: { completed: 0, total: 1 },
            revision: 0,
            editorLease: {
              active: false,
              generation: 0,
              expiresAt: null,
            },
            locked: false,
            lockedAt: null,
            feedback: [],
          },
        }}
      />
    )

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Explain a portable mortgage",
      })
    ).toBeTruthy()
    expect(
      screen.getByText("Can I take my mortgage with me when I move?")
    ).toBeTruthy()
    expect(
      screen.getByText(
        "The borrower wants a plain-language portability explanation."
      )
    ).toBeTruthy()
    expect(
      screen.getByRole("region", { name: "Standard response composer" })
    ).toBeTruthy()
    expect(composer).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "standard-response-token",
        grantId: "grant-standard",
        questions: [
          {
            id: "standard-prompt:request-id",
            question: "Can I take my mortgage with me when I move?",
            motivation:
              "The borrower wants a plain-language portability explanation.",
          },
        ],
      })
    )
    expect(screen.queryByRole("combobox")).toBeNull()
  })
})
