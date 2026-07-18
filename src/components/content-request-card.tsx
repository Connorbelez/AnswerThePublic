import { Link } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"

import type { ContentRequest } from "@/application/content-requests"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  requestOriginLabel,
  requestPriorityLabel,
} from "@/lib/content-request-labels"

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
          </div>
          <CardTitle>{request.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            {request.source?.question ??
              `${requestOriginLabel(request.origin)} request`}
          </p>
          <ArrowRight aria-hidden="true" />
        </CardContent>
      </Card>
    </Link>
  )
}
