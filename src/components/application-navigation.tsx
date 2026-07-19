import { useState } from "react"
import { Link, useLocation } from "@tanstack/react-router"
import { Inbox, Menu, Plus } from "lucide-react"

import { applicationNavigationItemVariants } from "@/components/application-navigation-variants"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

const navigationItems = [
  {
    label: "Content requests",
    description: "Review the active queue",
    to: "/app" as const,
    icon: Inbox,
  },
  {
    label: "New request",
    description: "Capture a direct ask",
    to: "/app/new" as const,
    icon: Plus,
  },
]

export function ApplicationNavigation({
  canCreateRequest,
}: {
  canCreateRequest: boolean
}) {
  const [open, setOpen] = useState(false)
  const pathname = useLocation({ select: (location) => location.pathname })

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            size="icon-touch"
            aria-label="Open navigation"
          />
        }
      >
        <Menu />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(20rem,calc(100vw-1rem))] border-r-white/40 bg-popover/92 p-0 supports-backdrop-filter:backdrop-blur-2xl"
      >
        <SheetHeader className="border-b border-border/70 px-5 py-5">
          <SheetTitle className="wordmark text-xl">FairLend</SheetTitle>
          <SheetDescription>Content Requests workspace</SheetDescription>
        </SheetHeader>
        <nav aria-label="Primary navigation" className="grid gap-1.5 px-3 py-4">
          {navigationItems
            .filter((item) => item.to !== "/app/new" || canCreateRequest)
            .map((item) => {
              const active =
                item.to === "/app"
                  ? pathname === "/app" || pathname.startsWith("/app/requests/")
                  : pathname === item.to
              const Icon = item.icon

              return (
                <Button
                  key={item.to}
                  variant="ghost"
                  size="sm-touch"
                  className={cn(applicationNavigationItemVariants({ active }))}
                  render={
                    <Link
                      to={item.to}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    />
                  }
                >
                  <Icon data-icon="inline-start" />
                  <span className="grid min-w-0 gap-0.5">
                    <span>{item.label}</span>
                    <span className="application-navigation__description text-xs font-normal">
                      {item.description}
                    </span>
                  </span>
                </Button>
              )
            })}
        </nav>
        <SheetFooter className="border-t border-border/70 px-5 py-4 text-xs text-muted-foreground">
          Private workspace · FairLend team only
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
