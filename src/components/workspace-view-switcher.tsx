import { Eye } from "lucide-react"

import type { WorkspaceView } from "@/application/workspace-session"
import { Button } from "@/components/ui/button"

export function WorkspaceViewSwitcher({
  workspaceView,
}: {
  workspaceView: WorkspaceView
}) {
  const nextWorkspaceView = workspaceView === "operator" ? "elie" : "operator"

  return (
    <form
      className="workspace-view-switcher"
      action="/api/workspace-view"
      method="post"
    >
      <Button
        type="submit"
        name="workspaceView"
        value={nextWorkspaceView}
        variant="outline"
        size="sm"
        aria-label={
          workspaceView === "operator"
            ? "View Elie’s workspace"
            : "Return to admin workspace"
        }
      >
        <Eye aria-hidden="true" />
        <span>
          {workspaceView === "operator"
            ? "View Elie’s workspace"
            : "Return to admin workspace"}
        </span>
      </Button>
    </form>
  )
}
