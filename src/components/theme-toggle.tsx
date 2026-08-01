import { Monitor, Moon, Sun } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const themeDetails = {
  system: { label: "System", icon: Monitor, next: "light" },
  light: { label: "Light", icon: Sun, next: "dark" },
  dark: { label: "Dark", icon: Moon, next: "system" },
} as const

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const current = themeDetails[theme]
  const Icon = current.icon
  const nextLabel = themeDetails[current.next].label

  return (
    <Button
      className={cn("theme-toggle", className)}
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setTheme(current.next)}
      aria-label={`Theme: ${current.label}. Switch to ${nextLabel.toLowerCase()} theme`}
      title={`Theme: ${current.label}`}
    >
      <Icon aria-hidden="true" />
    </Button>
  )
}
