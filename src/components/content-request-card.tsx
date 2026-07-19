import { Link } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"

import type { ContentRequest } from "@/application/content-requests"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  requestOriginLabel,
  requestPriorityLabel,
} from "@/lib/content-request-labels"

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
  }).format(timestamp)
}

export function ContentRequestCard({ request }: { request: ContentRequest }) {
  return (
    <Link
      className="request-card-link"
      to="/app/requests/$requestId"
      params={{ requestId: request.humanId }}
    >
      <Card className="request-card">
        <CardHeader>
          <div className="request-card__meta">
            <Badge
              variant={
                request.priority === "critical" ? "destructive" : "secondary"
              }
            >
              {requestPriorityLabel(request.priority)}
            </Badge>
            <span>{request.humanId}</span>
            <span>{requestOriginLabel(request.origin)}</span>
            <time dateTime={new Date(request.createdAt).toISOString()}>
              Created {formatTimestamp(request.createdAt)}
            </time>
            {request.firstOpenedAt ? (
              <time dateTime={new Date(request.firstOpenedAt).toISOString()}>
                First opened {formatTimestamp(request.firstOpenedAt)}
              </time>
            ) : (
              <span>Unopened</span>
            )}
          </div>
          <CardTitle>{request.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            {request.source?.question ??
              `${requestOriginLabel(request.origin)} request`}
          </p>
          <span className="request-card__assignee">
            Assigned to {request.assignee.subject}
            {request.latestOpenedAt
              ? ` · Latest open ${formatTimestamp(request.latestOpenedAt)}`
              : ""}
          </span>
          <ArrowRight aria-hidden="true" />
        </CardContent>
      </Card>
    </Link>
  )
}
