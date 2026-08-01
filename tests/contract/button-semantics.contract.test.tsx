// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { Button } from "@/components/ui/button"
import { ButtonAnchor } from "@/components/ui/button-link"

function captureConsole() {
  const messages: string[] = []
  vi.spyOn(console, "error").mockImplementation((...args) => {
    messages.push(args.join(" "))
  })
  vi.spyOn(console, "warn").mockImplementation((...args) => {
    messages.push(args.join(" "))
  })
  return messages
}

describe("button element semantics", () => {
  it("uses native button semantics for the default element", () => {
    render(<Button>Save</Button>)

    expect(screen.getByRole("button", { name: "Save" }).tagName).toBe("BUTTON")
  })

  it("preserves native link semantics for anchor actions", () => {
    const messages = captureConsole()

    render(<ButtonAnchor href="/app">Content requests</ButtonAnchor>)

    const link = screen.getByRole("link", { name: "Content requests" })
    expect(link.getAttribute("href")).toBe("/app")
    expect(link.getAttribute("role")).toBeNull()
    expect(messages.join("\n")).not.toContain(
      "expected a native <button> because the `nativeButton` prop is true"
    )
  })
})
