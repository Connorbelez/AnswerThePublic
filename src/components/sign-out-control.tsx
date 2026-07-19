import { LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { clearPrivateOfflineAccess } from "@/lib/private-offline-access"

export function SignOutControl() {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Sign out"
      onClick={async () => {
        await clearPrivateOfflineAccess()
        window.dispatchEvent(new Event("fairlend:private-offline-cleared"))
        window.setTimeout(() => window.location.assign("/logout"), 100)
      }}
    >
      <LogOut />
    </Button>
  )
}
