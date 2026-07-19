import { ConvexHttpClient } from "convex/browser"

import { api } from "../../convex/_generated/api"
import { getWorkosServerConfig } from "@/config/workos-runtime-config"
import { readWorkosAccessTokenClaims } from "@/infrastructure/workos-access-token-claims.server"

export async function provisionPrincipalFromWorkos({
  accessToken,
  organizationId,
  verifiedEmail,
}: {
  accessToken: string
  organizationId: string | undefined
  verifiedEmail: string
}) {
  const workos = getWorkosServerConfig()
  if (organizationId !== workos.organizationId) {
    throw new Error("The authenticated WorkOS organization is not FairLend.")
  }

  const convexUrl = process.env.VITE_CONVEX_URL
  if (!convexUrl) {
    throw new Error("VITE_CONVEX_URL is required to provision a principal.")
  }
  const provisioningKey = process.env.FAIRLEND_PRINCIPAL_PROVISIONING_KEY
  if (!provisioningKey) {
    throw new Error(
      "FAIRLEND_PRINCIPAL_PROVISIONING_KEY is required to provision a principal."
    )
  }

  const client = new ConvexHttpClient(convexUrl)
  client.setAuth(accessToken)
  try {
    await client.mutation(api.principals.syncCurrentProfile, {
      verifiedEmail,
      provisioningKey,
    })
  } catch (error) {
    if (String(error).includes("NoAuthProvider")) {
      console.error(
        "[authkit-convex] WorkOS JWT provider mismatch diagnostics",
        readWorkosAccessTokenClaims(accessToken)
      )
    }
    throw error
  }
}
