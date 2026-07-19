import { createFileRoute } from "@tanstack/react-router"

import { createRequestIdentityProvider } from "@/infrastructure/request-identity"

export const Route = createFileRoute("/api/e2e/automated-request")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (import.meta.env.MODE !== "e2e") {
          return new Response(null, { status: 404 })
        }
        const identities = createRequestIdentityProvider()
        const identity = await identities.getIdentity()
        if (!identities.isFixture || !identity) {
          return Response.json(
            { error: { code: "UNAUTHENTICATED" } },
            { status: 401 }
          )
        }
        const input = (await request.json()) as Record<string, unknown>
        if (
          typeof input.title !== "string" ||
          typeof input.assigneeSubject !== "string"
        ) {
          return Response.json(
            { error: { code: "VALIDATION_FAILED" } },
            { status: 400 }
          )
        }
        const { createAutomatedE2eRequest } =
          await import("@/infrastructure/convex-test-workspace.server")
        const data = await createAutomatedE2eRequest(
          identity,
          input.title,
          input.assigneeSubject
        )
        return Response.json({ data }, { status: 201 })
      },
    },
  },
})
