// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer"

function DrawerFixture({ showOverlay }: { showOverlay?: boolean }) {
  return (
    <Drawer open>
      <DrawerContent showOverlay={showOverlay}>
        <DrawerTitle>Drawer fixture</DrawerTitle>
        <DrawerDescription>Drawer primitive contract.</DrawerDescription>
      </DrawerContent>
    </Drawer>
  )
}

describe("Drawer primitive", () => {
  afterEach(cleanup)

  it("preserves the modal overlay and real drag handle by default", () => {
    render(<DrawerFixture />)

    expect(screen.getByRole("dialog", { name: "Drawer fixture" })).toBeTruthy()
    expect(document.querySelector('[data-slot="drawer-overlay"]')).toBeTruthy()
    expect(document.querySelector('[data-slot="drawer-handle"]')).toBeTruthy()
  })

  it("can omit only the overlay for a non-modal drawer", () => {
    render(<DrawerFixture showOverlay={false} />)

    expect(document.querySelector('[data-slot="drawer-overlay"]')).toBeNull()
    expect(document.querySelector('[data-slot="drawer-handle"]')).toBeTruthy()
  })
})
