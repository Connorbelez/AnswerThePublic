import { createFileRoute, redirect } from "@tanstack/react-router"
import { Inbox, Menu, Plus } from "lucide-react"

import { loadWorkspaceSession } from "@/application/load-workspace-session"
import type { WorkspaceRole } from "@/application/workspace-session"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

const roleLabels = {
  founder: "Founder",
  operator_editor: "Operator / editor",
  agent_editor: "Agent editor",
  administrator: "Administrator",
} satisfies Record<WorkspaceRole, string>

export const Route = createFileRoute("/app")({
  loader: async () => {
    const result = await loadWorkspaceSession()
    if (result.status === "unauthenticated") {
      throw redirect({ to: "/sign-in", search: { returnTo: "/app" } })
    }
    if (result.status === "forbidden") {
      throw redirect({ to: "/unauthorized" })
    }
    return result.session
  },
  component: ApplicationShell,
})

function ApplicationShell() {
  const session = Route.useLoaderData()
  const initials = session.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <Button variant="ghost" size="icon" aria-label="Open navigation">
            <Menu />
          </Button>
          <span className="wordmark">FairLend</span>
        </div>
        <div className="identity">
          <div className="identity__copy">
            <strong>{session.displayName}</strong>
            <span>{roleLabels[session.role]}</span>
          </div>
          <Avatar>
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </div>
      </header>

      <Separator />

      <main className="workspace">
        <div className="workspace__heading">
          <div>
            <Badge variant="secondary">Workspace foundation</Badge>
            <h1>Content requests</h1>
            <p>Your prioritized briefs will live here.</p>
          </div>
          <Button disabled title="Manual requests arrive in Ticket 02">
            <Plus data-icon="inline-start" />
            New request
          </Button>
        </div>

        <Card className="empty-queue">
          <CardContent>
            <span className="empty-queue__icon" aria-hidden="true">
              <Inbox />
            </span>
            <h2>The application boundary is ready</h2>
            <p>
              You are authenticated as <strong>{session.email}</strong>. Request
              creation and the Variant G canvas are delivered by the next tickets.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
