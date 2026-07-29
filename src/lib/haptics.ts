export type HapticIntent = "selection" | "success" | "warning"

const patterns: Record<HapticIntent, number | Array<number>> = {
  selection: 8,
  success: [10, 35, 14],
  warning: [18, 45, 18],
}

export function canUseHaptics() {
  if (
    typeof window === "undefined" ||
    typeof navigator.vibrate !== "function"
  ) {
    return false
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false
  }
  try {
    return window.localStorage.getItem("fairlend:haptics") !== "off"
  } catch {
    return true
  }
}

export function triggerHaptic(
  intent: HapticIntent,
  { touchInitiated = false }: { touchInitiated?: boolean } = {}
) {
  if (!touchInitiated || !canUseHaptics()) return false
  return navigator.vibrate(patterns[intent])
}
