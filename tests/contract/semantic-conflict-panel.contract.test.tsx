// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SemanticConflictPanel } from "@/components/semantic-conflict-panel"

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), invalidate: vi.fn() }))
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => mocks.resolve,
}))
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
}))

describe("Semantic conflict panel contract", () => {
  it("renders meaningful choices for assignee, primary, and promotion conflicts", () => {
    render(
      <SemanticConflictPanel
        principals={[
          { principalId: "person-1", subject: "Elie", role: "founder" },
          {
            principalId: "person-2",
            subject: "Connor",
            role: "operator_editor",
          },
        ]}
        deliverables={[
          {
            deliverableId: "deliverable-1",
            requestHumanId: "CR-ONE",
            kind: "primary_response",
            name: "Primary response",
            isPrimary: true,
            currentCandidateVersionId: "version-2",
            promotedVersionId: "version-1",
            versions: [
              {
                versionId: "version-1",
                body: "Current approved answer",
                ordinal: 1,
                createdByPrincipalId: "person-2",
                sourceJobId: null,
                changeSummary: null,
                createdAt: 1,
              },
              {
                versionId: "version-2",
                body: "Proposed replacement answer",
                ordinal: 2,
                createdByPrincipalId: "person-2",
                sourceJobId: null,
                changeSummary: null,
                createdAt: 2,
              },
            ],
            createdAt: 1,
            updatedAt: 2,
          },
          {
            deliverableId: "deliverable-2",
            requestHumanId: "CR-ONE",
            kind: "linkedin",
            name: "LinkedIn response",
            isPrimary: false,
            currentCandidateVersionId: null,
            promotedVersionId: null,
            versions: [],
            createdAt: 2,
            updatedAt: 2,
          },
        ]}
        conflicts={[
          {
            conflictId: "conflict-assignee",
            requestHumanId: "CR-ONE",
            field: "assigneePrincipalId",
            currentValue: "person-1",
            proposedValue: "person-2",
            expectedValue: "person-1",
            status: "open",
            correlationId: "assignee",
            createdAt: 1,
            resolvedValue: null,
            resolvedAt: null,
          },
          {
            conflictId: "conflict-primary",
            requestHumanId: "CR-ONE",
            field: "primaryDeliverableId",
            currentValue: "deliverable-1",
            proposedValue: "deliverable-2",
            expectedValue: "deliverable-1",
            status: "open",
            correlationId: "primary",
            createdAt: 2,
            resolvedValue: null,
            resolvedAt: null,
          },
          {
            conflictId: "conflict-promotion",
            requestHumanId: "CR-ONE",
            field: "promotedVersionId",
            currentValue: "version-1",
            proposedValue: "version-2",
            expectedValue: "version-1",
            status: "open",
            correlationId: "promotion",
            createdAt: 3,
            resolvedValue: null,
            resolvedAt: null,
          },
        ]}
      />
    )

    expect(screen.getByText("Assignee changed concurrently")).toBeTruthy()
    expect(
      screen.getByText("Primary deliverable changed concurrently")
    ).toBeTruthy()
    expect(
      screen.getByText("Promoted version changed concurrently")
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Use Elie" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Use LinkedIn response" })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", {
        name: "Use Primary response · version 2 · Proposed replacement answer",
      })
    ).toBeTruthy()
  })
})
