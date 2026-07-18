import { Link, createFileRoute, notFound } from "@tanstack/react-router"
import { ArrowLeft, ExternalLink } from "lucide-react"

import { getContentRequest } from "@/application/content-request-server-functions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  requestOriginLabel,
  requestPriorityLabel,
} from "@/lib/content-request-labels"

export const Route = createFileRoute("/app/requests/$requestId")({
  loader: async ({ params }) => {
    const request = await getContentRequest({
      data: { humanId: params.requestId },
    })
    if (!request) throw notFound()
    return request
  },
  component: ContentRequestPage,
})

function ContentRequestPage() {
  const request = Route.useLoaderData()
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
    </main>
  )
}
