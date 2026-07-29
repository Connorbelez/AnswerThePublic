import { Link } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"

import type {
  ContentRequest,
  OperatorWorkspaceItem,
} from "@/application/content-requests"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FounderHandoffStatusCard } from "@/components/founder-handoff-status"
import { RequestClassificationBadge } from "@/components/request-classification-badge"
import {
  requestOriginLabel,
  requestPriorityLabel,
} from "@/lib/content-request-labels"
import { getRequestClassification } from "@/lib/request-classification"

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
      <Card
        className="request-card"
        data-priority={request.priority}
        data-attention={
          operational?.queue === "attention_required" ? "true" : "false"
        }
      >
        <CardHeader className="request-card__header">
          <div className="request-card__signal">
            <Badge
              variant={
                request.priority === "critical" ? "destructive" : "secondary"
              }
            >
              {requestPriorityLabel(request.priority)}
            </Badge>
            <span className="request-card__status">
              {lifecycleLabels[request.lifecycle]}
            </span>
            {operational?.founderHandoff ? (
              <FounderHandoffStatusCard
                handoff={operational.founderHandoff}
                variant="compact"
              />
            ) : null}
            <span className="request-card__id">{request.humanId}</span>
          </div>
          <CardTitle as="h2">{request.title}</CardTitle>
          <div className="request-card__context">
            <RequestClassificationBadge
              classification={getRequestClassification(request)}
            />
            {request.retention === "archived" ? (
              <span>Archived</span>
            ) : request.disposition === "expired" ? (
              <span>Expired</span>
            ) : null}
            {request.timingLabel ? <span>{request.timingLabel}</span> : null}
            {request.expiresAt ? (
              <time dateTime={new Date(request.expiresAt).toISOString()}>
                Expires {formatTimestamp(request.expiresAt)}
              </time>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="request-card__body">
          <p className="request-card__question">
            {request.source?.question ??
              `${requestOriginLabel(request.origin)} request`}
          </p>
          <div className="request-card__footer">
            <div className="request-card__ownership">
              <span>
                Assigned to <strong>{request.assignee.subject}</strong>
              </span>
              {request.latestOpenedAt ? (
                <span>
                  Latest open {formatTimestamp(request.latestOpenedAt)}
                </span>
              ) : null}
            </div>
            <div className="request-card__dates">
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
            <span className="request-card__arrow" aria-hidden="true">
              <ArrowRight />
            </span>
          </div>
          {request.hasFounderDraft || operational ? (
            <div className="request-card__supplemental">
              {request.hasFounderDraft ? (
                <Badge variant="outline">Founder draft saved</Badge>
              ) : null}
              {operational ? (
                <div
                  className="request-card__operational"
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
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  )
}
