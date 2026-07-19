import { useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { CircleAlert } from "lucide-react"

import { resolveSemanticConflict } from "@/application/content-request-server-functions"
import type {
  PrincipalSummary,
  SemanticConflict,
} from "@/application/content-requests"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export function SemanticConflictPanel({
  conflicts,
  principals,
}: {
  conflicts: Array<SemanticConflict>
  principals: Array<PrincipalSummary>
}) {
  const resolveConflict = useServerFn(resolveSemanticConflict)
  const router = useRouter()
  const [resolving, setResolving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (conflicts.length === 0) return null

  const principalLabel = (principalId: string) =>
    principals.find((principal) => principal.principalId === principalId)
      ?.subject ?? principalId

  return (
    <Alert variant="destructive" aria-label="Attention required conflicts">
      <CircleAlert />
      <AlertTitle>Attention required</AlertTitle>
      <AlertDescription>
        <p>
          Concurrent singleton changes were preserved. Select the intended
          assignee; a newer third value will be preserved and rebased.
        </p>
        {conflicts.map((conflict) => (
          <div className="semantic-conflict" key={conflict.conflictId}>
            <span>Assignee changed concurrently</span>
            <div className="semantic-conflict__actions">
              {[
                ...new Set([conflict.currentValue, conflict.proposedValue]),
              ].map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  disabled={resolving === conflict.conflictId}
                  onClick={async () => {
                    setResolving(conflict.conflictId)
                    setError(null)
                    try {
                      await resolveConflict({
                        data: {
                          conflictId: conflict.conflictId,
                          selectedValue: value,
                          correlationId: crypto.randomUUID(),
                        },
                      })
                      await router.invalidate()
                    } catch (resolutionError) {
                      setError(
                        resolutionError instanceof Error
                          ? resolutionError.message
                          : "The conflict could not be resolved."
                      )
                    } finally {
                      setResolving(null)
                    }
                  }}
                >
                  Use {principalLabel(value)}
                </Button>
              ))}
            </div>
          </div>
        ))}
        {error ? <p className="form-error">{error}</p> : null}
      </AlertDescription>
    </Alert>
  )
}
