import { ConvexHttpClient } from "convex/browser"

import { api } from "../../convex/_generated/api"
import { getWorkosServerConfig } from "@/config/workos-runtime-config"
import { isExpectedProvisioningAccessDenial } from "@/infrastructure/convex-error-code"
import { readWorkosAccessTokenClaims } from "@/infrastructure/workos-access-token-claims.server"

export async function provisionPrincipalFromWorkos({
  accessToken,
  organizationId,
  verifiedEmail,
}: {
  accessToken: string
  organizationId: string | undefined
  verifiedEmail: string
}): Promise<"provisioned" | "access_denied"> {
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
    return "provisioned"
  } catch (error) {
    if (isExpectedProvisioningAccessDenial(error)) {
      // Complete OAuth so the user can reach /unauthorized and sign out.
      return "access_denied"
    }
    if (String(error).includes("NoAuthProvider")) {
      console.error(
        "[authkit-convex] WorkOS JWT provider mismatch diagnostics",
        readWorkosAccessTokenClaims(accessToken)
      )
    }
    throw error
  }
}
