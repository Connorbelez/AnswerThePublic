import { createFileRoute } from "@tanstack/react-router"
import { handleCallbackRoute } from "@workos/authkit-tanstack-react-start"

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: handleCallbackRoute({
        errorRedirectUrl: "/sign-in?error=auth_failed",
        onSuccess: async ({ accessToken, organizationId, user }) => {
          const { provisionPrincipalFromWorkos } =
            await import("@/infrastructure/provision-principal.server")
          await provisionPrincipalFromWorkos({
            accessToken,
            organizationId,
            verifiedEmail: user.email,
          })
        },
      }),
    },
  },
})
