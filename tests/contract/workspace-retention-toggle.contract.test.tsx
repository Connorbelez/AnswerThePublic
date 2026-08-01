// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { WorkspaceRetentionToggle } from "@/components/workspace-retention-toggle"

describe("Workspace retention toggle", () => {
  it("keeps the archive visible and switches directly to archived requests", () => {
    const onChange = vi.fn()

    render(<WorkspaceRetentionToggle value="active" onChange={onChange} />)

    expect(
      screen.getByRole("button", { name: "View archived requests" })
    ).toBeTruthy()

    fireEvent.click(
      screen.getByRole("button", { name: "View archived requests" })
    )

    expect(onChange).toHaveBeenCalledWith("archived")
  })
})
