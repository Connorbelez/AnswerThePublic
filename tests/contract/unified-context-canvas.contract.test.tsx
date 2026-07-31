// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

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
  requestType: "standard",
  origin: "automated_scout",
  priority: "high",
  lifecycle: "pending",
  disposition: "active",
  retention: "active",
  expiresAt: null,
  expiredAt: null,
  expirationReason: null,
  expirationReviewRequiredAt: null,
  archivedAt: null,
  parentRequestHumanId: null,
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

function expandFounderEditor() {
  fireEvent.click(screen.getByRole("button", { name: "Expand editor" }))
}

describe("Variant G Unified Context Canvas", () => {
  afterEach(cleanup)

  it("renders inactive founder work as visibly read-only", () => {
    const onTextChange = vi.fn()
    const view = render(
      <UnifiedContextCanvas
        request={{ ...request, disposition: "expired" }}
        requestActive={false}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
        draftController={{
          text: "Durable founder input",
          status: "Saved",
          canUndo: true,
          canRedo: true,
          history: null,
          archiveEntries: [],
          archiveDone: true,
          readOnly: true,
          onTextChange,
          onUndo: vi.fn(),
          onRedo: vi.fn(),
          onLoadOlderHistory: vi.fn(),
          onRestoreArchivedVersion: vi.fn(),
        }}
      />
    )
    expect(screen.getByText(/inactive.*read-only/i)).toBeTruthy()
    expandFounderEditor()
    const editor = screen.getByRole("textbox", { name: "Founder input" })
    expect((editor as HTMLTextAreaElement).readOnly).toBe(true)
    fireEvent.change(editor, { target: { value: "Blocked edit" } })
    expect(onTextChange).not.toHaveBeenCalled()
    expect(
      screen
        .getByRole("button", { name: "Hide Talking points" })
        .hasAttribute("disabled")
    ).toBe(true)
    expect(
      screen
        .getByRole("button", { name: "Pin Talking points" })
        .hasAttribute("disabled")
    ).toBe(true)
    expect(
      screen.queryByRole("button", { name: /submit founder input/i })
    ).toBeNull()
    view.unmount()
  })

  it("keeps context preferences interactive after founder submission", () => {
    const view = render(
      <UnifiedContextCanvas
        request={{ ...request, lifecycle: "founder_complete" }}
        requestActive
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
        draftController={{
          text: "Submitted founder input",
          status: "Saved",
          canUndo: false,
          canRedo: false,
          history: null,
          archiveEntries: [],
          archiveDone: true,
          readOnly: true,
          onTextChange: vi.fn(),
          onUndo: vi.fn(),
          onRedo: vi.fn(),
          onLoadOlderHistory: vi.fn(),
          onRestoreArchivedVersion: vi.fn(),
        }}
      />
    )
    expandFounderEditor()
    expect(screen.queryByText(/inactive.*read-only/i)).toBeNull()
    expect(
      screen
        .getByRole("button", { name: "Hide Talking points" })
        .hasAttribute("disabled")
    ).toBe(false)
    expect(
      screen
        .getByRole("button", { name: "Pin Talking points" })
        .hasAttribute("disabled")
    ).toBe(false)
    expect(
      (
        screen.getByRole("textbox", {
          name: "Founder input",
        }) as HTMLTextAreaElement
      ).readOnly
    ).toBe(true)
    view.unmount()
  })

  it("uses one controlled offline editor with component-backed undo and redo", () => {
    const onTextChange = vi.fn()
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    const onLoadOlderHistory = vi.fn()
    const onRestoreArchivedVersion = vi.fn()
    const view = render(
      <UnifiedContextCanvas
        request={{ ...request, humanId: "CR-OFFLINE-CONTROLLED" }}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
        draftController={{
          text: "Recovered offline input",
          status: "Offline",
          canUndo: true,
          canRedo: false,
          history: {
            canUndo: true,
            canRedo: false,
            position: 0,
            length: 1,
            entries: [
              {
                position: 0,
                state: {
                  actorPrincipalId: "founder-1",
                  actorSubject: "Elie",
                  correlationId: "durable-edit-1",
                  occurredAt: Date.UTC(2026, 6, 18, 12, 0),
                },
              },
            ],
          },
          archiveEntries: [
            {
              versionId: "archived-version-1",
              revision: 1,
              actorPrincipalId: "founder-1",
              actorSubject: "Elie",
              correlationId: "archived-edit-1",
              occurredAt: Date.UTC(2026, 6, 17, 12, 0),
            },
          ],
          archiveDone: false,
          onTextChange,
          onUndo,
          onRedo,
          onLoadOlderHistory,
          onRestoreArchivedVersion,
        }}
      />
    )

    expandFounderEditor()
    const editor = screen.getByRole("textbox", { name: "Founder input" })
    expect((editor as HTMLTextAreaElement).value).toBe(
      "Recovered offline input"
    )
    expect(screen.getByRole("status").textContent).toBe("Offline")
    fireEvent.change(editor, { target: { value: "Local edit" } })
    expect(onTextChange).toHaveBeenCalledWith("Local edit")
    fireEvent.click(screen.getByRole("button", { name: "Undo founder input" }))
    expect(onUndo).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: "History (1)" }))
    expect(
      screen.getByRole("list", { name: "Founder input version history" })
        .textContent
    ).toContain("Elie · version 1")
    const restoreArchived = screen.getByRole("button", { name: "Restore" })
    const loadOlder = screen.getByRole("button", {
      name: "Load older versions",
    })
    expect(restoreArchived.className).toContain("h-11")
    expect(loadOlder.className).toContain("h-11")
    fireEvent.click(restoreArchived)
    expect(onRestoreArchivedVersion).toHaveBeenCalledWith("archived-version-1")
    fireEvent.click(loadOlder)
    expect(onLoadOlderHistory).toHaveBeenCalledOnce()
    expect(
      screen
        .getByRole("button", { name: "Redo founder input" })
        .hasAttribute("disabled")
    ).toBe(true)
    expect(
      screen.getAllByRole("textbox", { name: "Founder input" })
    ).toHaveLength(1)
    view.unmount()
  })

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
    expect(
      screen.getAllByRole("textbox", {
        name: "Founder input",
      })
    ).toHaveLength(1)
    expect(
      screen.getByTestId("founder-editor-body").hasAttribute("inert")
    ).toBe(false)
    expect(
      screen.getByTestId("founder-editor").getAttribute("data-detent")
    ).toBe("peek")

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
    expect(screen.getByRole("textbox", { name: "Founder input" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Collapse editor" }))
    expect(
      screen.getByTestId("founder-editor").getAttribute("data-expanded")
    ).toBe("false")
    expect(
      screen.getAllByRole("textbox", {
        name: "Founder input",
      })
    ).toHaveLength(1)
  })

  it("keeps founder input visible at peek and through drawer detent changes", () => {
    render(
      <UnifiedContextCanvas
        request={request}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
      />
    )

    const body = screen.getByTestId("founder-editor-body")
    const input = screen.getByRole("textbox", { name: "Founder input" })

    expect(body.hasAttribute("inert")).toBe(false)
    expect(body.hasAttribute("aria-hidden")).toBe(false)
    fireEvent.focus(input)
    expect(
      screen.getByTestId("founder-editor").getAttribute("data-detent")
    ).toBe("compose")
    expect(screen.getByRole("textbox", { name: "Founder input" })).toBe(input)
    fireEvent.click(screen.getByRole("button", { name: "Collapse editor" }))
    expect(
      screen.getByTestId("founder-editor").getAttribute("data-detent")
    ).toBe("peek")
    expect(screen.getByRole("textbox", { name: "Founder input" })).toBe(input)
    expect(body.hasAttribute("inert")).toBe(false)
    expect(body.hasAttribute("aria-hidden")).toBe(false)
  })

  it("keeps the document interactive while the non-modal drawer is open", async () => {
    render(
      <UnifiedContextCanvas
        request={request}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
      />
    )

    expect(
      screen.getByTestId("founder-editor-drawer").getAttribute("data-detent")
    ).toBe("peek")
    expect(document.querySelector('[data-slot="drawer-overlay"]')).toBeNull()
    expect(
      screen
        .getByRole("main", { name: "Content Request workspace" })
        .hasAttribute("aria-hidden")
    ).toBe(false)
    await waitFor(() => expect(document.body.style.pointerEvents).toBe("auto"))

    expandFounderEditor()
    expect(
      screen.getByTestId("founder-editor").getAttribute("data-detent")
    ).toBe("full")
    fireEvent.click(
      screen.getByRole("button", { name: "Hide Research required" })
    )
    expect(
      screen.queryByRole("article", { name: "Research required" })
    ).toBeNull()
  })

  it("renders original source markdown as structured, accessible content", () => {
    render(
      <UnifiedContextCanvas
        request={{
          ...request,
          humanId: "CR-MARKDOWN-SOURCE",
          source: {
            ...request.source,
            body: `### Paying off an Ontario mortgage

- **Thread:** [What happens after paying off a mortgage?](https://community.example/mortgage)
- **Question:** What administrative steps remain?`,
          },
        }}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
      />
    )

    const sourceCard = screen.getByRole("article", { name: "Original source" })
    expect(
      within(sourceCard).getByRole("heading", {
        level: 3,
        name: "Paying off an Ontario mortgage",
      })
    ).toBeTruthy()
    expect(within(sourceCard).getByText("Thread:").tagName).toBe("STRONG")
    expect(
      within(sourceCard)
        .getByRole("link", {
          name: "What happens after paying off a mortgage?",
        })
        .getAttribute("rel")
    ).toBe("noopener noreferrer")
    expect(sourceCard.textContent).not.toContain("###")
    expect(sourceCard.textContent).not.toContain("**")
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
    render(
      <UnifiedContextCanvas
        request={{ ...request, humanId: "CR-AUTOSAVE" }}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
        initialDraft="Restored durable founder text"
        onDraftSave={onDraftSave}
      />
    )
    expandFounderEditor()
    const editor = screen.getByRole("textbox", {
      name: "Founder input",
    })
    expect((editor as HTMLTextAreaElement).value).toBe(
      "Restored durable founder text"
    )
    fireEvent.change(editor, {
      target: { value: "Restored durable founder text plus a new point" },
    })
    expect(screen.getByText("Saving", { exact: true })).toBeTruthy()
    expect(
      (
        screen.getByRole("textbox", {
          name: "Founder input",
        }) as HTMLTextAreaElement
      ).value
    ).toBe("Restored durable founder text plus a new point")
    await waitFor(() => expect(onDraftSave).toHaveBeenCalledOnce())
    finishSave?.()
    await waitFor(() =>
      expect(screen.getByText("Saved", { exact: true })).toBeTruthy()
    )

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })
    fireEvent(window, new Event("offline"))
    fireEvent.change(editor, { target: { value: "An offline edit" } })
    expect(screen.getByText("Offline", { exact: true })).toBeTruthy()
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
    expandFounderEditor()
    fireEvent.change(screen.getByRole("textbox", { name: "Founder input" }), {
      target: { value: "A save that encounters a transient outage" },
    })
    await waitFor(
      () =>
        expect(screen.getByText("Save pending", { exact: true })).toBeTruthy(),
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
    expandFounderEditor()
    fireEvent.change(screen.getByRole("textbox", { name: "Founder input" }), {
      target: { value: "A draft after an ownership conflict" },
    })
    await waitFor(() =>
      expect(screen.getByText("Save blocked", { exact: true })).toBeTruthy()
    )
    expect(onDraftSave).toHaveBeenCalledOnce()
    view.unmount()
  })

  it("keeps submitted founder input and archived restore controls read-only", () => {
    const restore = vi.fn()
    render(
      <UnifiedContextCanvas
        request={{ ...request, lifecycle: "founder_complete" }}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
        draftController={{
          text: "Submitted founder input",
          status: "Saved",
          canUndo: true,
          canRedo: true,
          history: null,
          archiveEntries: [
            {
              versionId: "archived-1",
              revision: 1,
              actorPrincipalId: "founder-1",
              actorSubject: "Elie",
              correlationId: "archive-1",
              occurredAt: Date.now(),
            },
          ],
          archiveDone: true,
          readOnly: true,
          onTextChange: vi.fn(),
          onUndo: vi.fn(),
          onRedo: vi.fn(),
          onLoadOlderHistory: vi.fn(),
          onRestoreArchivedVersion: restore,
        }}
      />
    )
    expandFounderEditor()
    expect(
      screen
        .getByRole("textbox", { name: "Founder input" })
        .hasAttribute("readonly")
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "History (0)" }))
    expect(
      screen.getByRole("button", { name: "Restore" }).hasAttribute("disabled")
    ).toBe(true)
    expect(restore).not.toHaveBeenCalled()
  })

  it("uses the entire idle voice surface as the accessible record control", () => {
    const start = vi.fn()
    render(
      <UnifiedContextCanvas
        request={request}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
        draftController={{
          text: "",
          status: "Saved",
          canUndo: false,
          canRedo: false,
          history: null,
          archiveEntries: [],
          archiveDone: true,
          onTextChange: vi.fn(),
          onUndo: vi.fn(),
          onRedo: vi.fn(),
          onLoadOlderHistory: vi.fn(),
          onRestoreArchivedVersion: vi.fn(),
          voice: {
            supported: true,
            state: "idle",
            elapsedMs: 0,
            errorCode: null,
            queuedCount: 0,
            captures: [],
            start,
            pause: vi.fn(),
            resume: vi.fn(),
            stop: vi.fn(),
            retry: vi.fn(),
            discard: vi.fn(),
            discardPending: vi.fn(),
          },
        }}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Record input" }))
    const editor = screen.getByTestId("founder-editor")
    const input = document.querySelector(".unified-editor__input")
    const recordSurface = screen.getByRole("button", {
      name: "Press to record",
    })

    expect(editor.getAttribute("data-input-mode")).toBe("record")
    expect(recordSurface.parentElement).toBe(input)
    expect(recordSurface.textContent).toContain("Press to record")
    expect(recordSurface.textContent).toContain("Tap anywhere in this area")
    expect(recordSurface.querySelector("button")).toBeNull()
    fireEvent.click(recordSurface)
    expect(start).toHaveBeenCalledOnce()
  })

  it("keeps active recording actions explicit and keyboard-sized", () => {
    const pause = vi.fn()
    const stop = vi.fn()
    render(
      <UnifiedContextCanvas
        request={request}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
        draftController={{
          text: "A typed point remains safe",
          status: "Saved",
          canUndo: false,
          canRedo: false,
          history: null,
          archiveEntries: [],
          archiveDone: true,
          onTextChange: vi.fn(),
          onUndo: vi.fn(),
          onRedo: vi.fn(),
          onLoadOlderHistory: vi.fn(),
          onRestoreArchivedVersion: vi.fn(),
          voice: {
            supported: true,
            state: "recording",
            elapsedMs: 65_000,
            errorCode: null,
            queuedCount: 0,
            captures: [],
            start: vi.fn(),
            pause,
            resume: vi.fn(),
            stop,
            retry: vi.fn(),
            discard: vi.fn(),
            discardPending: vi.fn(),
          },
        }}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Record input" }))
    expect(screen.getByText("Recording", { exact: true })).toBeTruthy()
    expect(screen.getByLabelText("01:05 elapsed")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Pause recording" }))
    fireEvent.click(screen.getByRole("button", { name: "Stop and save" }))
    expect(pause).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
  })

  it("blocks founder submission while local voice work is pending", () => {
    const submit = vi.fn()
    render(
      <UnifiedContextCanvas
        request={request}
        contextItems={context}
        preferenceOwnerKey="org-fairlend:founder-1"
        onSubmitFounderInput={submit}
        draftController={{
          text: "Ready typed input",
          status: "Saved",
          canUndo: false,
          canRedo: false,
          history: null,
          archiveEntries: [],
          archiveDone: true,
          onTextChange: vi.fn(),
          onUndo: vi.fn(),
          onRedo: vi.fn(),
          onLoadOlderHistory: vi.fn(),
          onRestoreArchivedVersion: vi.fn(),
          voice: {
            supported: true,
            state: "saving",
            elapsedMs: 0,
            errorCode: null,
            queuedCount: 1,
            captures: [
              {
                captureId: "voice-failed-1",
                status: "failed",
                failureCode: "TRANSCRIPTION_FAILED",
                transcriptMergedAt: null,
                discardedAt: null,
              },
            ],
            start: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
            stop: vi.fn(),
            retry: vi.fn(),
            discard: vi.fn(),
            discardPending: vi.fn(),
          },
        }}
      />
    )
    expandFounderEditor()
    expect(
      screen.getByText(
        "Finish, retry, or discard pending voice input before submitting."
      )
    ).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "Submit to drafting" })
        .hasAttribute("disabled")
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Record input" }))
    expect(
      screen.getByRole("button", {
        name: /Retry transcription/,
      }).className
    ).toContain("h-11")
    expect(
      screen.getByRole("button", { name: "Discard recording" }).className
    ).toContain("h-11")
  })
})
