// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MarkdownContent } from "@/components/markdown-content"

describe("MarkdownContent", () => {
  it("renders source markdown as semantic Shadcn Typeset content", () => {
    const { container } = render(
      <MarkdownContent>{`### Opportunity — Score: 78/100

- **Thread:** [What happens after paying off a mortgage?](https://www.reddit.com/example)
- **Recommended response:** Answer without link`}</MarkdownContent>
    )

    expect(
      screen.getByRole("heading", { name: "Opportunity — Score: 78/100" })
    ).not.toBeNull()
    expect(screen.getByText("Thread:").tagName).toBe("STRONG")
    expect(
      screen
        .getByRole("link", {
          name: "What happens after paying off a mortgage?",
        })
        .getAttribute("target")
    ).toBe("_blank")
    expect(container.firstElementChild?.classList.contains("typeset")).toBe(
      true
    )
    expect(
      container.firstElementChild?.classList.contains("typeset-request")
    ).toBe(true)
    expect(container.textContent).not.toContain("###")
    expect(container.textContent).not.toContain("**")
  })

  it("does not execute embedded HTML", () => {
    const { container } = render(
      <MarkdownContent>{`Safe <script>alert("nope")</script> content`}</MarkdownContent>
    )

    expect(container.querySelector("script")).toBeNull()
  })

  it("makes wide tables keyboard-scrollable", () => {
    render(
      <MarkdownContent>{`| Channel | Status |
| --- | --- |
| Reddit | Ready |`}</MarkdownContent>
    )

    const tableRegion = screen.getByRole("region", {
      name: "Scrollable table",
    })
    expect(tableRegion.getAttribute("tabindex")).toBe("0")
    expect(tableRegion.querySelector("table")).not.toBeNull()
  })
})
