// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OpportunityDecisionPanel } from "@/components/opportunity-decision-panel"
import type { ContentFormat } from "@/application/promote-opportunity"
import type { FounderHandoffStatus } from "@/application/content-requests"

const mocks = vi.hoisted(() => ({
  promoteToken: vi.fn(),
  archiveToken: vi.fn(),
  expirationToken: vi.fn(),
  promote: vi.fn(),
  archive: vi.fn(),
  setExpiration: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock("@/application/content-request-server-functions", () => ({
  promoteOpportunity: mocks.promoteToken,
  archiveContentRequest: mocks.archiveToken,
  setContentRequestExpiration: mocks.expirationToken,
}))
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (token: unknown) =>
    token === mocks.archiveToken
      ? mocks.archive
      : token === mocks.expirationToken
        ? mocks.setExpiration
        : mocks.promote,
}))
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
}))

function Harness() {
  const [formats, setFormats] = useState<Array<ContentFormat>>([
    "original_response",
    "blog_article",
    "linkedin_post",
  ])
  return (
    <OpportunityDecisionPanel
      humanId="CR-TRIAGE"
      recipient={{
        principalId: "elie",
        subject: "Elie",
        role: "founder",
      }}
      formats={formats}
      onFormatsChange={setFormats}
      risk="medium"
    />
  )
}

const deliveredHandoff: FounderHandoffStatus = {
  handoffId: "handoff-1",
  recipient: {
    principalId: "elie",
    subject: "Elie",
    role: "founder",
  },
  selectedFormats: [
    "original_response",
    "blog_article",
    "linkedin_post",
    "youtube_short",
  ],
  note: null,
  stage: "delivered",
  deliveredAt: Date.UTC(2026, 6, 28, 16),
  openedAt: null,
  emailStatus: "queued",
}

describe("Opportunity decision panel", () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocks.promote.mockReset().mockResolvedValue({
      outcome: "applied",
      selectedFormats: deliveredHandoff.selectedFormats,
      handoff: deliveredHandoff,
    })
    mocks.invalidate.mockReset().mockResolvedValue(undefined)
    mocks.archive.mockReset().mockResolvedValue({ outcome: "applied" })
    mocks.setExpiration.mockReset().mockResolvedValue({ outcome: "applied" })
  })

  it("routes to a human recipient and promotes the selected formats", async () => {
    render(<Harness />)

    expect(screen.getByText("Elie")).toBeTruthy()
    expect(screen.getByText("Founder · Content owner")).toBeTruthy()
    expect(screen.queryByText(/Accountable assignee/i)).toBeNull()

    fireEvent.click(screen.getByRole("checkbox", { name: "YouTube Short" }))
    fireEvent.click(screen.getByRole("button", { name: "Promote to Elie" }))

    await waitFor(() => expect(mocks.promote).toHaveBeenCalledTimes(1))
    expect(mocks.promote).toHaveBeenCalledWith({
      data: expect.objectContaining({
        humanId: "CR-TRIAGE",
        recipientPrincipalId: "elie",
        formats: [
          "original_response",
          "blog_article",
          "linkedin_post",
          "youtube_short",
        ],
      }),
    })
    expect(await screen.findByText("Delivered to Elie")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Promote to Elie" })).toBeNull()
    expect(mocks.invalidate).toHaveBeenCalled()
  })

  it("freezes promoted outputs and removes every duplicate promotion action", () => {
    const { rerender } = render(
      <OpportunityDecisionPanel
        humanId="CR-TRIAGE"
        recipient={{
          principalId: "elie",
          subject: "Elie",
          role: "founder",
        }}
        formats={["original_response"]}
        onFormatsChange={vi.fn()}
        risk="medium"
        founderHandoff={deliveredHandoff}
      />
    )

    expect(screen.getByText("Delivered to Elie")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Promote to Elie" })).toBeNull()
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(
        checkbox.hasAttribute("disabled") ||
          checkbox.getAttribute("aria-disabled") === "true" ||
          checkbox.hasAttribute("data-disabled")
      ).toBe(true)
    }

    rerender(
      <OpportunityDecisionPanel
        humanId="CR-TRIAGE"
        recipient={{
          principalId: "elie",
          subject: "Elie",
          role: "founder",
        }}
        formats={["original_response"]}
        onFormatsChange={vi.fn()}
        risk="medium"
        founderHandoff={deliveredHandoff}
        actionBar
      />
    )
    expect(screen.getByText("To Elie: Delivered to Elie")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Promote to Elie" })).toBeNull()
  })

  it("passes on an opportunity without exposing lifecycle terminology", async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Pass on opportunity" }))

    await waitFor(() => expect(mocks.archive).toHaveBeenCalledTimes(1))
    expect(mocks.archive).toHaveBeenCalledWith({
      data: {
        humanId: "CR-TRIAGE",
        correlationId: expect.any(String),
      },
    })
    expect(mocks.invalidate).toHaveBeenCalled()
  })

  it("supports number-key format selection and keyboard promotion", async () => {
    render(<Harness />)

    fireEvent.keyDown(window, { key: "5" })
    expect(
      screen
        .getByRole("checkbox", { name: "YouTube Short" })
        .getAttribute("aria-checked")
    ).toBe("true")

    fireEvent.keyDown(window, { key: "p" })
    await waitFor(() => expect(mocks.promote).toHaveBeenCalledTimes(1))
    expect(mocks.promote).toHaveBeenCalledWith({
      data: expect.objectContaining({
        formats: [
          "original_response",
          "blog_article",
          "linkedin_post",
          "youtube_short",
        ],
      }),
    })
  })
})
