import { createFileRoute } from "@tanstack/react-router"

import { createRequestIdentityProvider } from "@/infrastructure/request-identity"

export const Route = createFileRoute("/api/e2e/public-share")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (import.meta.env.MODE !== "e2e")
          return new Response(null, { status: 404 })
        const identities = createRequestIdentityProvider()
        const identity = await identities.getIdentity()
        if (!identities.isFixture || !identity)
          return Response.json(
            { error: { code: "UNAUTHENTICATED" } },
            { status: 401 }
          )
        const input = (await request.json()) as Record<string, unknown>
        const helpers =
          await import("@/infrastructure/convex-test-workspace.server")
        if (input.action === "create") {
          const data = await helpers.createPublicShareE2e(identity)
          return Response.json({ data }, { status: 201 })
        }
        if (input.action === "revoke" && typeof input.shareId === "string") {
          const data = await helpers.revokePublicShareE2e(
            identity,
            input.shareId
          )
          return Response.json({ data })
        }
        return Response.json(
          { error: { code: "VALIDATION_FAILED" } },
          { status: 400 }
        )
      },
    },
  },
})
