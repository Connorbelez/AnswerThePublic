import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"
import { House, Menu } from "lucide-react"

import { loadWorkspaceSession } from "@/application/load-workspace-session"
import { listMyNotifications } from "@/application/content-request-server-functions"
import type {
  WorkspaceRole,
  WorkspaceViewSession,
} from "@/application/workspace-session"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { NotificationCentre } from "@/components/notification-centre"
import { SignOutControl } from "@/components/sign-out-control"
import { ThemeToggle } from "@/components/theme-toggle"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { WorkspaceViewSwitcher } from "@/components/workspace-view-switcher"
import { useHydrated } from "@/hooks/use-hydrated"

const roleLabels = {
  founder: "Founder",
  operator_editor: "Operator / editor",
  agent_editor: "Agent editor",
  administrator: "Administrator",
} satisfies Record<WorkspaceRole, string>

const expertisePrototypeSession = {
  subject: "prototype:admin",
  organizationId: "org_fairlend",
  email: "prototype@fairlend.ca",
  displayName: "Prototype Admin",
  role: "administrator",
  principalId: "prototype-admin",
  workspaceView: "operator",
} satisfies WorkspaceViewSession

export const Route = createFileRoute("/app")({
  beforeLoad: async ({ location }) => {
    if (
      import.meta.env.MODE === "e2e" &&
      location.pathname === "/app/expertise-prototype"
    ) {
      return { workspaceSession: expertisePrototypeSession }
    }
    const result = await loadWorkspaceSession()
    if (result.status === "unauthenticated") {
      throw redirect({ to: "/sign-in", search: { returnTo: "/app" } })
    }
    if (result.status === "forbidden") {
      throw redirect({ to: "/unauthorized" })
    }
    return { workspaceSession: result.session }
  },
  loader: async ({ context, location }) => {
    return {
      ...context.workspaceSession,
      notifications:
        import.meta.env.MODE === "e2e" &&
        location.pathname === "/app/expertise-prototype"
          ? []
          : await listMyNotifications(),
    }
  },
  component: ApplicationShell,
})

function ApplicationShell() {
  const session = Route.useLoaderData()
  const hydrated = useHydrated()
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
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  className="app-header__menu-trigger"
                  variant="ghost"
                  size="icon"
                  aria-label="Open navigation"
                  disabled={!hydrated}
                />
              }
            >
              <Menu />
            </SheetTrigger>
            <SheetContent side="left" className="app-navigation-sheet">
              <SheetHeader>
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>
                  Return to the content request gallery.
                </SheetDescription>
              </SheetHeader>
              <nav
                className="app-navigation-sheet__links"
                aria-label="Application"
              >
                <SheetClose
                  render={<ButtonLink to="/app" variant="ghost" size="lg" />}
                >
                  <House data-icon="inline-start" />
                  Content request gallery
                </SheetClose>
              </nav>
              <div className="app-navigation-sheet__account">
                {session.role === "administrator" ? (
                  <WorkspaceViewSwitcher
                    workspaceView={session.workspaceView}
                  />
                ) : null}
                <SignOutControl
                  ownerKey={`${session.organizationId}:${session.principalId}`}
                />
              </div>
            </SheetContent>
          </Sheet>
          <ButtonLink
            className="app-header__home"
            to="/app"
            variant="ghost"
            aria-label="FairLend content requests"
          >
            <span className="wordmark">FairLend</span>
            <span className="app-header__product">Content requests</span>
          </ButtonLink>
        </div>
        <div className="identity">
          {session.role === "administrator" ? (
            <WorkspaceViewSwitcher workspaceView={session.workspaceView} />
          ) : null}
          <ThemeToggle />
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
