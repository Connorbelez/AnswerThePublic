// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ExpertInterviewBriefView } from "@/components/expert-interview-brief"
import type { ExpertInterviewPackage } from "@/application/expert-interviews"

const expertInterview: ExpertInterviewPackage = {
  expertInterviewId: "expert-1",
  requestHumanId: "CR-0241",
  brief: {
    topic: "Bridge financing after a delayed closing",
    summary: "A practical recovery guide grounded in practitioner evidence.",
    audience: "Ontario mortgage brokers and borrowers",
    framing: "insider_knowledge",
    fairlendPosture: "Useful first; commercial relevance disclosed.",
    founderContribution: "The real first-hour recovery sequence.",
  },
  gaps: [
    {
      id: "gap-second",
      kind: "missing_evidence",
      title: "Second-stage decisions",
      existingCoverage: "Guides describe standard timelines.",
      whyItFallsShort: "They omit recovery decisions.",
      expertOpportunity: "Document the decision after the shortfall is known.",
      citations: [
        {
          label: "Ontario guidance",
          url: "https://example.test/guidance",
          supports: "Standard disclosure obligations",
        },
      ],
    },
    {
      id: "gap-first",
      kind: "reality_on_the_ground",
      title: "The first hour",
      existingCoverage: "Guides list eligibility.",
      whyItFallsShort: "They omit live closing failures.",
      expertOpportunity: "Document who gets called first.",
      citations: [],
    },
  ],
  questions: [
    {
      id: "q-second",
      question: "What decision follows confirmation of the shortfall?",
      motivation: "Capture the second-stage decision.",
      gapIds: ["gap-second"],
    },
    {
      id: "q-first",
      question: "What happens in the first hour?",
      motivation: "Capture the missing recovery sequence.",
      gapIds: ["gap-first"],
    },
  ],
  operatorInstructions: "Lead with the Ontario broker's point of view.",
  createdAt: 1,
  updatedAt: 1,
}

describe("production Expert Interview brief", () => {
  it("shows the complete package in durable question and gap order", () => {
    render(<ExpertInterviewBriefView expertInterview={expertInterview} />)

    expect(
      screen.getByRole("heading", { name: "Expert interview brief" })
    ).toBeTruthy()
    expect(screen.getByText(expertInterview.brief.summary)).toBeTruthy()
    expect(screen.getByText(expertInterview.brief.audience)).toBeTruthy()
    expect(screen.getByText("Insider knowledge")).toBeTruthy()
    expect(screen.getByText(expertInterview.brief.fairlendPosture)).toBeTruthy()
    expect(
      screen.getByText(expertInterview.brief.founderContribution)
    ).toBeTruthy()
    expect(
      screen.getByText("Lead with the Ontario broker's point of view.")
    ).toBeTruthy()

    const gaps = screen.getAllByTestId("expert-interview-gap")
    expect(
      gaps.map(
        (gap) => within(gap).getByRole("heading", { level: 3 }).textContent
      )
    ).toEqual(["Second-stage decisions", "The first hour"])
    expect(
      within(gaps[0]!)
        .getByRole("link", { name: "Ontario guidance" })
        .getAttribute("href")
    ).toBe("https://example.test/guidance")

    const questions = screen.getAllByTestId("expert-interview-question")
    expect(
      questions.map(
        (question) =>
          within(question).getByRole("heading", { level: 3 }).textContent
      )
    ).toEqual([
      "What decision follows confirmation of the shortfall?",
      "What happens in the first hour?",
    ])
    expect(within(questions[0]!).getByText("gap-second")).toBeTruthy()
    expect(
      within(questions[0]!).getByText("Capture the second-stage decision.")
    ).toBeTruthy()
  })
})
