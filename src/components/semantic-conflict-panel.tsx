import { useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { CircleAlert } from "lucide-react"

import { resolveSemanticConflict } from "@/application/content-request-server-functions"
import type {
  Deliverable,
  PrincipalSummary,
  SemanticConflict,
} from "@/application/content-requests"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export function SemanticConflictPanel({
  conflicts,
  principals,
  deliverables,
  readOnly = false,
}: {
  conflicts: Array<SemanticConflict>
  principals: Array<PrincipalSummary>
  deliverables: Array<Deliverable>
  readOnly?: boolean
}) {
  const resolveConflict = useServerFn(resolveSemanticConflict)
  const router = useRouter()
  const [resolving, setResolving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (conflicts.length === 0) return null

  const principalLabel = (principalId: string) =>
    principals.find((principal) => principal.principalId === principalId)
      ?.subject ?? principalId

  const valueLabel = (conflict: SemanticConflict, value: string) => {
    if (conflict.field === "assigneePrincipalId") return principalLabel(value)
    if (conflict.field === "primaryDeliverableId")
      return (
        deliverables.find((deliverable) => deliverable.deliverableId === value)
          ?.name ?? `deliverable ${value}`
      )
    for (const deliverable of deliverables) {
      const version = deliverable.versions.find(
        (candidate) => candidate.versionId === value
      )
      if (version)
        return `${deliverable.name} · version ${version.ordinal} · ${version.body.slice(0, 48)}`
    }
    return `version ${value}`
  }

  const fieldLabel = (field: SemanticConflict["field"]) =>
    field === "assigneePrincipalId"
      ? "Assignee changed concurrently"
      : field === "primaryDeliverableId"
        ? "Primary deliverable changed concurrently"
        : "Promoted version changed concurrently"

  return (
    <Alert variant="destructive" aria-label="Attention required conflicts">
      <CircleAlert />
      <AlertTitle>Attention required</AlertTitle>
      <AlertDescription>
        <p>
          Concurrent singleton changes were preserved. Select the intended
          value; a newer third value will be preserved and rebased.
          {readOnly ? " Restore this request before resolving it." : ""}
        </p>
        {conflicts.map((conflict) => (
          <div
            className="semantic-conflict"
            key={conflict.conflictId}
            role="group"
            aria-label={fieldLabel(conflict.field)}
          >
            <span>{fieldLabel(conflict.field)}</span>
            <div className="semantic-conflict__actions">
              {[
                ...new Set([conflict.currentValue, conflict.proposedValue]),
              ].map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  disabled={readOnly || resolving === conflict.conflictId}
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
                  Use {valueLabel(conflict, value)}
                </Button>
              ))}
            </div>
          </div>
        ))}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
