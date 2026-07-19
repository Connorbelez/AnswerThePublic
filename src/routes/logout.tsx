import { useEffect } from "react"
import { signOut } from "@workos/authkit-tanstack-react-start"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/logout")({
  loader: async () => {
    const { resolveWorkosLogoutReturnTo } =
      await import("@/infrastructure/workos-logout-return-to.server")
    await signOut({ data: { returnTo: resolveWorkosLogoutReturnTo("/") } })
  },
  component: LogoutPage,
})

function LogoutPage() {
  useEffect(() => {
    void (async () => {
      const { clearPrivateOfflineAccess } =
        await import("@/lib/private-offline-access")
      await clearPrivateOfflineAccess()
    })()
  }, [])

  return <p role="status">Signing out and clearing offline data…</p>
}
