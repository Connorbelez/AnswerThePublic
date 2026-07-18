import { ConvexHttpClient } from "convex/browser"

import { api } from "../../convex/_generated/api"
import { getWorkosServerConfig } from "@/config/workos-runtime-config"

export async function provisionPrincipalFromWorkos({
  accessToken,
  organizationId,
}: {
  accessToken: string
  organizationId: string | undefined
}) {
  const workos = getWorkosServerConfig()
  if (organizationId !== workos.organizationId) {
    throw new Error("The authenticated WorkOS organization is not FairLend.")
  }

  const convexUrl = process.env.VITE_CONVEX_URL
  if (!convexUrl) {
    throw new Error("VITE_CONVEX_URL is required to provision a principal.")
  }

  const client = new ConvexHttpClient(convexUrl)
  client.setAuth(accessToken)
  await client.mutation(api.principals.syncCurrent)
}
