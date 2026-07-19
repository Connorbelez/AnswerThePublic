import { useState } from "react"
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router"
import { Inbox, Layers3, LayoutGrid, Plus } from "lucide-react"

import { listContentRequests } from "@/application/content-request-server-functions"
import { ContentRequestCard } from "@/components/content-request-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export const Route = createFileRoute("/app/")({
  loader: () => listContentRequests(),
  component: RequestLibrary,
})

const appRoute = getRouteApi("/app")

function RequestLibrary() {
  const requests = Route.useLoaderData()
  const session = appRoute.useLoaderData()
  const canCreate = session.role !== "founder"
  const isFounder = session.role === "founder"
  const [view, setView] = useState<"stack" | "grid">("stack")

  function updateView(nextView: "stack" | "grid") {
    setView(nextView)
  }

  return (
    <main className="workspace">
      <div className="workspace__heading">
        <div>
          <Badge variant="secondary">
            {isFounder ? "Founder library" : "Operator workspace"}
          </Badge>
          <h1>Content requests</h1>
          <p>
            {isFounder
              ? "Your prioritized queue of expert response opportunities."
              : "Capture, prioritize, and route expert response opportunities."}
          </p>
        </div>
        {canCreate ? (
          <Button render={<Link to="/app/new" />}>
            <Plus data-icon="inline-start" />
            New request
          </Button>
        ) : null}
      </div>

      {requests.length > 0 ? (
        <div className="library-controls">
          <span>
            {requests.length} assigned request{requests.length === 1 ? "" : "s"}
          </span>
          <ToggleGroup
            aria-label="Library view"
            value={[view]}
            onValueChange={(values) => {
              const nextView = values[0]
              if (nextView === "stack" || nextView === "grid")
                updateView(nextView)
            }}
            variant="outline"
            spacing={0}
          >
            <ToggleGroupItem value="stack" aria-label="Stack view">
              <Layers3 />
            </ToggleGroupItem>
            <ToggleGroupItem value="grid" aria-label="Grid view">
              <LayoutGrid />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : null}

      {requests.length === 0 ? (
        <Card className="empty-queue">
          <CardContent>
            <span className="empty-queue__icon" aria-hidden="true">
              <Inbox />
            </span>
            <h2>No requests yet</h2>
            <p>
              {canCreate
                ? "Add a direct request for Elie. Only a title is required; source material and context can be filled in when available."
                : "Assigned requests will appear here when they are ready for your input."}
            </p>
            {canCreate ? (
              <Button className="mobile-create" render={<Link to="/app/new" />}>
                <Plus data-icon="inline-start" />
                Create a request
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <section
          className={`request-list request-list--${view}`}
          aria-label="Content requests"
          data-view={view}
        >
          {requests.map((request) => (
            <ContentRequestCard key={request.humanId} request={request} />
          ))}
        </section>
      )}
    </main>
  )
}
