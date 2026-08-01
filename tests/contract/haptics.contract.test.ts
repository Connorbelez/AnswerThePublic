// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

import { triggerHaptic } from "@/lib/haptics"

describe("haptic feedback contract", () => {
  const vibrate = vi.fn(() => true)
  const preferences = new Map<string, string>()

  beforeEach(() => {
    vibrate.mockClear()
    preferences.clear()
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => preferences.clear(),
        getItem: (key: string) => preferences.get(key) ?? null,
        setItem: (key: string, value: string) => preferences.set(key, value),
      },
    })
    Object.defineProperty(window.navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    })
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    })
  })

  it("only vibrates for touch-initiated meaningful actions", () => {
    expect(triggerHaptic("success")).toBe(false)
    expect(vibrate).not.toHaveBeenCalled()

    expect(triggerHaptic("success", { touchInitiated: true })).toBe(true)
    expect(vibrate).toHaveBeenCalledWith([10, 35, 14])
  })

  it("respects reduced-motion and the stored user preference", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    })
    expect(triggerHaptic("selection", { touchInitiated: true })).toBe(false)

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    })
    window.localStorage.setItem("fairlend:haptics", "off")
    expect(triggerHaptic("warning", { touchInitiated: true })).toBe(false)
    expect(vibrate).not.toHaveBeenCalled()
  })
})
