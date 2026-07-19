// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DeliveryTargetChecklist } from "@/components/delivery-target-checklist"

const mocks = vi.hoisted(() => ({
  createToken: Symbol("create"),
  requiredToken: Symbol("required"),
  confirmToken: Symbol("confirm"),
  reopenToken: Symbol("reopen"),
  create: vi.fn(),
  required: vi.fn(),
  confirm: vi.fn(),
  reopen: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock("@/application/content-request-server-functions", () => ({
  createDeliveryTarget: mocks.createToken,
  setDeliveryTargetRequired: mocks.requiredToken,
  confirmDeliveryTarget: mocks.confirmToken,
  reopenDeliveryTarget: mocks.reopenToken,
}))
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (token: symbol) =>
    token === mocks.createToken
      ? mocks.create
      : token === mocks.requiredToken
        ? mocks.required
        : token === mocks.confirmToken
          ? mocks.confirm
          : mocks.reopen,
}))
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
}))

const deliverables = [
  {
    deliverableId: "primary-1",
    requestHumanId: "CR-ONE",
    kind: "primary_response",
    name: "Primary response",
    isPrimary: true,
    currentCandidateVersionId: "version-2",
    promotedVersionId: "version-2",
    versions: [
      {
        versionId: "version-1",
        body: "Actually delivered response",
        ordinal: 1,
        createdByPrincipalId: "operator-1",
        sourceJobId: null,
        changeSummary: null,
        createdAt: 1,
      },
      {
        versionId: "version-2",
        body: "Approved response",
        ordinal: 2,
        createdByPrincipalId: "operator-1",
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
]

describe("Delivery target checklist contract", () => {
  beforeEach(() => {
    for (const mock of [
      mocks.create,
      mocks.required,
      mocks.confirm,
      mocks.reopen,
      mocks.invalidate,
    ])
      mock.mockReset().mockResolvedValue(undefined)
  })

  it("exposes contextual controls, durable evidence, and derivative targeting", async () => {
    render(
      <DeliveryTargetChecklist
        humanId="CR-ONE"
        deliverables={deliverables}
        principals={[
          {
            principalId: "operator-1",
            subject: "Connor",
            role: "operator_editor",
          },
        ]}
        targets={[
          {
            targetId: "target-1",
            requestHumanId: "CR-ONE",
            deliverableId: "primary-1",
            channel: "reddit",
            destinationLabel: "Original Reddit thread",
            destinationUrl: "https://reddit.com/r/test/comments/one",
            isOriginal: true,
            isRequired: true,
            currentReceiptId: "receipt-1",
            currentReceipt: {
              receiptId: "receipt-1",
              versionId: "version-1",
              channel: "reddit",
              destinationLabel: "Original Reddit thread",
              destinationUrl: "https://reddit.com/r/test/comments/one",
              note: "Posted as FairLend",
              confirmedByPrincipalId: "operator-1",
              confirmationMethod: "integration",
              integrationIdentity: "fairlend-official",
              externalReceiptId: "reddit-comment-42",
              respondedAt: 1_700_000_000_000,
            },
            receiptHistory: [
              {
                receiptId: "receipt-1",
                versionId: "version-1",
                channel: "reddit",
                destinationLabel: "Original Reddit thread",
                destinationUrl: "https://reddit.com/r/test/comments/one",
                note: "Posted as FairLend",
                confirmedByPrincipalId: "operator-1",
                confirmationMethod: "integration",
                integrationIdentity: "fairlend-official",
                externalReceiptId: "reddit-comment-42",
                respondedAt: 1_700_000_000_000,
              },
            ],
            createdAt: 1,
            updatedAt: 2,
          },
        ]}
      />
    )

    expect(
      screen.getByRole("button", {
        name: "Reopen delivery to Original Reddit thread",
      })
    ).toBeTruthy()
    expect(screen.getByText("Actor: Connor")).toBeTruthy()
    expect(screen.getByText("Note: Posted as FairLend")).toBeTruthy()
    expect(screen.getByText(/Version 1 confirmed/)).toBeTruthy()
    expect(screen.getAllByText(/Receipt reddit-comment-42/)).toHaveLength(2)
    expect(screen.getByRole("link", { name: /reddit\.com/ })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Add channel" }))
    fireEvent.change(screen.getByRole("combobox", { name: "Deliverable" }), {
      target: { value: "derivative-1" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Channel" }), {
      target: { value: "linkedin" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Destination" }), {
      target: { value: "LinkedIn post" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Create optional channel" })
    )

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ deliverableId: "derivative-1" }),
      })
    )
  })
})
