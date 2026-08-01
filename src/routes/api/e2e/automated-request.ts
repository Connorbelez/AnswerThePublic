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
        const {
          createAutomatedE2eRequest,
          createExpertInterviewE2eRequest,
          seedGuestNotificationSignalsE2e,
        } = await import("@/infrastructure/convex-test-workspace.server")
        const data =
          input.expertInterview === true
            ? await createExpertInterviewE2eRequest(identity, input.title)
            : await createAutomatedE2eRequest(
                identity,
                input.title,
                input.assigneeSubject,
                input.includeDraft !== false
              )
        if (
          input.expertInterview === true &&
          input.seedGuestNotifications === true
        ) {
          const expertData = data as {
            request: { requestId: string; humanId: string }
          }
          return Response.json(
            {
              data: {
                ...expertData,
                notificationSignals: await seedGuestNotificationSignalsE2e(
                  identity,
                  expertData.request.requestId,
                  expertData.request.humanId
                ),
              },
            },
            { status: 201 }
          )
        }
        return Response.json({ data }, { status: 201 })
      },
    },
  },
})
