import { useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"

import { proposeAssigneeChange } from "@/application/content-request-server-functions"
import type {
  ContentRequest,
  PrincipalSummary,
} from "@/application/content-requests"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

export function RequestAssignmentControl({
  request,
  principals,
}: {
  request: ContentRequest
  principals: Array<PrincipalSummary>
}) {
  const proposeAssignment = useServerFn(proposeAssigneeChange)
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="assignment-control"
      onSubmit={async (event) => {
        event.preventDefault()
        setSaving(true)
        setError(null)
        const form = new FormData(event.currentTarget)
        try {
          const result = await proposeAssignment({
            data: {
              humanId: request.humanId,
              expectedAssigneePrincipalId: request.assignee.principalId,
              proposedAssigneePrincipalId: String(form.get("assignee")),
              watcherPrincipalIds: form
                .getAll("watchers")
                .map((value) => String(value)),
              reason: String(form.get("reason") ?? "") || undefined,
              correlationId: crypto.randomUUID(),
            },
          })
          await router.invalidate()
          if (result.outcome === "attention_required") {
            setError(
              "Attention required: another editor changed the assignee. Choose between the preserved values in the conflict panel."
            )
          }
        } catch (assignmentError) {
          setError(
            assignmentError instanceof Error
              ? assignmentError.message
              : "Assignment could not be updated."
          )
        } finally {
          setSaving(false)
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor="assignee">Accountable assignee</FieldLabel>
        <NativeSelect
          id="assignee"
          name="assignee"
          defaultValue={request.assignee.principalId}
        >
          {principals.map((principal) => (
            <NativeSelectOption
              key={principal.principalId}
              value={principal.principalId}
            >
              {principal.subject} · {principal.role.replaceAll("_", " ")}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <FieldSet className="watcher-list">
        <FieldLegend>Watchers (optional)</FieldLegend>
        {principals.map((principal) => (
          <Field key={principal.principalId} orientation="horizontal">
            <Checkbox
              id={`watcher-${principal.principalId}`}
              name="watchers"
              value={principal.principalId}
              defaultChecked={request.watchers.some(
                (watcher) => watcher.principalId === principal.principalId
              )}
            />
            <FieldLabel htmlFor={`watcher-${principal.principalId}`}>
              {principal.subject}
            </FieldLabel>
          </Field>
        ))}
      </FieldSet>
      <Field>
        <FieldLabel htmlFor="assignment-reason">Reason (optional)</FieldLabel>
        <Input
          id="assignment-reason"
          name="reason"
          placeholder="Why ownership is changing"
        />
      </Field>
      {error ? <p className="form-error">{error}</p> : null}
      <Button type="submit" disabled={saving}>
        {saving ? "Assigning…" : "Update assignment"}
      </Button>
    </form>
  )
}
