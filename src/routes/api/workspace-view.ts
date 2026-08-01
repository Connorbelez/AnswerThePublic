import { createFileRoute } from "@tanstack/react-router"

import {
  WORKSPACE_VIEWS,
  authorizeWorkspaceViewSwitch,
  type WorkspaceView,
} from "@/application/workspace-session"

function safeReturnTo(request: Request) {
  const requestUrl = new URL(request.url)
  const referer = request.headers.get("referer")
  if (!referer) return "/app"

  try {
    const returnUrl = new URL(referer)
    if (
      returnUrl.origin === requestUrl.origin &&
      (returnUrl.pathname === "/app" || returnUrl.pathname.startsWith("/app/"))
    ) {
      return `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`
    }
  } catch {
    // An invalid or cross-origin referer must never control the redirect target.
  }

  return "/app"
}

export const Route = createFileRoute("/api/workspace-view")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { loadWorkspaceSessionFromRequest } =
          await import("@/application/workspace-session-request.server")
        const result = await loadWorkspaceSessionFromRequest()

        if (result.status === "unauthenticated") {
          return new Response(null, { status: 401 })
        }
        if (result.status !== "authenticated") {
          return new Response(null, { status: 403 })
        }

        const form = await request.formData()
        const workspaceView = String(form.get("workspaceView") ?? "")
        if (!WORKSPACE_VIEWS.includes(workspaceView as WorkspaceView)) {
          return new Response(null, { status: 400 })
        }

        try {
          authorizeWorkspaceViewSwitch(
            result.session.role,
            workspaceView as WorkspaceView
          )
        } catch {
          return new Response(null, { status: 403 })
        }

        const { createWorkspaceViewCookieHeader } =
          await import("@/application/workspace-view-cookie.server")

        return new Response(null, {
          status: 303,
          headers: {
            Location: safeReturnTo(request),
            "Set-Cookie": createWorkspaceViewCookieHeader(
              workspaceView as WorkspaceView
            ),
          },
        })
      },
    },
  },
})
