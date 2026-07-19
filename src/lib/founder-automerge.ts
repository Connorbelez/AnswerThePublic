import * as Automerge from "@automerge/automerge"
import { hash } from "fast-sha256"

export const FOUNDER_AUTOMERGE_SCHEMA_VERSION = 1 as const

export type FounderAutomergeDocument = {
  requestHumanId: string
  schemaVersion: typeof FOUNDER_AUTOMERGE_SCHEMA_VERSION
  text: string
  voiceTranscripts?: Record<string, { text: string; recordedAt: number }>
  seenVoiceCaptureIds?: Record<string, boolean>
}

export function materializedFounderText(
  document: Pick<
    FounderAutomergeDocument,
    "text" | "voiceTranscripts" | "seenVoiceCaptureIds"
  >
) {
  const transcripts = Object.entries(document.voiceTranscripts ?? {})
    .filter(([captureId]) => !document.seenVoiceCaptureIds?.[captureId])
    .sort(
      ([leftId, left], [rightId, right]) =>
        left.recordedAt - right.recordedAt || leftId.localeCompare(rightId)
    )
    .map(([, transcript]) => transcript.text.trim())
    .filter(Boolean)
  return [document.text.trimEnd(), ...transcripts]
    .filter((part) => part.trim())
    .join("\n\n")
}

function initializationActor(requestHumanId: string) {
  let hash = 2166136261
  for (const character of requestHumanId) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(4)
}

export function createFounderDocument(requestHumanId: string, text: string) {
  const initialized = Automerge.init<FounderAutomergeDocument>({
    actor: initializationActor(requestHumanId.trim().toUpperCase()),
  })
  return Automerge.change(initialized, "Initialize founder input", (draft) => {
    draft.requestHumanId = requestHumanId.trim().toUpperCase()
    draft.schemaVersion = FOUNDER_AUTOMERGE_SCHEMA_VERSION
    draft.text = text
  })
}

function textDiff(previous: string, next: string) {
  let prefix = 0
  const sharedLength = Math.min(previous.length, next.length)
  while (prefix < sharedLength && previous[prefix] === next[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < sharedLength - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1
  }

  return {
    index: prefix,
    deleteCount: previous.length - prefix - suffix,
    insertion: next.slice(prefix, next.length - suffix),
  }
}

export function applyFounderText(
  document: Automerge.Doc<FounderAutomergeDocument>,
  text: string,
  message = "Edit founder input"
) {
  if (materializedFounderText(document) === text) return document
  const difference = textDiff(document.text, text)
  return Automerge.change(document, message, (draft) => {
    Automerge.splice(
      draft,
      ["text"],
      difference.index,
      difference.deleteCount,
      difference.insertion
    )
    if (!draft.seenVoiceCaptureIds) draft.seenVoiceCaptureIds = {}
    for (const captureId of Object.keys(draft.voiceTranscripts ?? {})) {
      draft.seenVoiceCaptureIds[captureId] = true
      delete draft.voiceTranscripts?.[captureId]
    }
  })
}

export function appendFounderVoiceTranscript(
  document: Automerge.Doc<FounderAutomergeDocument>,
  captureId: string,
  transcript: string,
  recordedAt: number
) {
  const normalized = transcript.trim()
  if (
    !normalized ||
    document.seenVoiceCaptureIds?.[captureId] ||
    document.voiceTranscripts?.[captureId]?.text === normalized
  ) {
    return document
  }
  return Automerge.change(
    document,
    "Append founder voice transcript",
    (draft) => {
      if (!draft.voiceTranscripts) draft.voiceTranscripts = {}
      draft.voiceTranscripts[captureId] = { text: normalized, recordedAt }
    }
  )
}

export function encodeAutomergeChange(change: Uint8Array) {
  let binary = ""
  for (const byte of change) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
}

export function hashAutomergeChange(change: Uint8Array) {
  return Array.from(hash(change), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export function decodeAutomergeChange(encoded: string) {
  const binary = globalThis.atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function mergeFounderChanges(
  document: Automerge.Doc<FounderAutomergeDocument>,
  changes: Array<Uint8Array>
) {
  if (changes.length === 0) return document
  return Automerge.applyChanges(document, changes)[0]
}

export function founderDocumentHeads(
  document: Automerge.Doc<FounderAutomergeDocument>
) {
  return [...Automerge.getHeads(document)].sort()
}

export function partitionAutomergeChanges<T>(
  changes: Array<T>,
  batchSize = 250
): Array<Array<T>> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error("Automerge batch size must be a positive integer.")
  }
  const batches: Array<Array<T>> = []
  for (let index = 0; index < changes.length; index += batchSize) {
    batches.push(changes.slice(index, index + batchSize))
  }
  return batches
}
