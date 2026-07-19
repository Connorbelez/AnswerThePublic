import * as Automerge from "@automerge/automerge"
import {
  Repo,
  interpretAsDocumentId,
  isValidAutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo"
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"
import { useCallback, useEffect, useRef, useState } from "react"

import type {
  FounderAutomergePull,
  FounderArchivedVersion,
  FounderInputDocument,
  FounderVersionArchivePage,
  FounderVersionHistory,
} from "@/application/content-requests"
import { nextDistinctArchivePage } from "@/lib/founder-version-history"
import {
  applyFounderText,
  appendFounderVoiceTranscript,
  decodeAutomergeChange,
  encodeAutomergeChange,
  founderDocumentHeads,
  hashAutomergeChange,
  mergeFounderChanges,
  materializedFounderText,
  partitionAutomergeChanges,
  type FounderAutomergeDocument,
} from "@/lib/founder-automerge"

export type FounderSyncStatus =
  "Saved" | "Saving" | "Offline" | "Save pending" | "Save blocked"

type FounderAutomergeTransport = {
  pull(documentId: string): Promise<FounderAutomergePull>
  submit(input: {
    documentId: string
    changes: Array<{ hash: string; data: string }>
    heads: Array<string>
    text: string
    correlationId: string
  }): Promise<FounderInputDocument>
  history(): Promise<FounderVersionHistory>
  archive(cursor: string | null): Promise<FounderVersionArchivePage>
  restoreArchived(
    versionId: string,
    correlationId: string
  ): Promise<FounderInputDocument>
  undo(correlationId: string): Promise<FounderInputDocument>
  redo(correlationId: string): Promise<FounderInputDocument>
  assertSynced(
    heads: Array<string>
  ): Promise<{ synced: boolean; durableHeads: Array<string> }>
}

function ownerNamespace(value: string) {
  let binary = ""
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

function founderDraftStorageKey(ownerKey: string, humanId: string) {
  return `fairlend:founder-offline-draft:${ownerNamespace(ownerKey)}:${humanId.trim().toUpperCase()}`
}

function readLocalValue(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocalValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // IndexedDB remains the primary durable store when localStorage is denied.
  }
}

function removeLocalValue(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // The staged value is owner-scoped and can be cleared on a later sync.
  }
}

async function deterministicDocumentId(ownerKey: string, humanId: string) {
  const input = new TextEncoder().encode(
    `fairlend-founder-input:v1:${ownerKey}:${humanId.trim().toUpperCase()}`
  )
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input))
  return digest.slice(0, 16)
}

function sameHeads(left: Array<string>, right: Array<string>) {
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((head, index) => head === sortedRight[index])
  )
}

function syncErrorCode(error: unknown) {
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

function terminalSyncError(error: unknown) {
  return [
    "UNAUTHENTICATED",
    "AUTHORIZATION_NOT_CONFIGURED",
    "PRINCIPAL_NOT_PROVISIONED",
    "ORGANIZATION_ACCESS_DENIED",
    "ROLE_ACCESS_DENIED",
    "RESOURCE_ACCESS_DENIED",
    "FOUNDER_INPUT_HANDOFF_REQUIRED",
    "AUTOMERGE_DOCUMENT_MISMATCH",
    "NOT_FOUND",
    "VALIDATION_FAILED",
  ].includes(String(syncErrorCode(error)))
}

class FounderAutomergeSession {
  readonly repo: Repo
  readonly handle: DocHandle<FounderAutomergeDocument>
  private readonly durableChangeHashes = new Set<string>()
  private readonly localDraftKey: string

  private constructor(
    repo: Repo,
    handle: DocHandle<FounderAutomergeDocument>,
    localDraftKey: string
  ) {
    this.repo = repo
    this.handle = handle
    this.localDraftKey = localDraftKey
  }

  static async open({
    humanId,
    ownerKey,
    initialText,
    initialDocumentId,
    pullRemote,
  }: {
    humanId: string
    ownerKey: string
    initialText: string
    initialDocumentId: string | null
    pullRemote(documentId: string): Promise<FounderAutomergePull>
  }) {
    const namespace = ownerNamespace(ownerKey)
    const repo = new Repo({
      storage: new IndexedDBStorageAdapter(
        `fairlend-founder-input-${namespace}`,
        "documents"
      ),
      network: [
        new BroadcastChannelNetworkAdapter({
          channelName: `fairlend-founder-input-${namespace}`,
        }),
      ],
      saveDebounceRate: 0,
      idFactory: () => deterministicDocumentId(ownerKey, humanId),
    })
    const localDocumentKey = `fairlend:founder-automerge-document:${namespace}:${humanId}`
    const localDraftKey = founderDraftStorageKey(ownerKey, humanId)
    const retainedDocumentId = readLocalValue(localDocumentKey)
    const knownDocumentId = initialDocumentId ?? retainedDocumentId
    let handle: DocHandle<FounderAutomergeDocument>
    if (knownDocumentId) {
      if (!isValidAutomergeUrl(knownDocumentId)) {
        throw new Error(
          "The founder input has an invalid Automerge document ID."
        )
      }
      handle = await repo.find<FounderAutomergeDocument>(knownDocumentId, {
        allowableStates: ["ready", "unavailable"],
      })
      if (handle.isUnavailable()) {
        const remote = await pullRemote(knownDocumentId)
        if (remote.changes.length === 0) {
          throw new Error(
            "The durable Automerge document has no change history."
          )
        }
        const reconstructed = mergeFounderChanges(
          Automerge.init<FounderAutomergeDocument>(),
          remote.changes.map(({ data }) => decodeAutomergeChange(data))
        )
        handle = repo.import<FounderAutomergeDocument>(
          Automerge.save(reconstructed),
          { docId: interpretAsDocumentId(knownDocumentId) }
        )
        await handle.whenReady()
      }
    } else {
      handle = await repo.create2<FounderAutomergeDocument>({
        requestHumanId: humanId.trim().toUpperCase(),
        schemaVersion: 1,
        text: "",
      })
      await handle.whenReady()
    }
    writeLocalValue(localDocumentKey, handle.url)
    const stagedText = readLocalValue(localDraftKey)
    if (
      stagedText !== null &&
      stagedText !== materializedFounderText(handle.doc())
    ) {
      handle.update((document) =>
        applyFounderText(document, stagedText, "Recover staged offline input")
      )
    } else if (
      Automerge.getAllChanges(handle.doc()).length === 1 &&
      initialText
    ) {
      handle.update((document) =>
        applyFounderText(document, initialText, "Import durable founder input")
      )
    }
    await repo.flush([handle.documentId])
    return new FounderAutomergeSession(repo, handle, localDraftKey)
  }

  get documentId() {
    return this.handle.url
  }

  get text() {
    return materializedFounderText(this.handle.doc())
  }

  get heads() {
    return founderDocumentHeads(this.handle.doc())
  }

  setText(text: string, message = "Edit founder input") {
    writeLocalValue(this.localDraftKey, text)
    this.handle.update((document) => applyFounderText(document, text, message))
  }

  appendVoiceTranscript(
    captureId: string,
    transcript: string,
    recordedAt: number
  ) {
    this.handle.update((document) =>
      appendFounderVoiceTranscript(document, captureId, transcript, recordedAt)
    )
  }

  clearStagedDraft() {
    removeLocalValue(this.localDraftKey)
  }

  applyRemote(pull: FounderAutomergePull) {
    for (const change of pull.changes) {
      this.durableChangeHashes.add(change.hash)
    }
    const localBeforePull = this.heads
    this.handle.update((document) =>
      mergeFounderChanges(
        document,
        pull.changes.map(({ data }) => decodeAutomergeChange(data))
      )
    )
    const hasNoUnsyncedLocalChanges = sameHeads(
      localBeforePull,
      pull.durableHeads
    )
    if (
      hasNoUnsyncedLocalChanges &&
      pull.materializedText !== null &&
      pull.materializedText !== this.text
    ) {
      this.setText(pull.materializedText, "Apply restored durable version")
    }
  }

  payload() {
    return {
      documentId: this.documentId,
      changes: Automerge.getAllChanges(this.handle.doc())
        .map((change) => ({
          hash: hashAutomergeChange(change),
          data: encodeAutomergeChange(change),
        }))
        .filter((change) => !this.durableChangeHashes.has(change.hash)),
      heads: this.heads,
      text: this.text,
      correlationId: crypto.randomUUID(),
    }
  }

  markDurable(changes: Array<{ hash: string }>) {
    for (const change of changes) this.durableChangeHashes.add(change.hash)
  }

  async flushLocal() {
    await this.repo.flush([this.handle.documentId])
  }

  async close() {
    await this.flushLocal()
    await this.repo.shutdown()
  }
}

export function useFounderAutomerge({
  humanId,
  ownerKey,
  initialText,
  initialDocumentId,
  transport,
}: {
  humanId: string
  ownerKey: string
  initialText: string
  initialDocumentId: string | null
  transport: FounderAutomergeTransport
}) {
  const [text, setText] = useState(initialText)
  const [status, setStatus] = useState<FounderSyncStatus>("Saving")
  const [history, setHistory] = useState<FounderVersionHistory | null>(null)
  const [archiveEntries, setArchiveEntries] = useState<
    Array<FounderArchivedVersion>
  >([])
  const [archiveCursor, setArchiveCursor] = useState<string | null>(null)
  const [archiveDone, setArchiveDone] = useState(true)
  const sessionRef = useRef<FounderAutomergeSession | null>(null)
  const mountedRef = useRef(false)
  const syncTimerRef = useRef<number | null>(null)
  const retryTimerRef = useRef<number | null>(null)
  const retryAttemptRef = useRef(0)
  const syncNowRef = useRef<() => Promise<boolean>>(async () => false)
  const syncChainRef = useRef(Promise.resolve())
  const transportRef = useRef(transport)
  const dirtyRef = useRef(false)
  const pendingTextRef = useRef<string | null>(null)
  const pendingVoiceRef = useRef<
    Array<{ captureId: string; transcript: string; recordedAt: number }>
  >([])

  useEffect(() => {
    transportRef.current = transport
  }, [transport])

  const refreshHistory = useCallback(async () => {
    try {
      const next = await transportRef.current.history()
      const recentCorrelationIds = new Set(
        next.entries.map((entry) => entry.state.correlationId)
      )
      const archive = await nextDistinctArchivePage(
        (cursor) => transportRef.current.archive(cursor),
        recentCorrelationIds,
        null
      )
      if (mountedRef.current) {
        setHistory(next)
        setArchiveEntries(archive.page)
        setArchiveCursor(archive.continueCursor)
        setArchiveDone(archive.isDone)
      }
    } catch {
      // Editing remains available when history metadata cannot be refreshed.
    }
  }, [])

  const syncNow = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return false
    await session.flushLocal()
    if (!window.navigator.onLine) {
      if (mountedRef.current) setStatus("Offline")
      return false
    }
    if (mountedRef.current) setStatus("Saving")
    let succeeded = false
    syncChainRef.current = syncChainRef.current.then(async () => {
      const active = sessionRef.current
      if (!active) return
      try {
        const pull = await transportRef.current.pull(active.documentId)
        active.applyRemote(pull)
        if (mountedRef.current) setText(active.text)
        await active.flushLocal()
        const payload = active.payload()
        if (
          payload.changes.length === 0 &&
          sameHeads(active.heads, pull.durableHeads)
        ) {
          dirtyRef.current = false
          active.clearStagedDraft()
          retryAttemptRef.current = 0
          if (mountedRef.current) setStatus("Saved")
          succeeded = true
          await refreshHistory()
          return
        }
        const chunks = partitionAutomergeChanges(payload.changes)
        if (chunks.length === 0) chunks.push([])
        let durableHeads: Array<string> = []
        for (const [index, changes] of chunks.entries()) {
          const saved = await transportRef.current.submit({
            ...payload,
            changes,
            heads: index === chunks.length - 1 ? payload.heads : [],
            correlationId: crypto.randomUUID(),
          })
          active.markDurable(changes)
          durableHeads = saved.durableHeads
        }
        const currentHeads = active.heads
        const durable = sameHeads(currentHeads, durableHeads)
        dirtyRef.current = !durable
        if (durable) active.clearStagedDraft()
        retryAttemptRef.current = 0
        if (mountedRef.current) setStatus(durable ? "Saved" : "Save pending")
        succeeded = durable
        await refreshHistory()
      } catch (error) {
        if (mountedRef.current) {
          if (!window.navigator.onLine) setStatus("Offline")
          else if (terminalSyncError(error)) setStatus("Save blocked")
          else {
            setStatus("Save pending")
            if (retryTimerRef.current !== null) {
              window.clearTimeout(retryTimerRef.current)
            }
            const delay = Math.min(30_000, 1_000 * 2 ** retryAttemptRef.current)
            retryAttemptRef.current += 1
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null
              void syncNowRef.current()
            }, delay)
          }
        }
      }
    })
    await syncChainRef.current
    return succeeded
  }, [refreshHistory])

  useEffect(() => {
    syncNowRef.current = syncNow
  }, [syncNow])

  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current)
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null
      void syncNow()
    }, 500)
  }, [syncNow])

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    let changeListener: (() => void) | undefined
    const namespace = ownerNamespace(ownerKey)
    const offlineReady = (event: MessageEvent) => {
      if (
        event.data?.type === "FAIRLEND_OFFLINE_READY" &&
        event.data.owner === namespace
      ) {
        document.documentElement.dataset.offlineReady = "true"
      }
    }
    window.navigator.serviceWorker?.addEventListener("message", offlineReady)
    if ("serviceWorker" in window.navigator) {
      void window.navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(() => window.navigator.serviceWorker.ready)
        .then((registration) => {
          const worker =
            window.navigator.serviceWorker.controller ?? registration.active
          worker?.postMessage({
            type: "FAIRLEND_SET_OWNER",
            owner: namespace,
            url: window.location.href,
          })
        })
    }
    void FounderAutomergeSession.open({
      humanId,
      ownerKey,
      initialText,
      initialDocumentId,
      pullRemote: transportRef.current.pull,
    })
      .then(async (session) => {
        if (pendingTextRef.current !== null) {
          session.setText(
            pendingTextRef.current,
            "Recover input entered during local initialization"
          )
          pendingTextRef.current = null
          await session.flushLocal()
        }
        for (const pending of pendingVoiceRef.current) {
          session.appendVoiceTranscript(
            pending.captureId,
            pending.transcript,
            pending.recordedAt
          )
        }
        pendingVoiceRef.current = []
        if (cancelled) {
          await session.close()
          return
        }
        sessionRef.current = session
        setText(session.text)
        changeListener = () => {
          if (!mountedRef.current) return
          setText(session.text)
          dirtyRef.current = true
          setStatus(window.navigator.onLine ? "Saving" : "Offline")
        }
        session.handle.on("change", changeListener)
        if (window.navigator.onLine) void syncNow()
        else setStatus("Offline")
      })
      .catch(() => {
        if (mountedRef.current) {
          setStatus(window.navigator.onLine ? "Save blocked" : "Offline")
        }
      })
    const reconnect = () => void syncNow()
    const disconnect = () => setStatus("Offline")
    window.addEventListener("online", reconnect)
    window.addEventListener("offline", disconnect)
    return () => {
      cancelled = true
      mountedRef.current = false
      window.removeEventListener("online", reconnect)
      window.removeEventListener("offline", disconnect)
      window.navigator.serviceWorker?.removeEventListener(
        "message",
        offlineReady
      )
      if (syncTimerRef.current !== null)
        window.clearTimeout(syncTimerRef.current)
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current)
      }
      const session = sessionRef.current
      sessionRef.current = null
      if (session) {
        if (changeListener) session.handle.off("change", changeListener)
        void session.close()
      }
    }
  }, [humanId, initialDocumentId, initialText, ownerKey, syncNow])

  const updateText = useCallback(
    (nextText: string) => {
      const session = sessionRef.current
      if (!session) {
        pendingTextRef.current = nextText
        writeLocalValue(founderDraftStorageKey(ownerKey, humanId), nextText)
        setText(nextText)
        return
      }
      session.setText(nextText)
      void session.flushLocal()
      scheduleSync()
    },
    [humanId, ownerKey, scheduleSync]
  )

  const appendVoiceTranscript = useCallback(
    (captureId: string, addition: string, recordedAt: number) => {
      const normalized = addition.trim()
      if (!normalized) return
      const session = sessionRef.current
      if (!session) {
        pendingVoiceRef.current.push({
          captureId,
          transcript: normalized,
          recordedAt,
        })
        return
      }
      session.appendVoiceTranscript(captureId, normalized, recordedAt)
      void session.flushLocal()
      scheduleSync()
    },
    [scheduleSync]
  )

  const moveHistory = useCallback(
    async (direction: "undo" | "redo") => {
      const session = sessionRef.current
      if (!session) return
      setStatus("Saving")
      try {
        const restored = await transportRef.current[direction](
          crypto.randomUUID()
        )
        session.setText(restored.text, `${direction} founder input`)
        setText(session.text)
        await session.flushLocal()
        await syncNow()
      } catch {
        setStatus(window.navigator.onLine ? "Save blocked" : "Offline")
      }
    },
    [syncNow]
  )

  const ensureDurablySynced = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return false
    if (dirtyRef.current && !(await syncNow())) return false
    let result = await transportRef.current.assertSynced(session.heads)
    if (!result.synced && (await syncNow())) {
      result = await transportRef.current.assertSynced(session.heads)
    }
    return result.synced
  }, [syncNow])

  const prepareSubmission = useCallback(async () => {
    const session = sessionRef.current
    if (!session || !(await ensureDurablySynced())) return null
    return [...session.heads]
  }, [ensureDurablySynced])

  const loadOlderHistory = useCallback(async () => {
    if (archiveDone || !archiveCursor) return
    const recentCorrelationIds = new Set(
      history?.entries.map((entry) => entry.state.correlationId) ?? []
    )
    const next = await nextDistinctArchivePage(
      (cursor) => transportRef.current.archive(cursor),
      recentCorrelationIds,
      archiveCursor
    )
    setArchiveEntries((current) => {
      const versions = new Map(
        [...current, ...next.page].map((version) => [
          version.versionId,
          version,
        ])
      )
      return [...versions.values()]
    })
    setArchiveCursor(next.continueCursor)
    setArchiveDone(next.isDone)
  }, [archiveCursor, archiveDone, history?.entries])

  const restoreArchivedVersion = useCallback(
    async (versionId: string) => {
      const session = sessionRef.current
      if (!session) return
      setStatus("Saving")
      try {
        const restored = await transportRef.current.restoreArchived(
          versionId,
          crypto.randomUUID()
        )
        session.setText(restored.text, "Restore archived founder input version")
        setText(session.text)
        await session.flushLocal()
        await syncNow()
      } catch {
        setStatus(window.navigator.onLine ? "Save blocked" : "Offline")
      }
    },
    [syncNow]
  )

  return {
    text,
    status,
    history,
    archiveEntries,
    archiveDone,
    setText: updateText,
    appendVoiceTranscript,
    syncNow,
    undo: () => moveHistory("undo"),
    redo: () => moveHistory("redo"),
    loadOlderHistory,
    restoreArchivedVersion,
    ensureDurablySynced,
    prepareSubmission,
  }
}
