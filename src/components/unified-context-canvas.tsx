import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  BookOpen,
  Check,
  CircleAlert,
  ExternalLink,
  FileCheck2,
  Link2,
  Pin,
  ScrollText,
  Sparkles,
} from "lucide-react"

import type {
  ContentContextItem,
  ContentRequest,
  ContextDeckPreferences,
} from "@/application/content-requests"
import {
  FounderInputDrawer,
  type FounderDraftController,
} from "@/components/founder-input-drawer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonAnchor } from "@/components/ui/button-link"
import { Toggle } from "@/components/ui/toggle"
import { useHydrated } from "@/hooks/use-hydrated"
import { cn } from "@/lib/utils"
import { MarkdownContent } from "@/components/markdown-content"

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
  readOnly = false,
}: {
  item: CanvasItem
  pinned: boolean
  onTogglePin(): void
  readOnly?: boolean
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
          disabled={readOnly}
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
              <MarkdownContent
                className="unified-context-point__body"
                minimumHeadingLevel={3}
              >
                {point}
              </MarkdownContent>
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
              rel="noopener noreferrer"
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
  requestActive = true,
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
  requestActive?: boolean
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
  draftController?: FounderDraftController
}) {
  const hydrated = useHydrated()
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
  const [inputMode, setInputMode] = useState<"type" | "record">("type")
  const [draft, setDraft] = useState(initialDraft)
  const [saveStatus, setSaveStatus] = useState<
    "Saved" | "Saving" | "Offline" | "Save pending" | "Save blocked"
  >("Saved")
  const displayedSaveStatus = draftController?.status ?? saveStatus
  const displayedDraft = draftController?.text ?? draft
  const editorReadOnly = Boolean(draftController?.readOnly)
  const requestInactive = !requestActive
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

  function toggle(list: Array<string>, id: string) {
    return list.includes(id)
      ? list.filter((itemId) => itemId !== id)
      : [...list, id]
  }

  const displayed = items.filter(
    (item) => visible.includes(item.id) || pinned.includes(item.id)
  )

  return (
    <main
      className="unified-canvas"
      id="main-content"
      aria-label="Content Request workspace"
    >
      <header className="unified-canvas__topbar">
        <ButtonAnchor
          className="size-11"
          variant="ghost"
          size="icon-lg"
          aria-label="Back to content requests"
          href="/app"
        >
          <ArrowLeft />
        </ButtonAnchor>
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
      {requestInactive ? (
        <p className="unified-context-sync-error" role="status">
          This request is inactive. Founder input and context settings are
          read-only until an editor restores it.
        </p>
      ) : null}

      <section className="unified-context-deck" aria-label="Context deck">
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
        <div
          className="unified-context-filters"
          role="group"
          aria-label="Context controls"
        >
          {items.map((item) => {
            const isVisible = visible.includes(item.id)
            const isPinned = pinned.includes(item.id)
            return (
              <div key={item.id} data-active={String(isVisible || isPinned)}>
                <Toggle
                  aria-label={`${isVisible ? "Hide" : "Show"} ${item.title}`}
                  pressed={isVisible}
                  disabled={requestInactive}
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
                  disabled={requestInactive}
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
                readOnly={requestInactive}
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

      <FounderInputDrawer
        controller={draftController}
        draft={displayedDraft}
        editorReadOnly={editorReadOnly}
        editorRef={editorRef}
        hydrated={hydrated}
        inputMode={inputMode}
        onInputModeChange={setInputMode}
        onTextChange={(text) => {
          if (editorReadOnly) return
          if (draftRetryTimer.current !== null) {
            window.clearTimeout(draftRetryTimer.current)
            draftRetryTimer.current = null
          }
          draftVersion.current += 1
          setDraft(text)
          draftController?.onTextChange(text)
          setSaveStatus(window.navigator.onLine ? "Saving" : "Offline")
        }}
        onSubmitFounderInput={onSubmitFounderInput}
        saveStatus={displayedSaveStatus}
        voicePending={voicePending}
      />
    </main>
  )
}
