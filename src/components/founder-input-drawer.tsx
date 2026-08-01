import { useEffect, useRef, useState, type RefObject } from "react"
import { Maximize2, Minimize2, Redo2, ScrollText, Undo2 } from "lucide-react"

import type {
  FounderArchivedVersion,
  FounderVersionHistory,
} from "@/application/content-requests"
import {
  FounderVoiceRecorder,
  type FounderVoiceController,
} from "@/components/founder-voice-recorder"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const PEEK_SNAP_POINT = "160px"
const COMPOSE_SNAP_POINT = 0.56
const FULL_SNAP_POINT = 0.92
const SNAP_POINTS = [PEEK_SNAP_POINT, COMPOSE_SNAP_POINT, FULL_SNAP_POINT]

type DrawerSnapPoint = number | string | null
type InputMode = "type" | "record"
type SaveStatus =
  | "Saved"
  | "Saving"
  | "Offline"
  | "Save pending"
  | "Save blocked"

export type FounderDraftController = {
  text: string
  status: SaveStatus
  canUndo: boolean
  canRedo: boolean
  history: FounderVersionHistory | null
  archiveEntries: Array<FounderArchivedVersion>
  archiveDone: boolean
  readOnly?: boolean
  onTextChange(text: string): void
  onUndo(): void | Promise<void>
  onRedo(): void | Promise<void>
  onLoadOlderHistory(): void | Promise<void>
  onRestoreArchivedVersion(versionId: string): void | Promise<void>
  voice?: FounderVoiceController
}

function detentFor(snapPoint: DrawerSnapPoint) {
  if (snapPoint === PEEK_SNAP_POINT || snapPoint === null) return "peek"
  if (snapPoint === COMPOSE_SNAP_POINT) return "compose"
  return "full"
}

export function FounderInputDrawer({
  controller,
  draft,
  editorReadOnly,
  editorRef,
  hydrated,
  inputMode,
  onInputModeChange,
  onTextChange,
  onSubmitFounderInput,
  saveStatus,
  voicePending,
}: {
  draft: string
  editorReadOnly: boolean
  editorRef: RefObject<HTMLTextAreaElement | null>
  hydrated: boolean
  inputMode: InputMode
  onInputModeChange(mode: InputMode): void
  onTextChange(text: string): void
  onSubmitFounderInput?: () => Promise<void>
  saveStatus: SaveStatus
  voicePending: boolean
  controller?: FounderDraftController
}) {
  const [activeSnapPoint, setActiveSnapPoint] =
    useState<DrawerSnapPoint>(PEEK_SNAP_POINT)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const [drawerElement, setDrawerElement] = useState<HTMLDivElement | null>(
    null
  )
  const modeControlsRef = useRef<HTMLDivElement>(null)
  const detent = detentFor(activeSnapPoint)
  const expanded = detent !== "peek"

  useEffect(() => {
    if (!drawerElement || !window.visualViewport) return

    const activeDrawer: HTMLDivElement = drawerElement
    const activeViewport: VisualViewport = window.visualViewport

    let frame: number | null = null

    function syncKeyboardInset() {
      if (frame !== null) window.cancelAnimationFrame(frame)

      frame = window.requestAnimationFrame(() => {
        frame = null

        const activeElement = document.activeElement
        const inputFocused =
          activeElement instanceof HTMLElement &&
          activeDrawer.contains(activeElement) &&
          activeElement.matches("input, textarea, [contenteditable='true']")
        const keyboardInset = inputFocused
          ? Math.max(
              0,
              window.innerHeight -
                activeViewport.height -
                activeViewport.offsetTop
            )
          : 0

        activeDrawer.style.setProperty(
          "--founder-keyboard-inset",
          `${Math.round(keyboardInset)}px`
        )
        activeDrawer.dataset.keyboardAnchored = String(
          inputFocused && keyboardInset > 0
        )
      })
    }

    activeViewport.addEventListener("resize", syncKeyboardInset)
    activeViewport.addEventListener("scroll", syncKeyboardInset)
    window.addEventListener("scroll", syncKeyboardInset, { passive: true })
    document.addEventListener("focusin", syncKeyboardInset)
    document.addEventListener("focusout", syncKeyboardInset)
    syncKeyboardInset()

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      activeViewport.removeEventListener("resize", syncKeyboardInset)
      activeViewport.removeEventListener("scroll", syncKeyboardInset)
      window.removeEventListener("scroll", syncKeyboardInset)
      document.removeEventListener("focusin", syncKeyboardInset)
      document.removeEventListener("focusout", syncKeyboardInset)
      activeDrawer.style.removeProperty("--founder-keyboard-inset")
      delete activeDrawer.dataset.keyboardAnchored
    }
  }, [drawerElement])

  function expandTo(snapPoint: DrawerSnapPoint = FULL_SNAP_POINT) {
    setActiveSnapPoint(snapPoint)
  }

  function collapse() {
    setActiveSnapPoint(PEEK_SNAP_POINT)
    setHistoryOpen(false)
    window.setTimeout(() => {
      modeControlsRef.current
        ?.querySelector<HTMLButtonElement>("[aria-pressed='true']")
        ?.focus()
    }, 0)
  }

  return (
    <Drawer
      open
      modal={false}
      dismissible={false}
      fixed
      noBodyStyles
      disablePreventScroll
      shouldScaleBackground={false}
      autoFocus={false}
      snapPoints={SNAP_POINTS}
      activeSnapPoint={activeSnapPoint}
      setActiveSnapPoint={(next) => {
        if (next !== null) setActiveSnapPoint(next)
      }}
      snapToSequentialPoint
      repositionInputs={false}
    >
      <DrawerContent
        ref={setDrawerElement}
        className="founder-input-drawer"
        showHandle={false}
        showOverlay={false}
        data-detent={detent}
        data-testid="founder-editor-drawer"
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          if (expanded) collapse()
        }}
      >
        <DrawerTitle className="sr-only">Founder input</DrawerTitle>
        <DrawerDescription className="sr-only">
          Add typed or recorded perspective while keeping the context document
          available.
        </DrawerDescription>
        <section
          className="unified-editor"
          id="founder-editor"
          data-testid="founder-editor"
          data-expanded={String(expanded)}
          data-detent={detent}
          data-input-mode={inputMode}
          data-voice-state={controller?.voice?.state}
          aria-label="Founder input editor"
        >
          <DrawerHandle
            className="unified-editor__handle"
            aria-label="Resize founder input drawer"
          />
          <div className="unified-editor__toolbar">
            <ToggleGroup
              ref={modeControlsRef}
              className="unified-editor__modes"
              aria-label="Input method"
              disabled={!hydrated || editorReadOnly}
              value={[inputMode]}
              onValueChange={(values) => {
                const next = values[0]
                if (next !== "type" && next !== "record") return
                onInputModeChange(next)
                if (!expanded) {
                  setActiveSnapPoint(COMPOSE_SNAP_POINT)
                }
              }}
            >
              <ToggleGroupItem value="type" aria-label="Type input">
                Type
              </ToggleGroupItem>
              <ToggleGroupItem value="record" aria-label="Record input">
                Record
              </ToggleGroupItem>
            </ToggleGroup>
            <span
              className="unified-editor__save-status"
              data-state={saveStatus.toLowerCase()}
              role="status"
              aria-live="polite"
            >
              {saveStatus}
            </span>
            {controller ? (
              <div
                className="unified-editor__history-controls"
                aria-label="Version history"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Undo founder input"
                  disabled={!controller.canUndo || controller.readOnly}
                  onClick={() => {
                    if (!controller.readOnly) void controller.onUndo()
                  }}
                >
                  <Undo2 />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Redo founder input"
                  disabled={!controller.canRedo || controller.readOnly}
                  onClick={() => {
                    if (!controller.readOnly) void controller.onRedo()
                  }}
                >
                  <Redo2 />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`History (${controller.history?.length ?? 0})`}
                  aria-expanded={historyOpen}
                  aria-controls="founder-version-history"
                  onClick={() => {
                    setHistoryOpen((current) => !current)
                    setActiveSnapPoint(FULL_SNAP_POINT)
                  }}
                >
                  <ScrollText />
                  <span className="unified-editor__history-label">
                    History ({controller.history?.length ?? 0})
                  </span>
                </Button>
              </div>
            ) : null}
            <Button
              type="button"
              className="unified-editor__expand"
              variant="ghost"
              size="icon-sm"
              aria-expanded={expanded}
              aria-controls="founder-editor-body"
              aria-label={expanded ? "Collapse editor" : "Expand editor"}
              onClick={() => (expanded ? collapse() : expandTo())}
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
              <span className="unified-editor__expand-label">
                {expanded ? "Collapse" : "Expand"}
              </span>
            </Button>
          </div>
          <div
            id="founder-editor-body"
            className="unified-editor__body"
            data-testid="founder-editor-body"
          >
            {controller && historyOpen ? (
              <ol
                id="founder-version-history"
                className="unified-editor__version-history"
                aria-label="Founder input version history"
              >
                {controller.history?.entries.map((entry) => (
                  <li
                    key={`${entry.position}-${entry.state.correlationId}`}
                    aria-current={
                      controller.history?.position === entry.position
                        ? "step"
                        : undefined
                    }
                  >
                    <span>
                      {entry.state.actorSubject} · version {entry.position + 1}
                    </span>
                    <time
                      dateTime={new Date(entry.state.occurredAt).toISOString()}
                    >
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(entry.state.occurredAt)}
                    </time>
                  </li>
                ))}
                {controller.history?.entries.length === 0 ? (
                  <li>No durable versions yet.</li>
                ) : null}
                {controller.archiveEntries.map((entry) => (
                  <li key={`archive-${entry.versionId}`}>
                    <span>
                      {entry.actorSubject} · archived revision {entry.revision}
                    </span>
                    <time dateTime={new Date(entry.occurredAt).toISOString()}>
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(entry.occurredAt)}
                    </time>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm-touch"
                      disabled={controller.readOnly}
                      onClick={() =>
                        !controller.readOnly &&
                        void controller.onRestoreArchivedVersion(
                          entry.versionId
                        )
                      }
                    >
                      Restore
                    </Button>
                  </li>
                ))}
                {!controller.archiveDone ? (
                  <li>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm-touch"
                      onClick={() => void controller.onLoadOlderHistory()}
                    >
                      Load older versions
                    </Button>
                  </li>
                ) : null}
              </ol>
            ) : null}
            <div className="unified-editor__input">
              {inputMode === "type" ? (
                <Textarea
                  ref={editorRef}
                  aria-label="Founder input"
                  value={draft}
                  readOnly={controller?.readOnly}
                  onChange={(event) => onTextChange(event.target.value)}
                  placeholder="Add your perspective…"
                />
              ) : (
                <FounderVoiceRecorder
                  voice={controller?.voice}
                  readOnly={controller?.readOnly}
                />
              )}
            </div>
            {onSubmitFounderInput ? (
              <div
                className="unified-editor__submit-row"
                inert={!expanded}
                aria-hidden={!expanded}
              >
                <span role="status" aria-live="polite">
                  {submitError
                    ? "Submission failed. Your input remains saved."
                    : voicePending
                      ? "Finish, retry, or discard pending voice input before submitting."
                      : "Submit when your perspective is complete."}
                </span>
                <Button
                  type="button"
                  disabled={
                    submitting ||
                    saveStatus !== "Saved" ||
                    !draft.trim() ||
                    voicePending
                  }
                  onClick={async () => {
                    setSubmitting(true)
                    setSubmitError(false)
                    try {
                      await onSubmitFounderInput()
                    } catch {
                      setSubmitError(true)
                    } finally {
                      setSubmitting(false)
                    }
                  }}
                >
                  {submitting ? "Submitting…" : "Submit to drafting"}
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      </DrawerContent>
    </Drawer>
  )
}
