// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DeliveryTargetChecklist } from "@/components/delivery-target-checklist"

const mocks = vi.hoisted(() => ({
  createToken: Symbol("create"),
  listArchivedToken: Symbol("list-archived"),
  requiredToken: Symbol("required"),
  retentionToken: Symbol("retention"),
  confirmToken: Symbol("confirm"),
  reopenToken: Symbol("reopen"),
  create: vi.fn(),
  listArchived: vi.fn(),
  required: vi.fn(),
  retention: vi.fn(),
  confirm: vi.fn(),
  reopen: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock("@/application/content-request-server-functions", () => ({
  createDeliveryTarget: mocks.createToken,
  listArchivedDeliveryTargets: mocks.listArchivedToken,
  setDeliveryTargetRequired: mocks.requiredToken,
  setDeliveryTargetRetention: mocks.retentionToken,
  confirmDeliveryTarget: mocks.confirmToken,
  reopenDeliveryTarget: mocks.reopenToken,
}))
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (token: symbol) =>
    token === mocks.createToken
      ? mocks.create
      : token === mocks.listArchivedToken
        ? mocks.listArchived
        : token === mocks.requiredToken
          ? mocks.required
          : token === mocks.retentionToken
            ? mocks.retention
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
  afterEach(cleanup)

  beforeEach(() => {
    for (const mock of [
      mocks.create,
      mocks.listArchived,
      mocks.required,
      mocks.retention,
      mocks.confirm,
      mocks.reopen,
      mocks.invalidate,
    ])
      mock.mockReset().mockResolvedValue(undefined)
    mocks.retention.mockImplementation(({ data }) => Promise.resolve(data))
    mocks.listArchived.mockResolvedValue({ page: [], nextCursor: null })
  })

  it("exposes contextual controls, durable evidence, and derivative targeting", async () => {
    render(
      <DeliveryTargetChecklist
        humanId="CR-ONE"
        initialArchivedCursor="archived-page-2"
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
            retention: "active",
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
          {
            targetId: "target-2",
            requestHumanId: "CR-ONE",
            deliverableId: "primary-1",
            channel: "linkedin",
            destinationLabel: "LinkedIn post",
            destinationUrl: null,
            isOriginal: false,
            isRequired: false,
            retention: "active",
            currentReceiptId: null,
            currentReceipt: null,
            receiptHistory: [],
            createdAt: 3,
            updatedAt: 3,
          },
          {
            targetId: "target-3",
            requestHumanId: "CR-ONE",
            deliverableId: "primary-1",
            channel: "newsletter",
            destinationLabel: "Archived newsletter",
            destinationUrl: null,
            isOriginal: false,
            isRequired: false,
            retention: "archived",
            currentReceiptId: null,
            currentReceipt: null,
            receiptHistory: [],
            createdAt: 4,
            updatedAt: 4,
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

    fireEvent.click(
      screen.getByRole("button", {
        name: "Archive delivery target LinkedIn post",
      })
    )
    await waitFor(() =>
      expect(mocks.retention).toHaveBeenCalledWith({
        data: expect.objectContaining({
          targetId: "target-2",
          retention: "archived",
        }),
      })
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: "Restore delivery target Archived newsletter",
      })
    )
    await waitFor(() =>
      expect(mocks.retention).toHaveBeenCalledWith({
        data: expect.objectContaining({
          targetId: "target-3",
          retention: "active",
        }),
      })
    )

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
    mocks.listArchived.mockResolvedValueOnce({
      page: [
        {
          targetId: "target-4",
          requestHumanId: "CR-ONE",
          deliverableId: "primary-1",
          channel: "press",
          destinationLabel: "Archived press follow-up",
          destinationUrl: null,
          isOriginal: false,
          isRequired: false,
          retention: "archived",
          currentReceiptId: null,
          currentReceipt: null,
          receiptHistory: [],
          createdAt: 5,
          updatedAt: 5,
        },
      ],
      nextCursor: null,
    })
    const invalidationsBeforeLoad = mocks.invalidate.mock.calls.length
    fireEvent.click(
      screen.getByRole("button", { name: "Load more archived channels" })
    )
    await waitFor(() =>
      expect(screen.getByText("Archived press follow-up")).toBeTruthy()
    )
    expect(mocks.invalidate).toHaveBeenCalledTimes(invalidationsBeforeLoad)
  })

  it("keeps archived pagination available on read-only requests", async () => {
    mocks.listArchived.mockResolvedValueOnce({ page: [], nextCursor: null })
    render(
      <DeliveryTargetChecklist
        humanId="CR-ARCHIVED"
        targets={[]}
        deliverables={[]}
        principals={[]}
        initialArchivedCursor="archived-page-2"
        readOnly
      />
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Load more archived channels" })
    )
    await waitFor(() =>
      expect(mocks.listArchived).toHaveBeenCalledWith({
        data: { humanId: "CR-ARCHIVED", cursor: "archived-page-2" },
      })
    )
  })

  it("renders a confirmed receipt from the mutation response", async () => {
    const target = {
      targetId: "target-pending",
      requestHumanId: "CR-ONE",
      deliverableId: "primary-1",
      channel: "reddit",
      destinationLabel: "Original Reddit thread",
      destinationUrl: "https://reddit.com/r/test/comments/one",
      isOriginal: true,
      isRequired: true,
      retention: "active" as const,
      currentReceiptId: null,
      currentReceipt: null,
      receiptHistory: [],
      createdAt: 1,
      updatedAt: 1,
    }
    const receipt = {
      receiptId: "receipt-confirmed",
      versionId: "version-2",
      channel: target.channel,
      destinationLabel: target.destinationLabel,
      destinationUrl: target.destinationUrl,
      note: "Posted from the operator workspace",
      confirmedByPrincipalId: "operator-1",
      confirmationMethod: "manual" as const,
      integrationIdentity: null,
      externalReceiptId: null,
      respondedAt: 1_700_000_000_000,
    }
    mocks.confirm.mockResolvedValueOnce({
      ...target,
      currentReceiptId: receipt.receiptId,
      currentReceipt: receipt,
      receiptHistory: [receipt],
      updatedAt: 2,
    })

    render(
      <DeliveryTargetChecklist
        humanId="CR-ONE"
        targets={[target]}
        deliverables={deliverables}
        principals={[
          {
            principalId: "operator-1",
            subject: "Connor",
            role: "operator_editor",
          },
        ]}
      />
    )

    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Confirmation note for Original Reddit thread (optional)",
      }),
      { target: { value: receipt.note } }
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: "Mark Original Reddit thread responded",
      })
    )

    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith({
        data: expect.objectContaining({
          targetId: target.targetId,
          versionId: "version-2",
          note: receipt.note,
        }),
      })
    )
    expect(
      await screen.findByText(`Note: ${receipt.note}`)
    ).toBeTruthy()
    expect(
      screen.getByRole("button", {
        name: "Reopen delivery to Original Reddit thread",
      })
    ).toBeTruthy()
  })
})
