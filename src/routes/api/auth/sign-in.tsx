import { createFileRoute } from "@tanstack/react-router"
import { getSignInUrl } from "@workos/authkit-tanstack-react-start"

import { buildWorkosSignInOptions } from "@/config/workos-runtime-config"

export const Route = createFileRoute("/api/auth/sign-in")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const returnPathname = new URL(request.url).searchParams.get(
          "returnPathname"
        )
        const url = await getSignInUrl(
          buildWorkosSignInOptions(returnPathname)
        )
        return new Response(null, {
          status: 307,
          headers: { Location: url },
        })
      },
    },
  },
})
