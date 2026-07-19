import { useEffect } from "react"
import { signOut } from "@workos/authkit-tanstack-react-start"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/logout")({
  component: LogoutPage,
})

function LogoutPage() {
  useEffect(() => {
    void (async () => {
      const { clearPrivateOfflineAccess } =
        await import("@/lib/private-offline-access")
      await clearPrivateOfflineAccess()
      await signOut({ data: { returnTo: "/" } })
    })()
  }, [])
  return <p role="status">Signing out and clearing offline data…</p>
}
