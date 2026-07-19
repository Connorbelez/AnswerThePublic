// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { applicationNavigationItemVariants } from "@/components/application-navigation-variants"
import { contextCardVariants } from "@/components/context-card-variants"
import { requestListVariants } from "@/components/request-list-variants"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardTitle, cardVariants } from "@/components/ui/card"

function firstPartyInterfaceFiles(directory: string): Array<string> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (path.endsWith("/components/ui")) return []
      return firstPartyInterfaceFiles(path)
    }
    return entry.name.endsWith(".tsx") && !entry.name.includes(" 2.")
      ? [path]
      : []
  })
}

describe("UI system contract", () => {
  it("routes first-party interactive controls through shadcn primitives", () => {
    const files = [
      ...firstPartyInterfaceFiles(join(process.cwd(), "src/components")),
      ...firstPartyInterfaceFiles(join(process.cwd(), "src/routes")),
    ]
    const rawInteractiveControls = files.flatMap((file) => {
      const source = readFileSync(file, "utf8")
      return /<(button|input|textarea|select)\b/.test(source) ? [file] : []
    })

    expect(rawInteractiveControls).toEqual([])
  })

  it("keeps reusable interaction and surface states in typed CVA variants", () => {
    expect(buttonVariants()).toContain("transition-[color,background-color")
    expect(buttonVariants()).not.toContain("transition-all")
    expect(cardVariants({ tone: "elevated" })).toContain(
      "shadow-[0_20px_60px_rgb(30_45_35/0.10)]"
    )
    expect(applicationNavigationItemVariants({ active: true })).toContain(
      "bg-primary"
    )
    expect(contextCardVariants({ pinned: true })).toContain("is-pinned")
    expect(requestListVariants({ view: "grid" })).toContain(
      "request-list--grid"
    )
  })

  it("renders polished primitives with semantic headings and press feedback", () => {
    render(
      <Card tone="elevated">
        <CardTitle as="h2">Delivery status</CardTitle>
        <Button>Confirm delivery</Button>
      </Card>
    )

    expect(
      screen.getByRole("heading", { level: 2, name: "Delivery status" })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Confirm delivery" })
    ).toHaveProperty(
      "className",
      expect.stringContaining("active:scale-[0.97]")
    )
  })
})
