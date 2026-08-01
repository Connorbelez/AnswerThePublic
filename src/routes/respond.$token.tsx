import { createFileRoute, notFound } from "@tanstack/react-router"

import { resolveGuestAccess } from "@/application/content-request-server-functions"
import { GuestAccessResponse } from "@/components/guest-access-response"

export const Route = createFileRoute("/respond/$token")({
  loader: async ({ params }) => {
    const view = await resolveGuestAccess({ data: { token: params.token } })
    if (!view) throw notFound()
    return view
  },
  component: GuestResponseBriefPage,
})

function GuestResponseBriefPage() {
  return (
    <GuestAccessResponse
      token={Route.useParams().token}
      view={Route.useLoaderData()}
    />
  )
}
