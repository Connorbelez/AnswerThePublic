// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ContentRequestCreateForm } from "@/components/content-request-create-form"

vi.mock("@/components/ui/button-link", () => ({
  ButtonLink: ({
    children,
    ...props
  }: React.ComponentProps<"a"> & { to?: string }) => (
    <a {...props}>{children}</a>
  ),
}))

beforeEach(() => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(
    "3d602661-cbd2-4b79-90c6-fb4598d18092"
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("ContentRequestCreateForm", () => {
  it("preserves standard request creation as the default path", async () => {
    const onCreateStandard = vi.fn().mockResolvedValue({ humanId: "CR-1001" })
    const onCreateExpertInterview = vi.fn()
    const onCreated = vi.fn()

    render(
      <ContentRequestCreateForm
        hydrated
        onCreateStandard={onCreateStandard}
        onCreateExpertInterview={onCreateExpertInterview}
        onCreated={onCreated}
      />
    )

    expect(
      screen.getByLabelText("Standard request").hasAttribute("data-checked")
    ).toBe(true)
    expect(screen.queryByLabelText("Topic")).toBeNull()
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Answer the broker question" },
    })
    fireEvent.change(screen.getByLabelText("Original question"), {
      target: { value: "Can private lenders fund a garden suite?" },
    })
    fireEvent.submit(
      screen
        .getByRole("button", {
          name: "Create Critical request",
        })
        .closest("form")!
    )

    await waitFor(() =>
      expect(onCreateStandard).toHaveBeenCalledWith({
        title: "Answer the broker question",
        source: {
          question: "Can private lenders fund a garden suite?",
        },
        correlationId: "3d602661-cbd2-4b79-90c6-fb4598d18092",
      })
    )
    expect(onCreateExpertInterview).not.toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledWith("CR-1001")
  })

  it("reuses the correlation ID when the same failed submission is retried", async () => {
    const onCreateStandard = vi
      .fn()
      .mockRejectedValue(new Error("Temporary connection failure"))

    render(
      <ContentRequestCreateForm
        hydrated
        onCreateStandard={onCreateStandard}
        onCreateExpertInterview={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    fill("Title", "Retry this request safely")
    const form = screen
      .getByRole("button", { name: "Create Critical request" })
      .closest("form")!
    fireEvent.submit(form)
    await screen.findByText("Temporary connection failure")
    fireEvent.submit(form)
    await waitFor(() => expect(onCreateStandard).toHaveBeenCalledTimes(2))

    expect(onCreateStandard.mock.calls[0]?.[0].correlationId).toBe(
      onCreateStandard.mock.calls[1]?.[0].correlationId
    )
  })

  it("builds a typed expert interview package with ordered gaps and questions", async () => {
    const onCreateStandard = vi.fn()
    const onCreateExpertInterview = vi.fn().mockResolvedValue({
      request: { humanId: "CR-2001" },
    })
    const onCreated = vi.fn()

    render(
      <ContentRequestCreateForm
        hydrated
        onCreateStandard={onCreateStandard}
        onCreateExpertInterview={onCreateExpertInterview}
        onCreated={onCreated}
      />
    )

    fireEvent.click(screen.getByLabelText("Expert interview"))
    expect(screen.getByRole("button", { name: "Add gap" })).toBeTruthy()

    fill("Request title", "Interview a garden suite financing expert")
    fill("Topic", "Garden suite construction financing")
    fill("Audience", "Toronto homeowners")
    fill(
      "Article summary",
      "Explain how borrowers can finance a garden suite build."
    )
    fill(
      "FairLend posture",
      "Be practical and transparent about financing tradeoffs."
    )
    fill(
      "Founder contribution",
      "Add firsthand observations from underwriting real files."
    )
    fill("Aliases", "laneway suite, backyard suite")
    fill("Gap title", "Draw timing is unclear")
    fill("Existing coverage", "Most guides only discuss total loan size.")
    fill(
      "Why it falls short",
      "Borrowers cannot see when funds become available."
    )
    fill("Expert opportunity", "Explain real inspection and draw sequencing.")
    fill("Source label", "CMHC garden suite guide")
    fill("Source URL", "https://example.test/garden-suite-guide")
    fill("What it supports", "Construction financing needs staged funding.")
    fireEvent.click(screen.getByRole("button", { name: "Add citation" }))
    const citationLabels = screen.getAllByLabelText("Source label")
    const citationUrls = screen.getAllByLabelText("Source URL")
    const citationSupports = screen.getAllByLabelText("What it supports")
    fireEvent.change(citationLabels[1]!, {
      target: { value: "Toronto construction report" },
    })
    fireEvent.change(citationUrls[1]!, {
      target: { value: "https://example.test/toronto-construction-report" },
    })
    fireEvent.change(citationSupports[1]!, {
      target: { value: "Local draw timing varies by build stage." },
    })
    fill("Question", "How should a borrower plan for the first draw?")
    fill(
      "Why ask this?",
      "It turns abstract loan terms into an actionable cash-flow plan."
    )

    fireEvent.submit(
      screen
        .getByRole("button", {
          name: "Create expert interview",
        })
        .closest("form")!
    )

    await waitFor(() => expect(onCreateExpertInterview).toHaveBeenCalledOnce())
    expect(onCreateExpertInterview).toHaveBeenCalledWith({
      title: "Interview a garden suite financing expert",
      aliases: ["laneway suite", "backyard suite"],
      brief: {
        topic: "Garden suite construction financing",
        summary: "Explain how borrowers can finance a garden suite build.",
        audience: "Toronto homeowners",
        framing: "educational",
        fairlendPosture:
          "Be practical and transparent about financing tradeoffs.",
        founderContribution:
          "Add firsthand observations from underwriting real files.",
      },
      gaps: [
        {
          id: "gap-1",
          kind: "confusing_coverage",
          title: "Draw timing is unclear",
          existingCoverage: "Most guides only discuss total loan size.",
          whyItFallsShort: "Borrowers cannot see when funds become available.",
          expertOpportunity: "Explain real inspection and draw sequencing.",
          citations: [
            {
              label: "CMHC garden suite guide",
              url: "https://example.test/garden-suite-guide",
              supports: "Construction financing needs staged funding.",
            },
            {
              label: "Toronto construction report",
              url: "https://example.test/toronto-construction-report",
              supports: "Local draw timing varies by build stage.",
            },
          ],
        },
      ],
      questions: [
        {
          id: "question-1",
          question: "How should a borrower plan for the first draw?",
          motivation:
            "It turns abstract loan terms into an actionable cash-flow plan.",
          gapIds: ["gap-1"],
        },
      ],
      correlationId: "3d602661-cbd2-4b79-90c6-fb4598d18092",
    })
    expect(onCreateStandard).not.toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledWith("CR-2001")
  })

  it("keeps the form editable and reports partially entered citations", async () => {
    render(
      <ContentRequestCreateForm
        hydrated
        onCreateStandard={vi.fn()}
        onCreateExpertInterview={vi.fn()}
        onCreated={vi.fn()}
      />
    )

    fireEvent.click(screen.getByLabelText("Expert interview"))
    fill("Source label", "CMHC guide")
    fireEvent.submit(
      screen
        .getByRole("button", {
          name: "Create expert interview",
        })
        .closest("form")!
    )

    expect(
      await screen.findByText("Knowledge gap 1 citation 1 URL is required.")
    ).toBeTruthy()
    expect(
      (
        screen.getByRole("button", {
          name: "Create expert interview",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })
})

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), {
    target: { value },
  })
}
