import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"

import {
  getContentRequest,
  getExpertInterview,
  inspectGuestResponseWorkspace,
  getContentRequestRelations,
  getContentRequestContext,
  getContextDeckPreferences,
  getFounderInput,
  searchPeople,
  listGuestAccessGrants,
  listExpertInterviewSubmissions,
  listAssignablePrincipals,
  listDeliverables,
  listArchivedDeliveryTargets,
  listDeliveryTargets,
  listOpenSemanticConflicts,
  listPublicShares,
  listOperatorWorkspace,
  openContentRequest,
  saveContextDeckPreferences,
} from "@/application/content-request-server-functions"
import { RequestAssignmentControl } from "@/components/request-assignment-control"
import { RequestDispositionControls } from "@/components/request-disposition-controls"
import { SemanticConflictPanel } from "@/components/semantic-conflict-panel"
import { DeliverablePanel } from "@/components/deliverable-panel"
import { DeliveryTargetChecklist } from "@/components/delivery-target-checklist"
import { PublicShareManager } from "@/components/public-share-manager"
import { ExpertInterviewBriefView } from "@/components/expert-interview-brief"
import { ExpertSynthesisServerPanel } from "@/components/expert-synthesis-panel"
import { GuestAccessGrantPanel } from "@/components/guest-access-grant-panel"
import { GuestResponseAdminServerPanel } from "@/components/guest-response-admin-panel"
import { OpportunityAssessment, TriageInbox } from "@/components/triage-inbox"
import { OpportunityDecisionPanel } from "@/components/opportunity-decision-panel"
import type { ContextDeckPreferences } from "@/application/content-requests"
import {
  contentFormatDefinitions,
  type ContentFormat,
} from "@/application/promote-opportunity"
import { extractOpportunityBrief } from "@/lib/opportunity-brief"

const FounderRequestCanvas = lazy(() =>
  import("@/components/founder-request-canvas").then((module) => ({
    default: module.FounderRequestCanvas,
  }))
)

export const Route = createFileRoute("/app/requests/$requestId")({
  ssr: "data-only",
  loader: async ({ params, context }) => {
    const session = context.workspaceSession
    const [
      request,
      principals,
      contextItems,
      contextDeckPreferences,
      founderInput,
      semanticConflicts,
      deliverables,
      deliveryTargets,
      archivedDeliveryTargets,
      operatorWorkspace,
      relations,
      publicShares,
      expertInterview,
      peopleResult,
      guestAccessGrants,
    ] = await Promise.all([
      getContentRequest({ data: { humanId: params.requestId } }),
      listAssignablePrincipals(),
      getContentRequestContext({ data: { humanId: params.requestId } }),
      getContextDeckPreferences({
        data: {
          humanId: params.requestId,
          founderWorkspace: session.workspaceView === "elie",
        },
      }),
      session.workspaceView === "elie"
        ? getFounderInput({ data: { humanId: params.requestId } })
        : Promise.resolve(null),
      session.workspaceView !== "elie"
        ? listOpenSemanticConflicts({ data: { humanId: params.requestId } })
        : Promise.resolve([]),
      session.workspaceView !== "elie"
        ? listDeliverables({ data: { humanId: params.requestId } })
        : Promise.resolve([]),
      session.workspaceView !== "elie"
        ? listDeliveryTargets({ data: { humanId: params.requestId } })
        : Promise.resolve([]),
      session.workspaceView !== "elie"
        ? listArchivedDeliveryTargets({
            data: { humanId: params.requestId, cursor: null },
          })
        : Promise.resolve({ page: [], nextCursor: null }),
      session.workspaceView !== "elie"
        ? listOperatorWorkspace({
            data: { search: params.requestId, limit: 1 },
          })
        : Promise.resolve(null),
      session.workspaceView !== "elie"
        ? getContentRequestRelations({ data: { humanId: params.requestId } })
        : Promise.resolve({
            parent: null,
            children: [],
            childrenTruncated: false,
          }),
      session.workspaceView !== "elie"
        ? listPublicShares({ data: { humanId: params.requestId } })
        : Promise.resolve([]),
      getExpertInterview({ data: { humanId: params.requestId } }),
      session.workspaceView !== "elie"
        ? searchPeople({ data: { query: "", limit: 50 } })
        : Promise.resolve({ people: [], defaultPersonId: null }),
      session.workspaceView !== "elie"
        ? listGuestAccessGrants({ data: { humanId: params.requestId } })
        : Promise.resolve([]),
    ])
    if (!request) throw notFound()
    const expertSynthesisSubmissions =
      session.workspaceView !== "elie" && expertInterview
        ? await listExpertInterviewSubmissions({
            data: { humanId: params.requestId },
          })
        : []
    const guestResponseWorkspaces =
      session.workspaceView !== "elie"
        ? (
            await Promise.all(
              guestAccessGrants.map(({ grantId }) =>
                inspectGuestResponseWorkspace({ data: { grantId } })
              )
            )
          ).filter((view) => view !== null)
        : []
    return {
      request,
      principals,
      contextItems,
      contextDeckPreferences,
      founderInput,
      semanticConflicts,
      deliverables,
      deliveryTargets: [...deliveryTargets, ...archivedDeliveryTargets.page],
      archivedDeliveryTargetCursor: archivedDeliveryTargets.nextCursor,
      operatorItems: operatorWorkspace?.page ?? [],
      relations,
      publicShares,
      expertInterview,
      people: peopleResult.people,
      defaultPersonId: peopleResult.defaultPersonId,
      guestAccessGrants,
      guestResponseWorkspaces,
      expertSynthesisSubmissions,
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
    archivedDeliveryTargetCursor,
    operatorItems,
    relations,
    publicShares,
    expertInterview,
    people,
    defaultPersonId,
    guestAccessGrants,
    guestResponseWorkspaces,
    expertSynthesisSubmissions,
  } = Route.useLoaderData()
  const session = appRoute.useLoaderData()
  const requestIsActive =
    request.retention === "active" && request.disposition === "active"
  const requestIsMutable =
    requestIsActive && ["pending", "in_progress"].includes(request.lifecycle)
  const brief = useMemo(
    () => extractOpportunityBrief(request.source?.body),
    [request.source?.body]
  )
  const queueItems = useMemo(() => {
    if (
      operatorItems.some((item) => item.request.humanId === request.humanId)
    ) {
      return operatorItems
    }
    return [
      {
        request,
        queue: "needs_operator" as const,
        agentJobStatus: null,
        founderHandoff: null,
        requiredDeliveryConfirmed: 0,
        requiredDeliveryTotal: 0,
        openConflictCount: semanticConflicts.length,
        attentionReasonCount: semanticConflicts.length,
        attentionReasons: semanticConflicts.map(
          () => "A concurrent edit requires review."
        ),
        deliveryChannels: [],
        nextActionChangedAt: request.updatedAt,
      },
      ...operatorItems,
    ]
  }, [operatorItems, request, semanticConflicts])
  const operatorItem = queueItems.find(
    (item) => item.request.humanId === request.humanId
  )
  const suggestedFormats = useMemo(() => {
    const known = new Set(
      contentFormatDefinitions.map((definition) => definition.id)
    )
    const selected = new Set<ContentFormat>(["original_response"])
    for (const deliverable of deliverables) {
      if (known.has(deliverable.kind as ContentFormat)) {
        selected.add(deliverable.kind as ContentFormat)
      }
    }
    if (request.origin === "automated_scout") {
      selected.add("blog_article")
      selected.add("linkedin_post")
    }
    return contentFormatDefinitions
      .map((definition) => definition.id)
      .filter((format) => selected.has(format))
  }, [deliverables, request.origin])
  const [formatSelection, setFormatSelection] = useState<{
    humanId: string
    formats: Array<ContentFormat>
  }>({ humanId: request.humanId, formats: suggestedFormats })
  const formats =
    formatSelection.humanId === request.humanId
      ? formatSelection.formats
      : suggestedFormats
  const setFormats = (nextFormats: Array<ContentFormat>) => {
    setFormatSelection({ humanId: request.humanId, formats: nextFormats })
  }
  const founder =
    (request.assignee.role === "founder" ? request.assignee : null) ??
    principals.find((principal) => principal.role === "founder") ??
    null
  const recordOpen = useServerFn(openContentRequest)
  const persistContextDeckPreferences = useServerFn(saveContextDeckPreferences)
  const handleContextDeckPreferences = useCallback(
    async (preferences: ContextDeckPreferences, correlationId: string) => {
      if (!requestIsActive) return
      await persistContextDeckPreferences({
        data: {
          humanId: request.humanId,
          preferences,
          correlationId,
          founderWorkspace: session.workspaceView === "elie",
        },
      })
    },
    [
      persistContextDeckPreferences,
      request.humanId,
      requestIsActive,
      session.workspaceView,
    ]
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
  if (session.workspaceView === "elie") {
    return (
      <Suspense
        fallback={
          <main
            className="founder-canvas-pending"
            id="main-content"
            aria-busy="true"
          >
            <h1>{request.title}</h1>
            <p role="status">Preparing the collaborative editor…</p>
          </main>
        }
      >
        <FounderRequestCanvas
          key={request.humanId}
          request={request}
          contextItems={contextItems}
          preferenceOwnerKey={`${session.organizationId}:${session.principalId}`}
          initialDraft={founderInput?.text ?? ""}
          initialDocumentId={founderInput?.automergeDocumentId ?? null}
          initialPreferences={contextDeckPreferences}
          requestActive={requestIsActive}
          founderInputMutable={requestIsMutable}
          onPreferencesChange={
            requestIsActive ? handleContextDeckPreferences : undefined
          }
        />
      </Suspense>
    )
  }
  return (
    <TriageInbox
      queueItems={queueItems}
      activeHumanId={request.humanId}
      selectedFormatCount={formats.length}
      decision={
        <OpportunityDecisionPanel
          key={`desktop:${request.humanId}`}
          humanId={request.humanId}
          recipient={founder}
          formats={formats}
          onFormatsChange={setFormats}
          risk={brief.risk}
          readOnly={!requestIsActive}
          founderHandoff={operatorItem?.founderHandoff ?? null}
        />
      }
      mobileDecision={
        <OpportunityDecisionPanel
          key={`mobile:${request.humanId}`}
          humanId={request.humanId}
          recipient={founder}
          formats={formats}
          onFormatsChange={setFormats}
          risk={brief.risk}
          readOnly={!requestIsActive}
          compact
          founderHandoff={operatorItem?.founderHandoff ?? null}
        />
      }
      mobileActionDecision={
        <OpportunityDecisionPanel
          key={`mobile-action:${request.humanId}`}
          humanId={request.humanId}
          recipient={founder}
          formats={formats}
          onFormatsChange={setFormats}
          risk={brief.risk}
          readOnly={!requestIsActive}
          compact
          actionBar
          founderHandoff={operatorItem?.founderHandoff ?? null}
        />
      }
      assessment={
        <OpportunityAssessment request={request} brief={brief}>
          {operatorItem?.attentionReasons.length ? (
            <section className="triage-attention" role="alert">
              <h2>Attention required</h2>
              <ul>
                {operatorItem.attentionReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {!requestIsActive ? (
            <section className="triage-attention" role="status">
              <h2>Read-only opportunity</h2>
              <p>
                This request is{" "}
                {request.retention === "archived" ? "archived" : "expired"}.
                Restore it from record options before changing its route or
                outputs.
              </p>
            </section>
          ) : null}

          {expertInterview ? (
            <ExpertInterviewBriefView expertInterview={expertInterview} />
          ) : null}

          <GuestAccessGrantPanel
            humanId={request.humanId}
            people={people}
            defaultPersonId={defaultPersonId}
            grants={guestAccessGrants}
            disabled={!requestIsActive}
          />
          <GuestResponseAdminServerPanel
            disabled={!requestIsActive}
            views={guestResponseWorkspaces}
          />
          {expertInterview ? (
            <ExpertSynthesisServerPanel
              deliverables={deliverables}
              disabled={!requestIsActive}
              humanId={request.humanId}
              submissions={expertSynthesisSubmissions}
            />
          ) : null}

          <details className="triage-advanced">
            <summary>Record options &amp; delivery</summary>
            <div className="triage-advanced__content">
              <SemanticConflictPanel
                conflicts={semanticConflicts}
                principals={principals}
                deliverables={deliverables}
                readOnly={!requestIsActive}
              />
              <RequestDispositionControls
                request={request}
                relations={relations}
              />
              <DeliverablePanel
                humanId={request.humanId}
                deliverables={deliverables}
                readOnly={!requestIsActive}
              />
              <DeliveryTargetChecklist
                humanId={request.humanId}
                targets={deliveryTargets}
                initialArchivedCursor={archivedDeliveryTargetCursor}
                deliverables={deliverables}
                principals={principals}
                readOnly={!requestIsActive}
              />
              <PublicShareManager
                humanId={request.humanId}
                contextItems={contextItems}
                deliverables={deliverables}
                shares={publicShares}
              />
              {requestIsActive ? (
                <div className="triage-advanced__assignment">
                  <h3>Reassign or add watchers</h3>
                  <RequestAssignmentControl
                    key={`${request.humanId}:${request.aggregateVersion}`}
                    request={request}
                    principals={principals}
                  />
                </div>
              ) : null}
            </div>
          </details>
        </OpportunityAssessment>
      }
    />
  )
}
