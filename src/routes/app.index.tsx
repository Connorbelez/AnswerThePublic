import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router"
import { Inbox, Plus } from "lucide-react"

import { listContentRequests } from "@/application/content-request-server-functions"
import { ContentRequestCard } from "@/components/content-request-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export const Route = createFileRoute("/app/")({
  loader: () => listContentRequests(),
  component: RequestLibrary,
})

const appRoute = getRouteApi("/app")

function RequestLibrary() {
  const requests = Route.useLoaderData()
  const session = appRoute.useLoaderData()
  const canCreate = session.role !== "founder"

  return (
    <main className="workspace">
      <div className="workspace__heading">
        <div>
          <Badge variant="secondary">Operator workspace</Badge>
          <h1>Content requests</h1>
          <p>Capture, prioritize, and route expert response opportunities.</p>
        </div>
        {canCreate ? (
          <Button render={<Link to="/app/new" />}>
            <Plus data-icon="inline-start" />
            New request
          </Button>
        ) : null}
      </div>

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
        <section className="request-list" aria-label="Content requests">
          {requests.map((request) => (
            <ContentRequestCard key={request.humanId} request={request} />
          ))}
        </section>
      )}
    </main>
  )
}
