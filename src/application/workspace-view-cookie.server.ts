import { getCookie } from "@tanstack/react-start/server"
import { serializeCookie } from "cookie-es"

import type { WorkspaceView } from "@/application/workspace-session"

const WORKSPACE_VIEW_COOKIE = "fairlend-workspace-view"

export function readWorkspaceViewCookie() {
  return getCookie(WORKSPACE_VIEW_COOKIE)
}

export function createWorkspaceViewCookieHeader(workspaceView: WorkspaceView) {
  return serializeCookie(WORKSPACE_VIEW_COOKIE, workspaceView, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" && import.meta.env.MODE !== "e2e",
  })
}
