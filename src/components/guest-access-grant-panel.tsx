import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"

import type {
  GuestAccessGrantSummary,
  PersonSummary,
} from "@/application/content-requests"
import {
  createGuestAccessGrant,
  createPerson,
  renewGuestAccessGrant,
  revokeGuestAccessGrant,
  searchPeople,
} from "@/application/content-request-server-functions"
import { GuestAccessGrantManager } from "@/components/guest-access-grant-manager"

export function GuestAccessGrantPanel({
  humanId,
  people,
  defaultPersonId,
  grants,
  disabled = false,
}: {
  humanId: string
  people: Array<PersonSummary>
  defaultPersonId: string | null
  grants: Array<GuestAccessGrantSummary>
  disabled?: boolean
}) {
  const router = useRouter()
  const persistPerson = useServerFn(createPerson)
  const generateGrant = useServerFn(createGuestAccessGrant)
  const findPeople = useServerFn(searchPeople)
  const renewGrant = useServerFn(renewGuestAccessGrant)
  const revokeGrant = useServerFn(revokeGuestAccessGrant)

  return (
    <GuestAccessGrantManager
      people={people}
      defaultPersonId={defaultPersonId}
      grants={grants}
      disabled={disabled}
      onSearchPeople={async (query) => {
        const result = await findPeople({ data: { query, limit: 20 } })
        return result.people
      }}
      onCreatePerson={async ({ displayName, email }) => {
        const person = await persistPerson({
          data: {
            humanId,
            displayName,
            email,
            correlationId: crypto.randomUUID(),
          },
        })
        void router.invalidate().catch(() => {
          // Keep the returned Person available for immediate selection. The
          // route data can refresh after the manager commits its local state.
        })
        return person
      }}
      onGenerate={async ({ personId }) => {
        const result = await generateGrant({
          data: {
            humanId,
            personId,
            correlationId: crypto.randomUUID(),
          },
        })
        void router.invalidate().catch(() => {
          // The token is returned only once. A refresh failure must never
          // discard the generated URL; grant history can refresh later.
        })
        return result
      }}
      onRenew={async (grantId) => {
        const result = await renewGrant({
          data: {
            grantId,
            correlationId: crypto.randomUUID(),
          },
        })
        void router.invalidate().catch(() => {
          // Keep the one-time renewed token visible even if route refresh fails.
        })
        return result
      }}
      onRevoke={async (grantId) => {
        await revokeGrant({
          data: {
            grantId,
            correlationId: crypto.randomUUID(),
          },
        })
        void router.invalidate().catch(() => {
          // Revocation is already durable; history can refresh later.
        })
      }}
    />
  )
}
