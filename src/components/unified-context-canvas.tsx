import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  BookOpen,
  Check,
  CircleAlert,
  ExternalLink,
  FileCheck2,
  FileText,
  Link2,
  Maximize2,
  Mic,
  Minimize2,
  Pause,
  Pin,
  Play,
  Redo2,
  RotateCcw,
  ScrollText,
  Sparkles,
  Square,
  Undo2,
} from "lucide-react"

import type {
  ContentContextItem,
  ContentRequest,
  ContextDeckPreferences,
  FounderArchivedVersion,
  FounderVersionHistory,
} from "@/application/content-requests"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

type CanvasItem = ContentContextItem & {
  id: string
  eyebrow: string
  icon: typeof BookOpen
}

type PreferenceWrite = {
  preferences: ContextDeckPreferences
  correlationId: string
  ownerKey: string
}

type DraftWrite = {
  text: string
  correlationId: string
  version: number
}

function draftSaveErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data
  ) {
    return String(error.data.code)
  }
  return null
}

function isRetryableDraftSaveError(error: unknown) {
  if (error instanceof TypeError) return true
  const code = draftSaveErrorCode(error)
  return ![
    "UNAUTHENTICATED",
    "AUTHORIZATION_NOT_CONFIGURED",
    "PRINCIPAL_NOT_PROVISIONED",
    "ORGANIZATION_ACCESS_DENIED",
    "ROLE_ACCESS_DENIED",
    "RESOURCE_ACCESS_DENIED",
    "FOUNDER_INPUT_HANDOFF_REQUIRED",
    "NOT_FOUND",
    "VALIDATION_FAILED",
    "IDEMPOTENCY_KEY_REUSED",
  ].includes(String(code))
}

const presentation: Record<
  ContentContextItem["kind"],
  { eyebrow: string; icon: typeof BookOpen }
> = {
  source_metadata: { eyebrow: "Source", icon: ScrollText },
  source_summary: { eyebrow: "Source brief", icon: BookOpen },
  talking_points: { eyebrow: "Prepared for you", icon: Sparkles },
  research_requirements: { eyebrow: "Research required", icon: FileCheck2 },
  missing_research: { eyebrow: "Still unknown", icon: CircleAlert },
  citations: { eyebrow: "Evidence pack", icon: Link2 },
  guardrails: { eyebrow: "Keep in mind", icon: CircleAlert },
  operator_cue: { eyebrow: "Operator cue", icon: ScrollText },
  delivery_hint: { eyebrow: "Suggested delivery", icon: ExternalLink },
}

function contextItemsFor(
  request: ContentRequest,
  contextItems: Array<ContentContextItem>
) {
  const sourceItems: Array<CanvasItem> = []
  if (request.source?.question) {
    sourceItems.push({
      id: "original-question",
      contextId: "original-question",
      kind: "source_summary",
      title: "Original question",
      eyebrow: "The ask",
      icon: BookOpen,
      bulletPoints: [request.source.question],
      citations:
        request.source.url && !request.source.body
          ? [
              {
                label: request.source.name ?? "Open original source",
                url: request.source.url,
                supports: "Immutable original source",
              },
            ]
          : [],
    })
  }
  if (request.source?.body) {
    sourceItems.push({
      id: "original-source-body",
      contextId: "original-source-body",
      kind: "source_summary",
      title: "Original source",
      eyebrow: request.source.channel ?? "Source material",
      icon: ScrollText,
      bulletPoints: [request.source.body],
      citations: request.source.url
        ? [
            {
              label: request.source.name ?? "Open original source",
              url: request.source.url,
              supports: "Immutable original source",
            },
          ]
        : [],
    })
  }
  if (request.source?.url && !request.source.body && !request.source.question) {
    sourceItems.push({
      id: "original-source-link",
      contextId: "original-source-link",
      kind: "source_metadata",
      title: "Original source",
      eyebrow: request.source.channel ?? "Source material",
      icon: Link2,
      bulletPoints: [],
      citations: [
        {
          label: request.source.name ?? "Open original source",
          url: request.source.url,
          supports: "Immutable original source",
        },
      ],
    })
  }
  return [
    ...sourceItems,
    ...contextItems.map((item) => ({
      ...item,
      id: item.contextId,
      ...presentation[item.kind],
    })),
  ]
}

function ContextCard({
  item,
  pinned,
  onTogglePin,
}: {
  item: CanvasItem
  pinned: boolean
  onTogglePin(): void
}) {
  const Icon = item.icon
  return (
    <article
      aria-label={item.title}
      data-pinned={String(pinned)}
      className={cn("unified-context-card", pinned && "is-pinned")}
    >
      <div className="unified-context-card__header">
        <span className="unified-context-card__icon" aria-hidden="true">
          <Icon />
        </span>
        <div>
          <p>{item.eyebrow}</p>
          <h2>{item.title}</h2>
        </div>
        <Button
          type="button"
          size="icon-lg"
          variant="ghost"
          aria-label={`${pinned ? "Unpin" : "Pin"} ${item.title} card`}
          aria-pressed={pinned}
          onClick={onTogglePin}
        >
          <Pin className={cn(pinned && "fill-current")} />
        </Button>
      </div>
      {item.bulletPoints.length > 0 ? (
        <div className="unified-context-card__content">
          {item.bulletPoints.map((point, index) => (
            <div key={`${item.id}-${index}`} className="unified-context-point">
              {item.bulletPoints.length > 1 ? <span>{index + 1}</span> : null}
              <p>{point}</p>
            </div>
          ))}
        </div>
      ) : null}
      {item.citations.length > 0 ? (
        <div className="unified-context-card__citations">
          {item.citations.map((citation) => (
            <a
              key={`${citation.url}-${citation.label}`}
              href={citation.url}
              target="_blank"
              rel="noreferrer"
            >
              <Check aria-hidden="true" />
              <span>
                <strong>{citation.label}</strong>
                <small>{citation.supports}</small>
              </span>
              <ExternalLink aria-hidden="true" />
            </a>
          ))}
        </div>
      ) : null}
    </article>
  )
}

export function UnifiedContextCanvas({
  request,
  contextItems,
  preferenceOwnerKey,
  initialDraft = "",
  initialPreferences,
  onPreferencesChange,
  onDraftSave,
  onSubmitFounderInput,
  draftController,
}: {
  request: ContentRequest
  contextItems: Array<ContentContextItem>
  preferenceOwnerKey: string
  initialDraft?: string
  initialPreferences?: ContextDeckPreferences | null
  onPreferencesChange?: (
    preferences: ContextDeckPreferences,
    correlationId: string
  ) => void | Promise<void>
  onDraftSave?: (text: string, correlationId: string) => Promise<unknown>
  onSubmitFounderInput?: () => Promise<void>
  draftController?: {
    text: string
    status: "Saved" | "Saving" | "Offline" | "Save pending" | "Save blocked"
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
    voice?: {
      supported: boolean
      state:
        | "idle"
        | "requesting"
        | "recording"
        | "paused"
        | "saving"
        | "transcribing"
        | "failed"
      elapsedMs: number
      errorCode: string | null
      queuedCount: number
      captures: Array<{
        captureId: string
        status: "uploaded" | "transcribing" | "transcribed" | "failed"
        failureCode: string | null
        transcriptMergedAt: number | null
        discardedAt: number | null
      }>
      start(): void | Promise<void>
      pause(): void
      resume(): void
      stop(): void | Promise<void>
      retry(captureId?: string): void | Promise<void>
      discard(captureId: string): void | Promise<void>
      discardPending(): void | Promise<void>
    }
  }
}) {
  const items = useMemo(
    () => contextItemsFor(request, contextItems),
    [contextItems, request]
  )
  const itemIds = useMemo(() => items.map((item) => item.id), [items])
  const [visible, setVisible] = useState<Array<string>>(() => {
    if (!initialPreferences) return itemIds
    const newlyAvailable = itemIds.filter(
      (id) => !initialPreferences.knownContextIds.includes(id)
    )
    return [
      ...new Set([...initialPreferences.visibleContextIds, ...newlyAvailable]),
    ]
  })
  const [pinned, setPinned] = useState<Array<string>>(() =>
    initialPreferences
      ? initialPreferences.pinnedContextIds
      : items
          .filter((item) => item.kind === "operator_cue")
          .map((item) => item.id)
  )
  const [expanded, setExpanded] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [inputMode, setInputMode] = useState<"type" | "record">("type")
  const [draft, setDraft] = useState(initialDraft)
  const [saveStatus, setSaveStatus] = useState<
    "Saved" | "Saving" | "Offline" | "Save pending" | "Save blocked"
  >("Saved")
  const displayedSaveStatus = draftController?.status ?? saveStatus
  const displayedDraft = draftController?.text ?? draft
  const voicePending = Boolean(
    draftController?.voice &&
    (draftController.voice.queuedCount > 0 ||
      ["recording", "paused", "requesting", "saving", "transcribing"].includes(
        draftController.voice.state
      ) ||
      draftController.voice.captures.some(
        (capture) =>
          !capture.discardedAt &&
          (capture.status !== "transcribed" || !capture.transcriptMergedAt)
      ))
  )
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const filterPinRefs = useRef(new Map<string, HTMLButtonElement>())
  const preferencesMounted = useRef(false)
  const componentMounted = useRef(false)
  const preferenceTimer = useRef<number | null>(null)
  const latestPreferenceWrite = useRef<PreferenceWrite | null>(null)
  const preferenceCallback = useRef(onPreferencesChange)
  const preferenceWriteChain = useRef<Promise<void>>(Promise.resolve())
  const draftMounted = useRef(false)
  const draftTimer = useRef<number | null>(null)
  const draftRetryTimer = useRef<number | null>(null)
  const draftVersion = useRef(0)
  const latestDraftWrite = useRef<DraftWrite | null>(null)
  const draftSaveCallback = useRef(onDraftSave)
  const draftWriteChain = useRef<Promise<void>>(Promise.resolve())
  const draftPersist = useRef<(write: DraftWrite) => void>(() => undefined)
  const [preferenceSyncFailed, setPreferenceSyncFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const preferenceStorageKey = `fairlend:context-preferences:${encodeURIComponent(preferenceOwnerKey)}:${request.humanId}`

  useEffect(() => {
    preferenceCallback.current = onPreferencesChange
  }, [onPreferencesChange])

  useEffect(() => {
    draftSaveCallback.current = onDraftSave
  }, [onDraftSave])

  const persistDraftWrite = useCallback((write: DraftWrite) => {
    const callback = draftSaveCallback.current
    if (!callback) return
    if (!window.navigator.onLine) {
      if (componentMounted.current) setSaveStatus("Offline")
      return
    }
    if (draftRetryTimer.current !== null) {
      window.clearTimeout(draftRetryTimer.current)
      draftRetryTimer.current = null
    }
    draftWriteChain.current = draftWriteChain.current.then(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await callback(write.text, write.correlationId)
          if (latestDraftWrite.current?.version === write.version) {
            latestDraftWrite.current = null
            if (componentMounted.current) setSaveStatus("Saved")
          }
          return
        } catch (error) {
          if (!isRetryableDraftSaveError(error)) {
            if (componentMounted.current) setSaveStatus("Save blocked")
            return
          }
          if (attempt < 2 && window.navigator.onLine) {
            await new Promise((resolve) =>
              window.setTimeout(resolve, 300 * 2 ** attempt)
            )
          }
        }
      }
      if (componentMounted.current) {
        if (window.navigator.onLine) {
          setSaveStatus("Save pending")
          draftRetryTimer.current = window.setTimeout(() => {
            draftRetryTimer.current = null
            if (latestDraftWrite.current) {
              setSaveStatus("Saving")
              draftPersist.current(latestDraftWrite.current)
            }
          }, 5_000)
        } else {
          setSaveStatus("Offline")
        }
      }
    })
  }, [])

  useEffect(() => {
    draftPersist.current = persistDraftWrite
  }, [persistDraftWrite])

  const persistPreferenceWrite = useCallback(
    (write: PreferenceWrite) => {
      const callback = preferenceCallback.current
      if (!callback) return
      preferenceWriteChain.current = preferenceWriteChain.current.then(
        async () => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              await callback(write.preferences, write.correlationId)
              if (
                latestPreferenceWrite.current?.correlationId ===
                write.correlationId
              ) {
                latestPreferenceWrite.current = null
              }
              try {
                const retained =
                  window.localStorage.getItem(preferenceStorageKey)
                const retainedWrite = retained
                  ? (JSON.parse(retained) as PreferenceWrite)
                  : null
                if (
                  retainedWrite?.correlationId === write.correlationId &&
                  retainedWrite.ownerKey === preferenceOwnerKey
                ) {
                  window.localStorage.removeItem(preferenceStorageKey)
                }
              } catch {
                // Storage is an optional recovery layer; the durable write won.
              }
              if (componentMounted.current) setPreferenceSyncFailed(false)
              return
            } catch {
              if (attempt < 2) {
                await new Promise((resolve) =>
                  window.setTimeout(resolve, 250 * 2 ** attempt)
                )
              }
            }
          }
          if (componentMounted.current) setPreferenceSyncFailed(true)
        }
      )
    },
    [preferenceOwnerKey, preferenceStorageKey]
  )

  useEffect(() => {
    componentMounted.current = true
    try {
      const retained = window.localStorage.getItem(preferenceStorageKey)
      if (retained) {
        const write = JSON.parse(retained) as PreferenceWrite
        if (
          Array.isArray(write.preferences?.visibleContextIds) &&
          Array.isArray(write.preferences?.pinnedContextIds) &&
          Array.isArray(write.preferences?.knownContextIds) &&
          typeof write.correlationId === "string" &&
          write.ownerKey === preferenceOwnerKey
        ) {
          latestPreferenceWrite.current = write
          window.queueMicrotask(() => {
            if (!componentMounted.current) return
            setVisible(write.preferences.visibleContextIds)
            setPinned(write.preferences.pinnedContextIds)
          })
        }
      }
    } catch {
      // Ignore malformed or unavailable recovery storage.
    }
    const retryPendingWrite = () => {
      if (latestPreferenceWrite.current) {
        persistPreferenceWrite(latestPreferenceWrite.current)
      }
    }
    window.addEventListener("online", retryPendingWrite)
    return () => {
      componentMounted.current = false
      window.removeEventListener("online", retryPendingWrite)
      if (preferenceTimer.current !== null) {
        window.clearTimeout(preferenceTimer.current)
        preferenceTimer.current = null
      }
      if (latestPreferenceWrite.current) {
        persistPreferenceWrite(latestPreferenceWrite.current)
      }
    }
  }, [persistPreferenceWrite, preferenceOwnerKey, preferenceStorageKey])

  useEffect(() => {
    const handleOffline = () => setSaveStatus("Offline")
    const handleOnline = () => {
      if (latestDraftWrite.current) {
        setSaveStatus("Saving")
        persistDraftWrite(latestDraftWrite.current)
      } else {
        setSaveStatus("Saved")
      }
    }
    if (!window.navigator.onLine) window.queueMicrotask(handleOffline)
    window.addEventListener("offline", handleOffline)
    window.addEventListener("online", handleOnline)
    return () => {
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("online", handleOnline)
      if (draftTimer.current !== null) {
        window.clearTimeout(draftTimer.current)
        draftTimer.current = null
      }
      if (draftRetryTimer.current !== null) {
        window.clearTimeout(draftRetryTimer.current)
        draftRetryTimer.current = null
      }
      if (latestDraftWrite.current) persistDraftWrite(latestDraftWrite.current)
    }
  }, [persistDraftWrite])

  useEffect(() => {
    if (!draftMounted.current) {
      draftMounted.current = true
      return
    }
    if (!onDraftSave) return
    const write = {
      text: draft,
      correlationId: crypto.randomUUID(),
      version: draftVersion.current,
    }
    latestDraftWrite.current = write
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => {
      draftTimer.current = null
      persistDraftWrite(write)
    }, 500)
  }, [draft, onDraftSave, persistDraftWrite])

  useEffect(() => {
    if (!preferencesMounted.current) {
      preferencesMounted.current = true
      return
    }
    if (!onPreferencesChange) return
    const write = {
      preferences: {
        visibleContextIds: visible,
        pinnedContextIds: pinned,
        knownContextIds: itemIds,
      },
      correlationId: crypto.randomUUID(),
      ownerKey: preferenceOwnerKey,
    }
    latestPreferenceWrite.current = write
    window.queueMicrotask(() => {
      if (componentMounted.current) setPreferenceSyncFailed(false)
    })
    try {
      window.localStorage.setItem(preferenceStorageKey, JSON.stringify(write))
    } catch {
      // Persistence still proceeds when browser storage is unavailable.
    }
    if (preferenceTimer.current !== null) {
      window.clearTimeout(preferenceTimer.current)
    }
    preferenceTimer.current = window.setTimeout(() => {
      preferenceTimer.current = null
      persistPreferenceWrite(write)
    }, 200)
  }, [
    itemIds,
    onPreferencesChange,
    persistPreferenceWrite,
    pinned,
    preferenceOwnerKey,
    preferenceStorageKey,
    visible,
  ])

  useEffect(() => {
    if (expanded && inputMode === "type") editorRef.current?.focus()
  }, [expanded, inputMode])

  function toggle(list: Array<string>, id: string) {
    return list.includes(id)
      ? list.filter((itemId) => itemId !== id)
      : [...list, id]
  }

  const displayed = items.filter(
    (item) => visible.includes(item.id) || pinned.includes(item.id)
  )

  return (
    <main className="unified-canvas" aria-label="Content Request workspace">
      <header className="unified-canvas__topbar">
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="Back to content requests"
          nativeButton={false}
          render={<a href="/app" />}
        >
          <ArrowLeft />
        </Button>
        <div>
          <p>{request.humanId} · Founder input</p>
          <h1>{request.title}</h1>
        </div>
        <Badge
          variant={
            request.priority === "critical" ? "destructive" : "secondary"
          }
        >
          {request.priority}
        </Badge>
      </header>

      <section
        className="unified-context-deck"
        aria-label="Context deck"
        data-expanded={String(expanded)}
      >
        <div className="unified-context-deck__controls">
          <div>
            <p>Prepared brief</p>
            <h2>Context deck</h2>
          </div>
          <Badge>{pinned.length} pinned</Badge>
        </div>
        {preferenceSyncFailed ? (
          <p className="unified-context-sync-error" role="alert">
            Context settings are pending. They will retry when you reconnect.
          </p>
        ) : null}
        <div className="unified-context-filters" aria-label="Context controls">
          {items.map((item) => {
            const isVisible = visible.includes(item.id)
            const isPinned = pinned.includes(item.id)
            return (
              <div key={item.id} data-active={String(isVisible || isPinned)}>
                <Toggle
                  aria-label={`${isVisible ? "Hide" : "Show"} ${item.title}`}
                  pressed={isVisible}
                  onPressedChange={() =>
                    setVisible((current) => toggle(current, item.id))
                  }
                >
                  {(isVisible || isPinned) && <Check aria-hidden="true" />}
                  {item.title}
                </Toggle>
                <Button
                  ref={(element) => {
                    if (element) filterPinRefs.current.set(item.id, element)
                    else filterPinRefs.current.delete(item.id)
                  }}
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label={`${isPinned ? "Unpin" : "Pin"} ${item.title}`}
                  aria-pressed={isPinned}
                  onClick={() =>
                    setPinned((current) => toggle(current, item.id))
                  }
                >
                  <Pin className={cn(isPinned && "fill-current")} />
                </Button>
              </div>
            )
          })}
        </div>
        <div className="unified-context-deck__cards">
          {displayed.length > 0 ? (
            displayed.map((item) => (
              <ContextCard
                key={item.id}
                item={item}
                pinned={pinned.includes(item.id)}
                onTogglePin={() => {
                  if (pinned.includes(item.id) && !visible.includes(item.id)) {
                    filterPinRefs.current.get(item.id)?.focus()
                  }
                  setPinned((current) => toggle(current, item.id))
                }}
              />
            ))
          ) : (
            <p className="unified-context-empty">
              Toggle a context item above to keep it beside the editor.
            </p>
          )}
        </div>
      </section>

      <section
        className="unified-editor"
        id="founder-editor"
        data-testid="founder-editor"
        data-expanded={String(expanded)}
        aria-label="Founder input editor"
      >
        <div className="unified-editor__toolbar">
          <ToggleGroup
            className="unified-editor__modes"
            aria-label="Input method"
            value={[inputMode]}
            onValueChange={(values) => {
              const next = values[0]
              if (next === "type" || next === "record") setInputMode(next)
            }}
          >
            <ToggleGroupItem value="type" aria-label="Type input">
              <FileText /> Type
            </ToggleGroupItem>
            <ToggleGroupItem value="record" aria-label="Record input">
              <Mic /> Record
            </ToggleGroupItem>
          </ToggleGroup>
          <span
            className="unified-editor__save-status"
            data-state={displayedSaveStatus.toLowerCase()}
            role="status"
            aria-live="polite"
          >
            {displayedSaveStatus}
          </span>
          {draftController ? (
            <div
              className="unified-editor__history-controls"
              aria-label="Version history"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Undo founder input"
                disabled={!draftController.canUndo || draftController.readOnly}
                onClick={() => {
                  if (!draftController.readOnly) void draftController.onUndo()
                }}
              >
                <Undo2 />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Redo founder input"
                disabled={!draftController.canRedo || draftController.readOnly}
                onClick={() => {
                  if (!draftController.readOnly) void draftController.onRedo()
                }}
              >
                <Redo2 />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={historyOpen}
                aria-controls="founder-version-history"
                onClick={() => {
                  setHistoryOpen((current) => !current)
                  setExpanded(true)
                }}
              >
                <ScrollText /> History ({draftController.history?.length ?? 0})
              </Button>
            </div>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            aria-controls="founder-editor"
            aria-label={expanded ? "Collapse editor" : "Expand editor"}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
            {expanded ? "Collapse" : "Expand"}
          </Button>
        </div>
        {draftController && historyOpen ? (
          <ol
            id="founder-version-history"
            className="unified-editor__version-history"
            aria-label="Founder input version history"
          >
            {draftController.history?.entries.map((entry) => (
              <li
                key={`${entry.position}-${entry.state.correlationId}`}
                aria-current={
                  draftController.history?.position === entry.position
                    ? "step"
                    : undefined
                }
              >
                <span>
                  {entry.state.actorSubject} · version {entry.position + 1}
                </span>
                <time dateTime={new Date(entry.state.occurredAt).toISOString()}>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(entry.state.occurredAt)}
                </time>
              </li>
            ))}
            {draftController.history?.entries.length === 0 ? (
              <li>No durable versions yet.</li>
            ) : null}
            {draftController.archiveEntries.map((entry) => (
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
                  size="sm"
                  disabled={draftController.readOnly}
                  onClick={() =>
                    !draftController.readOnly &&
                    void draftController.onRestoreArchivedVersion(
                      entry.versionId
                    )
                  }
                >
                  Restore
                </Button>
              </li>
            ))}
            {!draftController.archiveDone ? (
              <li>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void draftController.onLoadOlderHistory()}
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
              value={displayedDraft}
              readOnly={draftController?.readOnly}
              onChange={(event) => {
                if (draftRetryTimer.current !== null) {
                  window.clearTimeout(draftRetryTimer.current)
                  draftRetryTimer.current = null
                }
                draftVersion.current += 1
                setDraft(event.target.value)
                draftController?.onTextChange(event.target.value)
                setSaveStatus(window.navigator.onLine ? "Saving" : "Offline")
              }}
              placeholder="Add your perspective…"
            />
          ) : draftController?.readOnly ? (
            <div className="unified-editor__record-preview" role="status">
              Founder input was submitted and is now read-only.
            </div>
          ) : (
            <div className="unified-editor__record-preview">
              {!draftController?.voice?.supported ? (
                <div role="status">
                  <strong>Voice recording unavailable</strong>
                  <span>
                    This browser cannot capture audio. Your typed input is still
                    available under Type.
                  </span>
                </div>
              ) : (
                <>
                  <Mic aria-hidden="true" />
                  <div aria-live="polite">
                    <strong>
                      {draftController.voice.state === "recording"
                        ? "Recording"
                        : draftController.voice.state === "paused"
                          ? "Recording paused"
                          : draftController.voice.state === "requesting"
                            ? "Requesting microphone access"
                            : draftController.voice.state === "saving"
                              ? "Audio saved locally"
                              : draftController.voice.state === "transcribing"
                                ? "Transcribing audio"
                                : draftController.voice.state === "failed"
                                  ? "Voice input needs attention"
                                  : "Voice input"}
                    </strong>
                    <span>
                      {draftController.voice.errorCode === "PERMISSION_DENIED"
                        ? "Microphone permission was denied. Typed input was not changed."
                        : draftController.voice.errorCode
                          ? `Could not finish voice input (${draftController.voice.errorCode}). Typed input is safe.`
                          : draftController.voice.queuedCount > 0
                            ? `${draftController.voice.queuedCount} recording queued for upload.`
                            : `${Math.floor(
                                draftController.voice.elapsedMs / 60_000
                              )
                                .toString()
                                .padStart(2, "0")}:${Math.floor(
                                (draftController.voice.elapsedMs % 60_000) /
                                  1_000
                              )
                                .toString()
                                .padStart(2, "0")}`}
                    </span>
                  </div>
                  <div className="unified-editor__record-actions">
                    {draftController.voice.state === "recording" ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={draftController.voice.pause}
                      >
                        <Pause /> Pause
                      </Button>
                    ) : draftController.voice.state === "paused" ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={draftController.voice.resume}
                      >
                        <Play /> Resume
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        disabled={[
                          "requesting",
                          "saving",
                          "transcribing",
                        ].includes(draftController.voice.state)}
                        onClick={() => void draftController.voice?.start()}
                      >
                        <Mic /> Start recording
                      </Button>
                    )}
                    {["recording", "paused"].includes(
                      draftController.voice.state
                    ) ? (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => void draftController.voice?.stop()}
                      >
                        <Square /> Stop
                      </Button>
                    ) : null}
                    {draftController.voice.state === "failed" ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void draftController.voice?.retry()}
                      >
                        <RotateCcw /> Retry upload
                      </Button>
                    ) : null}
                  </div>
                  {draftController.voice.queuedCount > 0 ||
                  draftController.voice.errorCode ===
                    "LOCAL_AUDIO_SAVE_FAILED" ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        void draftController.voice?.discardPending()
                      }
                    >
                      Discard pending recordings
                    </Button>
                  ) : null}
                  {draftController.voice.captures
                    .filter(
                      (capture) =>
                        capture.status === "failed" && !capture.discardedAt
                    )
                    .map((capture) => (
                      <div key={capture.captureId}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void draftController.voice?.retry(capture.captureId)
                          }
                        >
                          Retry transcription
                          {capture.failureCode
                            ? ` (${capture.failureCode})`
                            : ""}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void draftController.voice?.discard(
                              capture.captureId
                            )
                          }
                        >
                          Discard recording
                        </Button>
                      </div>
                    ))}
                </>
              )}
            </div>
          )}
        </div>
        {onSubmitFounderInput ? (
          <div className="unified-editor__submit-row">
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
                displayedSaveStatus !== "Saved" ||
                !displayedDraft.trim() ||
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
      </section>
    </main>
  )
}
