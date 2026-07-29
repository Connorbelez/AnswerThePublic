import { useEffect } from "react"
import { signOut } from "@workos/authkit-tanstack-react-start"
import { createFileRoute } from "@tanstack/react-router"
import { LoaderCircle } from "lucide-react"

import { getWorkosLogoutReturnTo } from "@/application/workos-logout-server-functions"
import { Card, CardContent } from "@/components/ui/card"

export const Route = createFileRoute("/logout")({
  loader: async () => {
    const returnTo = await getWorkosLogoutReturnTo()
    await signOut({ data: { returnTo } })
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

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand" aria-label="FairLend Content Requests">
        <span className="wordmark">FairLend</span>
        <p>Content Requests</p>
      </section>
      <Card className="auth-card" role="status" aria-live="polite">
        <CardContent className="logout-status">
          <span className="auth-icon" aria-hidden="true">
            <LoaderCircle className="animate-spin" />
          </span>
          <div>
            <h1>Signing you out</h1>
            <p>Clearing private offline data from this device…</p>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
