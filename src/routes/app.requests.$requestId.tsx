import { useCallback, useEffect, useMemo, useRef } from "react"
import {
  Link,
  createFileRoute,
  getRouteApi,
  notFound,
} from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { ArrowLeft, ExternalLink } from "lucide-react"

import {
  createFounderVoiceUploadUrl,
  discardFounderVoiceCapture,
  finalizeFounderVoiceCapture,
  getContentRequest,
  getContentRequestContext,
  getContextDeckPreferences,
  getFounderInput,
  getFounderVersionHistory,
  listAssignablePrincipals,
  listFounderArchivedVersions,
  listFounderVoiceCaptures,
  listDeliverables,
  listDeliveryTargets,
  listOpenSemanticConflicts,
  listOperatorWorkspace,
  openContentRequest,
  markFounderVoiceTranscriptMerged,
  pullFounderAutomergeChanges,
  redoFounderInput,
  restoreFounderArchivedVersion,
  retryFounderVoiceCapture,
  saveContextDeckPreferences,
  submitFounderAutomergeChanges,
  submitFounderInput,
  undoFounderInput,
  assertFounderInputSynced,
} from "@/application/content-request-server-functions"
import { loadWorkspaceSession } from "@/application/load-workspace-session"
import { RequestAssignmentControl } from "@/components/request-assignment-control"
import { SemanticConflictPanel } from "@/components/semantic-conflict-panel"
import { DeliverablePanel } from "@/components/deliverable-panel"
import { DeliveryTargetChecklist } from "@/components/delivery-target-checklist"
import { UnifiedContextCanvas } from "@/components/unified-context-canvas"
import type { ContextDeckPreferences } from "@/application/content-requests"
import { useFounderAutomerge } from "@/hooks/use-founder-automerge"
import { useFounderVoiceInput } from "@/hooks/use-founder-voice-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  requestOriginLabel,
  requestPriorityLabel,
} from "@/lib/content-request-labels"

export const Route = createFileRoute("/app/requests/$requestId")({
  loader: async ({ params }) => {
    const session = await loadWorkspaceSession()
    const [
      request,
      principals,
      contextItems,
      contextDeckPreferences,
      founderInput,
      semanticConflicts,
      deliverables,
      deliveryTargets,
      operatorWorkspace,
    ] = await Promise.all([
      getContentRequest({ data: { humanId: params.requestId } }),
      listAssignablePrincipals(),
      getContentRequestContext({ data: { humanId: params.requestId } }),
      getContextDeckPreferences({ data: { humanId: params.requestId } }),
      session.status === "authenticated" && session.session.role === "founder"
        ? getFounderInput({ data: { humanId: params.requestId } })
        : Promise.resolve(null),
      session.status === "authenticated" && session.session.role !== "founder"
        ? listOpenSemanticConflicts({ data: { humanId: params.requestId } })
        : Promise.resolve([]),
      session.status === "authenticated" && session.session.role !== "founder"
        ? listDeliverables({ data: { humanId: params.requestId } })
        : Promise.resolve([]),
      session.status === "authenticated" && session.session.role !== "founder"
        ? listDeliveryTargets({ data: { humanId: params.requestId } })
        : Promise.resolve([]),
      session.status === "authenticated" && session.session.role !== "founder"
        ? listOperatorWorkspace({
            data: { search: params.requestId, limit: 1 },
          })
        : Promise.resolve(null),
    ])
    if (!request) throw notFound()
    return {
      request,
      principals,
      contextItems,
      contextDeckPreferences,
      founderInput,
      semanticConflicts,
      deliverables,
      deliveryTargets,
      operatorItem: operatorWorkspace?.page[0] ?? null,
    }
  },
  component: ContentRequestPage,
})

const appRoute = getRouteApi("/app")

function isRetryableOpenError(error: unknown) {
  if (error instanceof TypeError) return true
  const code =
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data
      ? error.data.code
      : undefined
  return ![
    "UNAUTHENTICATED",
    "RESOURCE_ACCESS_DENIED",
    "ORGANIZATION_ACCESS_DENIED",
    "NOT_FOUND",
    "VALIDATION_FAILED",
  ].includes(String(code))
}

function ContentRequestPage() {
  const {
    request,
    principals,
    contextItems,
    contextDeckPreferences,
    founderInput,
    semanticConflicts,
    deliverables,
    deliveryTargets,
    operatorItem,
  } = Route.useLoaderData()
  const session = appRoute.useLoaderData()
  const recordOpen = useServerFn(openContentRequest)
  const persistContextDeckPreferences = useServerFn(saveContextDeckPreferences)
  const handleContextDeckPreferences = useCallback(
    async (preferences: ContextDeckPreferences, correlationId: string) => {
      await persistContextDeckPreferences({
        data: { humanId: request.humanId, preferences, correlationId },
      })
    },
    [persistContextDeckPreferences, request.humanId]
  )
  const openRecordingState = useRef<{
    requestId: string
    status: "pending" | "recorded" | "failed"
  } | null>(null)
  const openOperation = useRef<{
    requestId: string
    operationId: string
  } | null>(null)

  useEffect(() => {
    if (openRecordingState.current?.requestId === request.humanId) return
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retryCount = 0
    const operationId = crypto.randomUUID()
    openOperation.current = { requestId: request.humanId, operationId }

    async function recordWithRetry() {
      openRecordingState.current = {
        requestId: request.humanId,
        status: "pending",
      }
      try {
        await recordOpen({
          data: {
            humanId: request.humanId,
            correlationId: operationId,
          },
        })
        if (!cancelled) {
          openRecordingState.current = {
            requestId: request.humanId,
            status: "recorded",
          }
        }
      } catch (error) {
        if (!cancelled && isRetryableOpenError(error) && retryCount < 3) {
          openRecordingState.current = null
          retryCount += 1
          retryTimer = setTimeout(
            () => void recordWithRetry(),
            1_000 * 2 ** (retryCount - 1)
          )
        } else if (!cancelled) {
          openRecordingState.current = {
            requestId: request.humanId,
            status: "failed",
          }
        }
      }
    }

    void recordWithRetry()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (openOperation.current?.operationId === operationId) {
        openOperation.current = null
      }
      if (
        openRecordingState.current?.requestId === request.humanId &&
        openRecordingState.current.status === "pending"
      ) {
        openRecordingState.current = null
      }
    }
  }, [recordOpen, request.humanId])
  if (session.role === "founder") {
    return (
      <FounderRequestCanvas
        key={request.humanId}
        request={request}
        contextItems={contextItems}
        preferenceOwnerKey={`${session.organizationId}:${session.principalId}`}
        initialDraft={founderInput?.text ?? ""}
        initialDocumentId={founderInput?.automergeDocumentId ?? null}
        initialPreferences={contextDeckPreferences}
        onPreferencesChange={handleContextDeckPreferences}
      />
    )
  }
  return (
    <main className="workspace workspace--narrow request-detail">
      <Button variant="ghost" render={<Link to="/app" />}>
        <ArrowLeft data-icon="inline-start" />
        Content requests
      </Button>
      <div className="request-detail__header">
        <div className="request-card__meta">
          <Badge
            variant={
              request.priority === "critical" ? "destructive" : "secondary"
            }
          >
            {requestPriorityLabel(request.priority)}
          </Badge>
          <span>{request.humanId}</span>
          <span>{requestOriginLabel(request.origin)} request</span>
          <span>Assigned to {request.assignee.subject}</span>
          <span>
            {request.lifecycle
              .replaceAll("_", " ")
              .replace(/^./, (value) => value.toUpperCase())}
          </span>
          {request.hasFounderDraft ? <span>Founder draft saved</span> : null}
        </div>
        <h1>{request.title}</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Original request</CardTitle>
        </CardHeader>
        <CardContent className="source-material">
          {request.source?.question ? (
            <blockquote>{request.source.question}</blockquote>
          ) : null}
          {request.source?.body ? <p>{request.source.body}</p> : null}
          {!request.source ? <p>No source material was supplied.</p> : null}
          {request.source?.url ? (
            <Button
              variant="outline"
              render={
                <a href={request.source.url} target="_blank" rel="noreferrer" />
              }
            >
              Open source <ExternalLink data-icon="inline-end" />
            </Button>
          ) : null}
        </CardContent>
      </Card>
      {operatorItem?.attentionReasons.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Attention required</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 pl-5">
              {operatorItem.attentionReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <SemanticConflictPanel
        conflicts={semanticConflicts}
        principals={principals}
        deliverables={deliverables}
      />
      <DeliverablePanel humanId={request.humanId} deliverables={deliverables} />
      <DeliveryTargetChecklist
        humanId={request.humanId}
        targets={deliveryTargets}
        deliverables={deliverables}
        principals={principals}
      />
      <Card>
        <CardHeader>
          <CardTitle>Assignment</CardTitle>
        </CardHeader>
        <CardContent>
          <RequestAssignmentControl
            key={`${request.humanId}:${request.aggregateVersion}`}
            request={request}
            principals={principals}
          />
        </CardContent>
      </Card>
    </main>
  )
}

function FounderRequestCanvas({
  request,
  contextItems,
  preferenceOwnerKey,
  initialDraft,
  initialDocumentId,
  initialPreferences,
  onPreferencesChange,
}: {
  request: ReturnType<typeof Route.useLoaderData>["request"]
  contextItems: ReturnType<typeof Route.useLoaderData>["contextItems"]
  preferenceOwnerKey: string
  initialDraft: string
  initialDocumentId: string | null
  initialPreferences: ContextDeckPreferences | null
  onPreferencesChange: (
    preferences: ContextDeckPreferences,
    correlationId: string
  ) => Promise<void>
}) {
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
        undo({
          data: { humanId: request.humanId, correlationId },
        }),
      redo: (correlationId: string) =>
        redo({
          data: { humanId: request.humanId, correlationId },
        }),
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
        retryVoiceCapture({
          data: { humanId: request.humanId, captureId },
        }),
      markMerged: (captureId: string) =>
        markVoiceMerged({
          data: { humanId: request.humanId, captureId },
        }),
      discard: (captureId: string) =>
        discardVoiceCapture({
          data: { humanId: request.humanId, captureId },
        }),
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
  })

  return (
    <UnifiedContextCanvas
      request={request}
      contextItems={contextItems}
      preferenceOwnerKey={preferenceOwnerKey}
      initialDraft={initialDraft}
      initialPreferences={initialPreferences}
      onPreferencesChange={onPreferencesChange}
      onSubmitFounderInput={
        ["pending", "in_progress"].includes(request.lifecycle)
          ? async () => {
              const heads = await founderDocument.prepareSubmission()
              if (!heads)
                throw new Error("Founder input is not durably synced.")
              await submitFounder({
                data: {
                  humanId: request.humanId,
                  heads,
                  correlationId: crypto.randomUUID(),
                },
              })
              window.location.assign("/app")
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
        readOnly: !["pending", "in_progress"].includes(request.lifecycle),
        onTextChange: founderDocument.setText,
        onUndo: founderDocument.undo,
        onRedo: founderDocument.redo,
        onLoadOlderHistory: founderDocument.loadOlderHistory,
        onRestoreArchivedVersion: founderDocument.restoreArchivedVersion,
        voice: voiceInput,
      }}
    />
  )
}
