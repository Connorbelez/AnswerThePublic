import { useMemo } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"

import {
  assertFounderInputSynced,
  createFounderVoiceUploadUrl,
  discardFounderVoiceCapture,
  finalizeFounderVoiceCapture,
  getFounderVersionHistory,
  listFounderArchivedVersions,
  listFounderVoiceCaptures,
  markFounderVoiceTranscriptMerged,
  pullFounderAutomergeChanges,
  redoFounderInput,
  restoreFounderArchivedVersion,
  retryFounderVoiceCapture,
  submitFounderAutomergeChanges,
  submitFounderInput,
  undoFounderInput,
} from "@/application/content-request-server-functions"
import type {
  ContentContextItem,
  ContentRequest,
  ContextDeckPreferences,
} from "@/application/content-requests"
import { UnifiedContextCanvas } from "@/components/unified-context-canvas"
import { useFounderAutomerge } from "@/hooks/use-founder-automerge"
import { useFounderVoiceInput } from "@/hooks/use-founder-voice-input"

export type FounderRequestCanvasProps = {
  request: ContentRequest
  contextItems: Array<ContentContextItem>
  preferenceOwnerKey: string
  initialDraft: string
  initialDocumentId: string | null
  initialPreferences: ContextDeckPreferences | null
  onPreferencesChange?: (
    preferences: ContextDeckPreferences,
    correlationId: string
  ) => Promise<void>
  requestActive: boolean
  founderInputMutable: boolean
}

export function FounderRequestCanvas({
  request,
  contextItems,
  preferenceOwnerKey,
  initialDraft,
  initialDocumentId,
  initialPreferences,
  onPreferencesChange,
  requestActive,
  founderInputMutable,
}: FounderRequestCanvasProps) {
  const navigate = useNavigate()
  const pull = useServerFn(pullFounderAutomergeChanges)
  const submit = useServerFn(submitFounderAutomergeChanges)
  const loadHistory = useServerFn(getFounderVersionHistory)
  const undo = useServerFn(undoFounderInput)
  const redo = useServerFn(redoFounderInput)
  const loadArchive = useServerFn(listFounderArchivedVersions)
  const restoreArchived = useServerFn(restoreFounderArchivedVersion)
  const assertSynced = useServerFn(assertFounderInputSynced)
  const createVoiceUpload = useServerFn(createFounderVoiceUploadUrl)
  const finalizeVoice = useServerFn(finalizeFounderVoiceCapture)
  const loadVoiceCaptures = useServerFn(listFounderVoiceCaptures)
  const retryVoiceCapture = useServerFn(retryFounderVoiceCapture)
  const markVoiceMerged = useServerFn(markFounderVoiceTranscriptMerged)
  const discardVoiceCapture = useServerFn(discardFounderVoiceCapture)
  const submitFounder = useServerFn(submitFounderInput)
  const transport = useMemo(
    () => ({
      pull: (documentId: string) =>
        pull({ data: { humanId: request.humanId, documentId } }),
      submit: (input: {
        documentId: string
        changes: Array<{ hash: string; data: string }>
        heads: Array<string>
        text: string
        correlationId: string
      }) => submit({ data: { humanId: request.humanId, ...input } }),
      history: () => loadHistory({ data: { humanId: request.humanId } }),
      archive: (cursor: string | null) =>
        loadArchive({ data: { humanId: request.humanId, cursor } }),
      restoreArchived: (versionId: string, correlationId: string) =>
        restoreArchived({
          data: { humanId: request.humanId, versionId, correlationId },
        }),
      undo: (correlationId: string) =>
        undo({ data: { humanId: request.humanId, correlationId } }),
      redo: (correlationId: string) =>
        redo({ data: { humanId: request.humanId, correlationId } }),
      assertSynced: (heads: Array<string>) =>
        assertSynced({ data: { humanId: request.humanId, heads } }),
    }),
    [
      assertSynced,
      loadArchive,
      loadHistory,
      pull,
      redo,
      request.humanId,
      restoreArchived,
      submit,
      undo,
    ]
  )
  const founderDocument = useFounderAutomerge({
    humanId: request.humanId,
    ownerKey: preferenceOwnerKey,
    initialText: initialDraft,
    initialDocumentId,
    transport,
    enabled: founderInputMutable,
  })
  const voiceTransport = useMemo(
    () => ({
      createUploadUrl: () =>
        createVoiceUpload({ data: { humanId: request.humanId } }),
      finalize: (input: {
        clientCaptureId: string
        storageId: string
        mimeType: string
        sizeBytes: number
        durationMs: number
        recordedAt: number
        correlationId: string
      }) => finalizeVoice({ data: { humanId: request.humanId, ...input } }),
      list: () => loadVoiceCaptures({ data: { humanId: request.humanId } }),
      retry: (captureId: string) =>
        retryVoiceCapture({ data: { humanId: request.humanId, captureId } }),
      markMerged: (captureId: string) =>
        markVoiceMerged({ data: { humanId: request.humanId, captureId } }),
      discard: (captureId: string) =>
        discardVoiceCapture({ data: { humanId: request.humanId, captureId } }),
    }),
    [
      createVoiceUpload,
      discardVoiceCapture,
      finalizeVoice,
      loadVoiceCaptures,
      markVoiceMerged,
      request.humanId,
      retryVoiceCapture,
    ]
  )
  const voiceInput = useFounderVoiceInput({
    requestHumanId: request.humanId,
    ownerKey: preferenceOwnerKey,
    transport: voiceTransport,
    appendTranscript: founderDocument.appendVoiceTranscript,
    ensureDurablySynced: founderDocument.ensureDurablySynced,
    enabled: founderInputMutable,
  })

  return (
    <UnifiedContextCanvas
      request={request}
      requestActive={requestActive}
      contextItems={contextItems}
      preferenceOwnerKey={preferenceOwnerKey}
      initialDraft={initialDraft}
      initialPreferences={initialPreferences}
      onPreferencesChange={onPreferencesChange}
      onSubmitFounderInput={
        founderInputMutable
          ? async () => {
              const heads = await founderDocument.prepareSubmission()
              if (!heads) {
                throw new Error("Founder input is not durably synced.")
              }
              await submitFounder({
                data: {
                  humanId: request.humanId,
                  heads,
                  correlationId: crypto.randomUUID(),
                },
              })
              await navigate({ to: "/app", viewTransition: true })
            }
          : undefined
      }
      draftController={{
        text: founderDocument.text,
        status: founderDocument.status,
        canUndo: founderDocument.history?.canUndo ?? false,
        canRedo: founderDocument.history?.canRedo ?? false,
        history: founderDocument.history,
        archiveEntries: founderDocument.archiveEntries,
        archiveDone: founderDocument.archiveDone,
        readOnly: !founderInputMutable,
        onTextChange: founderDocument.setText,
        onUndo: founderDocument.undo,
        onRedo: founderDocument.redo,
        onLoadOlderHistory: founderDocument.loadOlderHistory,
        onRestoreArchivedVersion: founderDocument.restoreArchivedVersion,
        voice: founderInputMutable ? voiceInput : undefined,
      }}
    />
  )
}
