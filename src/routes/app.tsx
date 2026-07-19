import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"
import { Menu } from "lucide-react"

import { loadWorkspaceSession } from "@/application/load-workspace-session"
import { listMyNotifications } from "@/application/content-request-server-functions"
import type { WorkspaceRole } from "@/application/workspace-session"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { NotificationCentre } from "@/components/notification-centre"
import { SignOutControl } from "@/components/sign-out-control"
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
    return {
      ...result.session,
      notifications: await listMyNotifications(),
    }
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
          <NotificationCentre notifications={session.notifications} />
          <SignOutControl
            ownerKey={`${session.organizationId}:${session.principalId}`}
          />
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
      <Outlet />
    </div>
  )
}
