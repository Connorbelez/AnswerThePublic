// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { WorkspaceViewSwitcher } from "@/components/workspace-view-switcher"

describe("administrator workspace view switcher", () => {
  it("posts the alternate workspace through a native document navigation", () => {
    render(<WorkspaceViewSwitcher workspaceView="operator" />)

    const switchButton = screen.getByRole("button", {
      name: "View Elie’s workspace",
    })
    const form = switchButton.closest("form")
    expect(form?.getAttribute("action")).toBe("/api/workspace-view")
    expect(form?.getAttribute("method")).toBe("post")
    expect(switchButton.getAttribute("name")).toBe("workspaceView")
    expect((switchButton as HTMLButtonElement).value).toBe("elie")
  })

  it("returns from Elie's QA projection to the admin workspace", () => {
    render(<WorkspaceViewSwitcher workspaceView="elie" />)

    const switchButton = screen.getByRole("button", {
      name: "Return to admin workspace",
    })
    expect((switchButton as HTMLButtonElement).value).toBe("operator")
  })
})
