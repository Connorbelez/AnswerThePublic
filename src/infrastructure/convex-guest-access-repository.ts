import { ConvexHttpClient } from "convex/browser"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { GuestAccessRepository } from "@/application/content-requests"

function resolveSecret() {
  const secret = process.env.GUEST_ACCESS_RESOLVE_SECRET
  if (!secret || new TextEncoder().encode(secret).byteLength < 32)
    throw new Error(
      "GUEST_ACCESS_RESOLVE_SECRET must be configured with at least 32 bytes."
    )
  return secret
}

export async function createGuestAccessResolveArguments(
  token: string,
  inputNetworkSource: string,
  networkTimestamp = Date.now()
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error("Guest Access token must be a 43-character bearer token.")
  const networkSource = inputNetworkSource.trim()
  if (
    !networkSource ||
    networkSource !== inputNetworkSource ||
    networkSource.length > 256
  )
    throw new Error(
      "Guest Access network source must be 1 to 256 trimmed characters."
    )
  if (!Number.isSafeInteger(networkTimestamp))
    throw new Error("Guest Access network timestamp must be a safe integer.")
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(resolveSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `guest-access-resolve:v1\n${networkTimestamp}\n${networkSource}\n${token}`
    )
  )
  const networkProof = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return { token, networkSource, networkTimestamp, networkProof }
}

export function createConvexGuestAccessRepository(
  networkSource: string
): GuestAccessRepository {
  const convexUrl = process.env.VITE_CONVEX_URL
  if (!convexUrl)
    throw new Error("VITE_CONVEX_URL is required for Guest Access.")
  const client = new ConvexHttpClient(convexUrl)
  return {
    async resolve(token, networkSource) {
      return client.mutation(
        api.guestAccess.resolve,
        await createGuestAccessResolveArguments(token, networkSource)
      )
    },
    async acquireEditorLease(input) {
      return client.mutation(api.guestAccess.acquireEditorLease, {
        ...input,
        ...(await createGuestAccessResolveArguments(
          input.token,
          networkSource
        )),
      })
    },
    async heartbeatEditorLease(input) {
      return client.mutation(api.guestAccess.heartbeatEditorLease, {
        ...input,
        ...(await createGuestAccessResolveArguments(
          input.token,
          networkSource
        )),
      })
    },
    async takeoverEditorLease(input) {
      return client.mutation(api.guestAccess.takeoverEditorLease, {
        ...input,
        ...(await createGuestAccessResolveArguments(
          input.token,
          networkSource
        )),
      })
    },
    async saveResponseWorkspace(input) {
      return client.mutation(api.guestAccess.saveResponseWorkspace, {
        ...input,
        ...(await createGuestAccessResolveArguments(
          input.token,
          networkSource
        )),
      })
    },
    async submitResponseWorkspace(input) {
      return client.mutation(api.guestAccess.submitResponseWorkspace, {
        ...input,
        ...(await createGuestAccessResolveArguments(
          input.token,
          networkSource
        )),
      })
    },
    async beginEvidenceUpload(input) {
      return client.mutation(api.guestEvidence.beginUpload, {
        ...input,
        ...(await createGuestAccessResolveArguments(
          input.token,
          networkSource
        )),
      })
    },
    registerEvidenceUpload(input) {
      return client.mutation(api.guestEvidence.registerUploadObject, {
        ...input,
        assetId: input.assetId as Id<"responseAssets">,
        uploadSessionId:
          input.uploadSessionId as Id<"responseAssetUploadSessions">,
        storageId: input.storageId as Id<"_storage">,
      })
    },
    async finalizeEvidenceUpload(input) {
      return client.mutation(api.guestEvidence.finalizeUpload, {
        ...input,
        ...(await createGuestAccessResolveArguments(
          input.token,
          networkSource
        )),
        assetId: input.assetId as Id<"responseAssets">,
        uploadSessionId:
          input.uploadSessionId as Id<"responseAssetUploadSessions">,
        storageId: input.storageId as Id<"_storage">,
      })
    },
    async markEvidenceUploadFailed(input) {
      return client.mutation(api.guestEvidence.markUploadFailed, {
        ...input,
        ...(await createGuestAccessResolveArguments(
          input.token,
          networkSource
        )),
        assetId: input.assetId as Id<"responseAssets">,
        uploadSessionId:
          input.uploadSessionId as Id<"responseAssetUploadSessions">,
      })
    },
    async listEvidence(token) {
      return client.mutation(
        api.guestEvidence.listForGuest,
        await createGuestAccessResolveArguments(token, networkSource)
      )
    },
    async retryEvidence(input) {
      return client.mutation(api.guestEvidence.retry, {
        ...input,
        ...(await createGuestAccessResolveArguments(
          input.token,
          networkSource
        )),
        assetId: input.assetId as Id<"responseAssets">,
      })
    },
    async discardEvidence(input) {
      return client.mutation(api.guestEvidence.discard, {
        ...input,
        ...(await createGuestAccessResolveArguments(
          input.token,
          networkSource
        )),
        assetId: input.assetId as Id<"responseAssets">,
      })
    },
  }
}
