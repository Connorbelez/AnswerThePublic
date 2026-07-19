// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { UnifiedContextCanvas } from "@/components/unified-context-canvas"
import type {
  ContentContextItem,
  ContentRequest,
} from "@/application/content-requests"

const request = {
  humanId: "CR-0142",
  requestId: "opaque-142",
  title: "Financing a laneway suite without breaking a low-rate mortgage",
  aliases: [],
  origin: "automated_scout",
  priority: "high",
  lifecycle: "pending",
  disposition: "active",
  retention: "active",
  aggregateVersion: 1,
  assignee: {
    principalId: "founder-1",
    subject: "user_elie",
    role: "founder",
  },
  watchers: [],
  firstOpenedAt: null,
  latestOpenedAt: null,
  hasFounderDraft: false,
  founderDraftUpdatedAt: null,
  source: {
    question:
      "Can we fund a laneway suite while preserving our first mortgage?",
    body: "The complete original source body must remain readable without line clamping, including construction costs, permits, staged draws, lender consent, and the full borrower context.",
    url: "https://community.example/laneway-suite",
    name: "Community question",
    channel: "forum",
  },
  createdAt: 1,
  updatedAt: 1,
} satisfies ContentRequest

const context = [
  {
    contextId: "context-operator-cue",
    kind: "operator_cue",
    title: "Operator cue",
    bulletPoints: [
      "Address second-position eligibility and cash needed before the first draw.",
    ],
    citations: [],
  },
  {
    contextId: "context-talking-points",
    kind: "talking_points",
    title: "Talking points",
    bulletPoints: [
      "Separate the first mortgage from the construction facility.",
      "Explain inspection-based releases and the cash-flow gap.",
    ],
    citations: [],
  },
  {
    contextId: "context-research",
    kind: "research_requirements",
    title: "Research required",
    bulletPoints: [
      "Confirm whether the existing lender permits secondary financing.",
    ],
    citations: [],
  },
  {
    contextId: "context-citations",
    kind: "citations",
    title: "Citations",
    bulletPoints: [],
    citations: [
      {
        label: "City of Toronto laneway suites",
        url: "https://toronto.example/laneway",
        supports: "Eligibility and permit pathway",
      },
    ],
  },
  {
    contextId: "context-missing-research",
    kind: "missing_research",
    title: "Missing research",
    bulletPoints: ["Current income and debt service ratios are not verified."],
    citations: [],
  },
  {
    contextId: "context-guardrails",
    kind: "guardrails",
    title: "Response guardrails",
    bulletPoints: [
      "Keep the response educational and disclose FairLend affiliation.",
    ],
    citations: [],
  },
] satisfies Array<ContentContextItem>

describe("Variant G Unified Context Canvas", () => {
  it("toggles and pins complete context while preserving one mounted editor", () => {
    render(
      <UnifiedContextCanvas
        request={request}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
      />
    )

    const canvas = screen.getByRole("main", {
      name: "Content Request workspace",
    })
    expect(within(canvas).getByText(request.source!.body!)).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "Founder input" })).toBeTruthy()
    expect(
      screen.getByTestId("founder-editor").getAttribute("data-expanded")
    ).toBe("false")

    fireEvent.click(screen.getByRole("button", { name: "Hide Talking points" }))
    expect(screen.queryByRole("article", { name: "Talking points" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Pin Talking points" }))
    const pinned = screen.getByRole("article", { name: "Talking points" })
    expect(pinned.getAttribute("data-pinned")).toBe("true")
    expect(within(pinned).getByText(context[1].bulletPoints[1])).toBeTruthy()
    fireEvent.click(
      within(pinned).getByRole("button", {
        name: "Unpin Talking points card",
      })
    )
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Pin Talking points" })
    )
    expect(screen.queryByRole("article", { name: "Talking points" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Expand editor" }))
    expect(
      screen.getByTestId("founder-editor").getAttribute("data-expanded")
    ).toBe("true")
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Founder input" })
    )
    fireEvent.click(screen.getByRole("button", { name: "Collapse editor" }))
    expect(
      screen.getByTestId("founder-editor").getAttribute("data-expanded")
    ).toBe("false")
    expect(
      screen.getAllByRole("textbox", { name: "Founder input" })
    ).toHaveLength(1)
  })

  it("preserves URL-only sources, distinct same-kind items, and preference changes", async () => {
    const onPreferencesChange = vi.fn()
    render(
      <UnifiedContextCanvas
        request={{
          ...request,
          humanId: "CR-URL-ONLY",
          source: { url: "https://community.example/source-only" },
        }}
        contextItems={[
          {
            contextId: "talking-point-set-one",
            kind: "talking_points",
            title: "Primary talking points",
            bulletPoints: ["Primary point"],
            citations: [],
          },
          {
            contextId: "talking-point-set-two",
            kind: "talking_points",
            title: "Supplemental talking points",
            bulletPoints: ["Supplemental point"],
            citations: [],
          },
        ]}
        preferenceOwnerKey="org-fairlend:founder-1"
        initialPreferences={null}
        onPreferencesChange={onPreferencesChange}
      />
    )
    expect(
      screen
        .getByRole("link", { name: /Open original source/ })
        .getAttribute("href")
    ).toBe("https://community.example/source-only")
    fireEvent.click(
      screen.getByRole("button", { name: "Hide Primary talking points" })
    )
    expect(
      screen.queryByRole("article", { name: "Primary talking points" })
    ).toBeNull()
    expect(
      screen.getByRole("article", { name: "Supplemental talking points" })
    ).toBeTruthy()
    await waitFor(() => expect(onPreferencesChange).toHaveBeenCalled())
    expect(onPreferencesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        knownContextIds: expect.arrayContaining([
          "talking-point-set-one",
          "talking-point-set-two",
          "original-source-link",
        ]),
      }),
      expect.any(String)
    )
  })

  it("flushes a final debounced preference change during unmount", async () => {
    const onPreferencesChange = vi.fn().mockResolvedValue(undefined)
    const view = render(
      <UnifiedContextCanvas
        request={{ ...request, humanId: "CR-FLUSH" }}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
        onPreferencesChange={onPreferencesChange}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Hide Talking points" }))
    view.unmount()
    await waitFor(() => expect(onPreferencesChange).toHaveBeenCalledOnce())
    expect(onPreferencesChange).toHaveBeenCalledWith(
      expect.objectContaining({
        visibleContextIds: expect.not.arrayContaining([
          "context-talking-points",
        ]),
      }),
      expect.any(String)
    )
  })

  it("does not recover another principal's retained browser preferences", () => {
    const neverCompletes = vi.fn(() => new Promise<void>(() => undefined))
    const first = render(
      <UnifiedContextCanvas
        request={{ ...request, humanId: "CR-SHARED-BROWSER" }}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-a"
        onPreferencesChange={neverCompletes}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Hide Talking points" }))
    expect(screen.queryByRole("article", { name: "Talking points" })).toBeNull()
    first.unmount()

    render(
      <UnifiedContextCanvas
        request={{ ...request, humanId: "CR-SHARED-BROWSER" }}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-b"
      />
    )
    expect(screen.getByRole("article", { name: "Talking points" })).toBeTruthy()
  })

  it("shares restored text across editor sizes and presents autosave connectivity", async () => {
    let finishSave: (() => void) | undefined
    const onDraftSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
        })
    )
    const view = render(
      <UnifiedContextCanvas
        request={{ ...request, humanId: "CR-AUTOSAVE" }}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
        initialDraft="Restored durable founder text"
        onDraftSave={onDraftSave}
      />
    )
    const editor = within(view.container).getByRole("textbox", {
      name: "Founder input",
    })
    expect((editor as HTMLTextAreaElement).value).toBe(
      "Restored durable founder text"
    )
    fireEvent.change(editor, {
      target: { value: "Restored durable founder text plus a new point" },
    })
    expect(
      within(view.container).getByText("Saving", { exact: true })
    ).toBeTruthy()
    fireEvent.click(
      within(view.container).getByRole("button", { name: "Expand editor" })
    )
    expect(
      (
        within(view.container).getByRole("textbox", {
          name: "Founder input",
        }) as HTMLTextAreaElement
      ).value
    ).toBe("Restored durable founder text plus a new point")
    await waitFor(() => expect(onDraftSave).toHaveBeenCalledOnce())
    finishSave?.()
    await waitFor(() =>
      expect(
        within(view.container).getByText("Saved", { exact: true })
      ).toBeTruthy()
    )

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })
    fireEvent(window, new Event("offline"))
    fireEvent.change(editor, { target: { value: "An offline edit" } })
    expect(
      within(view.container).getByText("Offline", { exact: true })
    ).toBeTruthy()
    expect(onDraftSave).toHaveBeenCalledOnce()
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    })
    fireEvent(window, new Event("online"))
  })

  it("surfaces and schedules recovery for terminal online save failures", async () => {
    const onDraftSave = vi.fn().mockRejectedValue(new TypeError("network"))
    const view = render(
      <UnifiedContextCanvas
        request={{ ...request, humanId: "CR-SAVE-RETRY" }}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
        onDraftSave={onDraftSave}
      />
    )
    fireEvent.change(
      within(view.container).getByRole("textbox", { name: "Founder input" }),
      { target: { value: "A save that encounters a transient outage" } }
    )
    await waitFor(
      () =>
        expect(
          within(view.container).getByText("Save pending", { exact: true })
        ).toBeTruthy(),
      { timeout: 3_000 }
    )
    expect(onDraftSave).toHaveBeenCalledTimes(3)
    view.unmount()
  })

  it.each([
    "FOUNDER_INPUT_HANDOFF_REQUIRED",
    "PRINCIPAL_NOT_PROVISIONED",
    "AUTHORIZATION_NOT_CONFIGURED",
  ])("does not retry permanent founder save failure %s", async (code) => {
    const onDraftSave = vi.fn().mockRejectedValue({
      data: { code },
    })
    const view = render(
      <UnifiedContextCanvas
        request={{ ...request, humanId: "CR-SAVE-BLOCKED" }}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
        onDraftSave={onDraftSave}
      />
    )
    fireEvent.change(
      within(view.container).getByRole("textbox", { name: "Founder input" }),
      { target: { value: "A draft after an ownership conflict" } }
    )
    await waitFor(() =>
      expect(
        within(view.container).getByText("Save blocked", { exact: true })
      ).toBeTruthy()
    )
    expect(onDraftSave).toHaveBeenCalledOnce()
    view.unmount()
  })
})
