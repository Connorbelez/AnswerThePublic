import { useCallback, useEffect, useRef } from "react"
import {
  Link,
  createFileRoute,
  getRouteApi,
  notFound,
} from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { ArrowLeft, ExternalLink } from "lucide-react"

import {
  getContentRequest,
  getContentRequestContext,
  getContextDeckPreferences,
  listAssignablePrincipals,
  openContentRequest,
  saveContextDeckPreferences,
} from "@/application/content-request-server-functions"
import { RequestAssignmentControl } from "@/components/request-assignment-control"
import { UnifiedContextCanvas } from "@/components/unified-context-canvas"
import type { ContextDeckPreferences } from "@/application/content-requests"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  requestOriginLabel,
  requestPriorityLabel,
} from "@/lib/content-request-labels"

export const Route = createFileRoute("/app/requests/$requestId")({
  loader: async ({ params }) => {
    const [request, principals, contextItems, contextDeckPreferences] =
      await Promise.all([
        getContentRequest({ data: { humanId: params.requestId } }),
        listAssignablePrincipals(),
        getContentRequestContext({ data: { humanId: params.requestId } }),
        getContextDeckPreferences({ data: { humanId: params.requestId } }),
      ])
    if (!request) throw notFound()
    return { request, principals, contextItems, contextDeckPreferences }
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
  const { request, principals, contextItems, contextDeckPreferences } =
    Route.useLoaderData()
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
      <UnifiedContextCanvas
        key={request.humanId}
        request={request}
        contextItems={contextItems}
        preferenceOwnerKey={`${session.organizationId}:${session.principalId}`}
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
