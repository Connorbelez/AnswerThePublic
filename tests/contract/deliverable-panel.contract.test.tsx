// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DeliverablePanel } from "@/components/deliverable-panel"

const mocks = vi.hoisted(() => ({
  promoteToken: vi.fn(),
  primaryToken: vi.fn(),
  promote: vi.fn(),
  setPrimary: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock("@/application/content-request-server-functions", () => ({
  promoteDeliverableVersion: mocks.promoteToken,
  setPrimaryDeliverable: mocks.primaryToken,
}))
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (token: unknown) =>
    token === mocks.promoteToken ? mocks.promote : mocks.setPrimary,
}))
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
}))

describe("Deliverable panel contract", () => {
  beforeEach(() => {
    mocks.promote.mockReset()
    mocks.setPrimary.mockReset()
    mocks.invalidate.mockReset().mockResolvedValue(undefined)
  })

  it("names mutation controls contextually and announces actionable failures", async () => {
    mocks.promote.mockRejectedValue(new Error("network"))
    render(
      <DeliverablePanel
        humanId="CR-ONE"
        deliverables={[
          {
            deliverableId: "primary-1",
            requestHumanId: "CR-ONE",
            kind: "primary_response",
            name: "Primary response",
            isPrimary: true,
            currentCandidateVersionId: "version-2",
            promotedVersionId: "version-1",
            versions: [
              {
                versionId: "version-2",
                body: "Candidate",
                ordinal: 2,
                createdByPrincipalId: "operator",
                sourceJobId: null,
                changeSummary: null,
                createdAt: 2,
              },
            ],
            createdAt: 1,
            updatedAt: 2,
          },
          {
            deliverableId: "derivative-1",
            requestHumanId: "CR-ONE",
            kind: "linkedin_post",
            name: "LinkedIn post",
            isPrimary: false,
            currentCandidateVersionId: null,
            promotedVersionId: null,
            versions: [],
            createdAt: 3,
            updatedAt: 3,
          },
        ]}
      />
    )

    const promote = screen.getByRole("button", {
      name: "Promote Primary response version 2",
    })
    expect(
      screen.getByRole("button", { name: "Make LinkedIn post primary" })
    ).toBeTruthy()
    fireEvent.click(promote)
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Could not promote Primary response version 2"
      )
    )
  })
})
