import { Link } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"

import type {
  ContentRequest,
  OperatorWorkspaceItem,
} from "@/application/content-requests"
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

const queueLabels: Record<OperatorWorkspaceItem["queue"], string> = {
  needs_elie: "Needs Elie",
  agent_drafting: "Agent drafting",
  needs_operator: "Needs operator",
  delivered: "Delivered",
  attention_required: "Attention required",
}

const lifecycleLabels: Record<ContentRequest["lifecycle"], string> = {
  pending: "Pending",
  in_progress: "In progress",
  founder_complete: "Founder complete",
  ready_to_respond: "Ready to respond",
  responded: "Responded",
}

export function ContentRequestCard({
  request,
  operational,
}: {
  request: ContentRequest
  operational?: Omit<OperatorWorkspaceItem, "request">
}) {
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
            <span>{lifecycleLabels[request.lifecycle]}</span>
            {request.timingLabel ? <span>{request.timingLabel}</span> : null}
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
          {request.hasFounderDraft ? (
            <Badge variant="outline">Founder draft saved</Badge>
          ) : null}
          {operational ? (
            <div
              className="flex flex-wrap gap-2"
              aria-label="Operational status"
            >
              <Badge
                variant={
                  operational.queue === "attention_required"
                    ? "destructive"
                    : "secondary"
                }
              >
                {queueLabels[operational.queue]}
              </Badge>
              <Badge variant="outline">
                Job: {operational.agentJobStatus ?? "not started"}
              </Badge>
              <Badge variant="outline">
                Delivery {operational.requiredDeliveryConfirmed}/
                {operational.requiredDeliveryTotal}
              </Badge>
              {operational.openConflictCount ? (
                <Badge variant="destructive">
                  {operational.openConflictCount} open conflict
                  {operational.openConflictCount === 1 ? "" : "s"}
                </Badge>
              ) : null}
              {operational.attentionReasons.map((reason) => (
                <Badge key={reason} variant="destructive">
                  {reason}
                </Badge>
              ))}
            </div>
          ) : null}
          <ArrowRight aria-hidden="true" />
        </CardContent>
      </Card>
    </Link>
  )
}
