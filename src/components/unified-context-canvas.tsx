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
  Pin,
  ScrollText,
  Sparkles,
} from "lucide-react"

import type {
  ContentContextItem,
  ContentRequest,
  ContextDeckPreferences,
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
  initialPreferences,
  onPreferencesChange,
}: {
  request: ContentRequest
  contextItems: Array<ContentContextItem>
  preferenceOwnerKey: string
  initialPreferences?: ContextDeckPreferences | null
  onPreferencesChange?: (
    preferences: ContextDeckPreferences,
    correlationId: string
  ) => void | Promise<void>
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
  const [inputMode, setInputMode] = useState<"type" | "record">("type")
  const [draft, setDraft] = useState("")
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const filterPinRefs = useRef(new Map<string, HTMLButtonElement>())
  const preferencesMounted = useRef(false)
  const componentMounted = useRef(false)
  const preferenceTimer = useRef<number | null>(null)
  const latestPreferenceWrite = useRef<PreferenceWrite | null>(null)
  const preferenceCallback = useRef(onPreferencesChange)
  const preferenceWriteChain = useRef<Promise<void>>(Promise.resolve())
  const [preferenceSyncFailed, setPreferenceSyncFailed] = useState(false)
  const preferenceStorageKey = `fairlend:context-preferences:${encodeURIComponent(preferenceOwnerKey)}:${request.humanId}`

  useEffect(() => {
    preferenceCallback.current = onPreferencesChange
  }, [onPreferencesChange])

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
        <div className="unified-editor__input">
          {inputMode === "type" ? (
            <Textarea
              ref={editorRef}
              aria-label="Founder input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add your perspective…"
            />
          ) : (
            <div className="unified-editor__record-preview">
              <Mic aria-hidden="true" />
              <div>
                <strong>Voice input</strong>
                <span>Ready to record your perspective</span>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
