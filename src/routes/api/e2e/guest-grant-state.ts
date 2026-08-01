import { createFileRoute } from "@tanstack/react-router"

import { createRequestIdentityProvider } from "@/infrastructure/request-identity"

export const Route = createFileRoute("/api/e2e/guest-grant-state")({
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
        if (
          !["expire", "inspect_editor_lease", "expire_editor_lease"].includes(
            String(input.action)
          ) ||
          typeof input.grantId !== "string"
        )
          return Response.json(
            { error: { code: "VALIDATION_FAILED" } },
            { status: 400 }
          )
        const { expireGuestGrantE2e, guestEditorLeaseStateE2e } =
          await import("@/infrastructure/convex-test-workspace.server")
        return Response.json({
          data:
            input.action === "expire"
              ? await expireGuestGrantE2e(identity, input.grantId)
              : await guestEditorLeaseStateE2e(
                  identity,
                  input.grantId,
                  input.action === "expire_editor_lease" ? "expire" : "inspect"
                ),
        })
      },
    },
  },
})
