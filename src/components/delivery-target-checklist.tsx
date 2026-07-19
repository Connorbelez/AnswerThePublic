import { useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Check, RotateCcw } from "lucide-react"

import type {
  Deliverable,
  DeliveryTarget,
  PrincipalSummary,
} from "@/application/content-requests"
import {
  confirmDeliveryTarget,
  createDeliveryTarget,
  reopenDeliveryTarget,
  setDeliveryTargetRequired,
} from "@/application/content-request-server-functions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

export function DeliveryTargetChecklist({
  humanId,
  targets,
  deliverables,
  principals,
}: {
  humanId: string
  targets: Array<DeliveryTarget>
  deliverables: Array<Deliverable>
  principals: Array<PrincipalSummary>
}) {
  const router = useRouter()
  const createTarget = useServerFn(createDeliveryTarget)
  const setRequired = useServerFn(setDeliveryTargetRequired)
  const confirm = useServerFn(confirmDeliveryTarget)
  const reopen = useServerFn(reopenDeliveryTarget)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const run = async (key: string, operation: () => Promise<unknown>) => {
    setPending(key)
    setError(null)
    try {
      await operation()
      await router.invalidate()
    } catch {
      setError(
        "The delivery checklist could not be updated. Refresh and try again."
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Responded</CardTitle>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={adding}
          aria-controls="add-delivery-target"
          onClick={() => setAdding(!adding)}
        >
          Add channel
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="sr-only" aria-live="polite">
          {pending ? "Updating delivery checklist" : (error ?? "")}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {adding ? (
          <form
            id="add-delivery-target"
            className="grid gap-2 rounded-xl border p-3"
            onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const deliverableId = String(data.get("deliverableId") ?? "")
              if (
                !deliverables.some(
                  (item) => item.deliverableId === deliverableId
                )
              )
                return setError("Select a deliverable for this channel.")
              void run("create", () =>
                createTarget({
                  data: {
                    humanId,
                    deliverableId,
                    channel: String(data.get("channel") ?? ""),
                    destinationLabel: String(
                      data.get("destinationLabel") ?? ""
                    ),
                    destinationUrl:
                      String(data.get("destinationUrl") ?? "") || undefined,
                    correlationId: crypto.randomUUID(),
                  },
                })
              )
            }}
          >
            <label className="grid gap-1 text-sm font-medium">
              Deliverable
              <NativeSelect
                name="deliverableId"
                className="w-full"
                defaultValue={
                  deliverables.find((deliverable) => deliverable.isPrimary)
                    ?.deliverableId
                }
                required
              >
                {deliverables.map((deliverable) => (
                  <NativeSelectOption
                    key={deliverable.deliverableId}
                    value={deliverable.deliverableId}
                  >
                    {deliverable.name}
                    {deliverable.isPrimary ? " (primary)" : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <Input
              name="channel"
              aria-label="Channel"
              placeholder="Channel"
              required
            />
            <Input
              name="destinationLabel"
              aria-label="Destination"
              placeholder="Destination"
              required
            />
            <Input
              name="destinationUrl"
              aria-label="Destination URL"
              placeholder="https://…"
              type="url"
            />
            <Button type="submit" size="sm" disabled={pending !== null}>
              Create optional channel
            </Button>
          </form>
        ) : null}
        {targets.map((target) => {
          const deliverable = deliverables.find(
            (candidate) => candidate.deliverableId === target.deliverableId
          )
          const promotedVersionId = deliverable?.promotedVersionId
          const confirmedVersion = deliverable?.versions.find(
            (version) => version.versionId === target.currentReceipt?.versionId
          )
          const readinessId = `delivery-readiness-${target.targetId}`
          return (
            <div
              key={target.targetId}
              className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{target.destinationLabel}</span>
                  {target.isRequired ? (
                    <Badge>Required</Badge>
                  ) : (
                    <Badge variant="outline">Optional</Badge>
                  )}
                  {target.currentReceipt ? (
                    <Badge variant="secondary">
                      <Check /> Responded
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {target.channel}
                </p>
                {target.destinationUrl ? (
                  <a
                    className="text-sm break-all text-primary underline-offset-4 hover:underline"
                    href={target.destinationUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {target.destinationUrl}
                  </a>
                ) : null}
                {target.currentReceipt ? (
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                    <p>
                      Version {confirmedVersion?.ordinal ?? "unknown"} confirmed{" "}
                      {new Date(
                        target.currentReceipt.respondedAt
                      ).toLocaleString()}
                    </p>
                    <p>
                      Actor:{" "}
                      {principals.find(
                        (item) =>
                          item.principalId ===
                          target.currentReceipt?.confirmedByPrincipalId
                      )?.subject ??
                        target.currentReceipt.confirmedByPrincipalId}
                    </p>
                    {target.currentReceipt.note ? (
                      <p>Note: {target.currentReceipt.note}</p>
                    ) : null}
                    {target.currentReceipt.confirmationMethod ===
                    "integration" ? (
                      <p>
                        Verified integration
                        {target.currentReceipt.integrationIdentity
                          ? `: ${target.currentReceipt.integrationIdentity}`
                          : ""}
                        {target.currentReceipt.externalReceiptId
                          ? ` · Receipt ${target.currentReceipt.externalReceiptId}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {target.receiptHistory.length > 0 ? (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-medium">
                      Delivery history for {target.destinationLabel} (
                      {target.receiptHistory.length})
                    </summary>
                    <ol className="mt-2 grid gap-2 border-l pl-3 text-muted-foreground">
                      {target.receiptHistory.map((receipt) => {
                        const version = deliverable?.versions.find(
                          (candidate) =>
                            candidate.versionId === receipt.versionId
                        )
                        const actor = principals.find(
                          (candidate) =>
                            candidate.principalId ===
                            receipt.confirmedByPrincipalId
                        )
                        return (
                          <li key={receipt.receiptId}>
                            Version {version?.ordinal ?? "unknown"} ·{" "}
                            {new Date(receipt.respondedAt).toLocaleString()} ·{" "}
                            {actor?.subject ?? receipt.confirmedByPrincipalId}
                            {receipt.note ? ` · ${receipt.note}` : ""}
                            {receipt.confirmationMethod === "integration"
                              ? ` · Verified ${receipt.integrationIdentity ?? "integration"}${receipt.externalReceiptId ? ` · Receipt ${receipt.externalReceiptId}` : ""}`
                              : ""}
                          </li>
                        )
                      })}
                    </ol>
                  </details>
                ) : null}
                {!target.currentReceipt ? (
                  <label className="mt-3 grid gap-1 text-xs font-medium">
                    Confirmation note for {target.destinationLabel} (optional)
                    <Input
                      value={notes[target.targetId] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [target.targetId]: event.target.value,
                        }))
                      }
                      placeholder="Where and how it was posted"
                    />
                  </label>
                ) : null}
                {!target.currentReceipt && !promotedVersionId ? (
                  <p id={readinessId} className="mt-2 text-xs text-amber-700">
                    Promote a version before confirming delivery.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {!target.isOriginal ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending !== null}
                    aria-label={`Make ${target.destinationLabel} ${target.isRequired ? "optional" : "required"}`}
                    onClick={() =>
                      void run(target.targetId, () =>
                        setRequired({
                          data: {
                            targetId: target.targetId,
                            isRequired: !target.isRequired,
                            correlationId: crypto.randomUUID(),
                          },
                        })
                      )
                    }
                  >
                    Make {target.isRequired ? "optional" : "required"}
                  </Button>
                ) : null}
                {target.currentReceipt ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending !== null}
                    aria-label={`Reopen delivery to ${target.destinationLabel}`}
                    onClick={() =>
                      void run(target.targetId, () =>
                        reopen({
                          data: {
                            targetId: target.targetId,
                            correlationId: crypto.randomUUID(),
                          },
                        })
                      )
                    }
                  >
                    <RotateCcw /> Reopen
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={pending !== null || !promotedVersionId}
                    aria-label={`Mark ${target.destinationLabel} responded`}
                    aria-describedby={
                      promotedVersionId ? undefined : readinessId
                    }
                    onClick={() =>
                      promotedVersionId
                        ? void run(target.targetId, () =>
                            confirm({
                              data: {
                                targetId: target.targetId,
                                versionId: promotedVersionId,
                                note:
                                  notes[target.targetId]?.trim() || undefined,
                                correlationId: crypto.randomUUID(),
                              },
                            })
                          )
                        : undefined
                    }
                  >
                    Mark responded
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
