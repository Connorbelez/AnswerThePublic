import { createServerFn } from "@tanstack/react-start"

import type { WorkspaceSession } from "@/application/workspace-session"

export type WorkspaceSessionResult =
  | { status: "authenticated"; session: WorkspaceSession }
  | { status: "unauthenticated" }
  | { status: "forbidden" }

export const loadWorkspaceSession = createServerFn({ method: "POST" }).handler(
  async (): Promise<WorkspaceSessionResult> => {
    const { loadWorkspaceSessionFromRequest } = await import(
      "@/application/workspace-session-request.server"
    )
    return loadWorkspaceSessionFromRequest()
  }
)
