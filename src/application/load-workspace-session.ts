import { createServerFn } from "@tanstack/react-start"

import type { WorkspaceViewSession } from "@/application/workspace-session"

export type WorkspaceSessionResult =
  | { status: "authenticated"; session: WorkspaceViewSession }
  | { status: "unauthenticated" }
  | { status: "forbidden" }

export const loadWorkspaceSession = createServerFn({ method: "POST" }).handler(
  async (): Promise<WorkspaceSessionResult> => {
    const { loadWorkspaceSessionFromRequest } =
      await import("@/application/workspace-session-request.server")
    return loadWorkspaceSessionFromRequest()
  }
)
