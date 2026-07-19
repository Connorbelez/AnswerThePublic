import { useEffect, useRef, useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Archive, ArchiveRestore, Check, RotateCcw } from "lucide-react"

import type {
  Deliverable,
  DeliveryTarget,
  PrincipalSummary,
} from "@/application/content-requests"
import {
  confirmDeliveryTarget,
  createDeliveryTarget,
  listArchivedDeliveryTargets,
  reopenDeliveryTarget,
  setDeliveryTargetRequired,
  setDeliveryTargetRetention,
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
  initialArchivedCursor = null,
  readOnly = false,
}: {
  humanId: string
  targets: Array<DeliveryTarget>
  deliverables: Array<Deliverable>
  principals: Array<PrincipalSummary>
  initialArchivedCursor?: string | null
  readOnly?: boolean
}) {
  const router = useRouter()
  const createTarget = useServerFn(createDeliveryTarget)
  const loadArchivedTargets = useServerFn(listArchivedDeliveryTargets)
  const setRequired = useServerFn(setDeliveryTargetRequired)
  const setRetention = useServerFn(setDeliveryTargetRetention)
  const confirm = useServerFn(confirmDeliveryTarget)
  const reopen = useServerFn(reopenDeliveryTarget)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [visibleTargets, setVisibleTargets] = useState(targets)
  const [archivedCursor, setArchivedCursor] = useState(initialArchivedCursor)
  const visibleRequest = useRef(humanId)

  useEffect(() => {
    if (visibleRequest.current !== humanId) {
      visibleRequest.current = humanId
      setVisibleTargets(targets)
      setArchivedCursor(initialArchivedCursor)
      return
    }
    setVisibleTargets((current) => {
      const next = new Map(current.map((target) => [target.targetId, target]))
      for (const target of targets) next.set(target.targetId, target)
      return [...next.values()]
    })
  }, [humanId, initialArchivedCursor, targets])

  const run = async <Result,>(
    key: string,
    operation: () => Promise<Result>,
    applyResult?: (result: Result) => void
  ) => {
    setPending(key)
    setError(null)
    try {
      const result = await operation()
      await router.invalidate()
      applyResult?.(result)
    } catch {
      setError(
        "The delivery checklist could not be updated. Refresh and try again."
      )
    } finally {
      setPending(null)
    }
  }

  const loadMoreArchived = async () => {
    if (!archivedCursor) return
    setPending("load-archived")
    setError(null)
    try {
      const result = await loadArchivedTargets({
        data: { humanId, cursor: archivedCursor },
      })
      setVisibleTargets((current) => {
        const next = new Map(current.map((target) => [target.targetId, target]))
        for (const target of result.page) next.set(target.targetId, target)
        return [...next.values()]
      })
      setArchivedCursor(result.nextCursor)
    } catch {
      setError("Archived channels could not be loaded. Refresh and try again.")
    } finally {
      setPending(null)
    }
  }

  const changeRetention = async (
    targetId: string,
    retention: "active" | "archived"
  ) => {
    const updated = await setRetention({
      data: {
        targetId,
        retention,
        correlationId: crypto.randomUUID(),
      },
    })
    setVisibleTargets((current) =>
      current.map((target) =>
        target.targetId === updated.targetId
          ? { ...target, ...updated }
          : target
      )
    )
  }

  const mergeVisibleTarget = (updated: DeliveryTarget) => {
    setVisibleTargets((current) =>
      current.map((target) =>
        target.targetId === updated.targetId ? updated : target
      )
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Responded</CardTitle>
        {!readOnly ? (
          <Button
            size="sm-touch"
            variant="outline"
            aria-expanded={adding}
            aria-controls="add-delivery-target"
            onClick={() => setAdding(!adding)}
          >
            Add channel
          </Button>
        ) : null}
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
        {adding && !readOnly ? (
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
            <Button type="submit" size="sm-touch" disabled={pending !== null}>
              Create optional channel
            </Button>
          </form>
        ) : null}
        {visibleTargets.map((target) => {
          const archived = target.retention === "archived"
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
              className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center ${archived ? "bg-muted/40 opacity-75" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{target.destinationLabel}</span>
                  {target.isRequired ? (
                    <Badge>Required</Badge>
                  ) : (
                    <Badge variant="outline">Optional</Badge>
                  )}
                  {archived ? <Badge variant="outline">Archived</Badge> : null}
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
                {!archived && !target.currentReceipt && !readOnly ? (
                  <label className="mt-3 grid gap-1 text-xs font-medium">
                    Confirmation note for {target.destinationLabel} (optional)
                    <Input
                      value={notes[target.targetId] ?? ""}
                      onValueChange={(value) =>
                        setNotes((current) => ({
                          ...current,
                          [target.targetId]: value,
                        }))
                      }
                      placeholder="Where and how it was posted"
                    />
                  </label>
                ) : null}
                {!archived &&
                !target.currentReceipt &&
                !promotedVersionId &&
                !readOnly ? (
                  <p id={readinessId} className="mt-2 text-xs text-amber-700">
                    Promote a version before confirming delivery.
                  </p>
                ) : null}
              </div>
              {!readOnly ? (
                <div className="flex flex-wrap gap-2">
                  {archived ? (
                    <Button
                      size="sm-touch"
                      variant="outline"
                      disabled={pending !== null}
                      aria-label={`Restore delivery target ${target.destinationLabel}`}
                      onClick={() =>
                        void run(target.targetId, () =>
                          changeRetention(target.targetId, "active")
                        )
                      }
                    >
                      <ArchiveRestore /> Restore
                    </Button>
                  ) : !target.isOriginal ? (
                    <Button
                      size="sm-touch"
                      variant="ghost"
                      disabled={pending !== null}
                      aria-label={`Archive delivery target ${target.destinationLabel}`}
                      onClick={() =>
                        void run(target.targetId, () =>
                          changeRetention(target.targetId, "archived")
                        )
                      }
                    >
                      <Archive /> Archive
                    </Button>
                  ) : null}
                  {!archived && !target.isOriginal ? (
                    <Button
                      size="sm-touch"
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
                  {!archived && target.currentReceipt ? (
                    <Button
                      size="sm-touch"
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
                  ) : !archived ? (
                    <Button
                      size="sm-touch"
                      disabled={pending !== null || !promotedVersionId}
                      aria-label={`Mark ${target.destinationLabel} responded`}
                      aria-describedby={
                        promotedVersionId ? undefined : readinessId
                      }
                      onClick={() =>
                        promotedVersionId
                          ? void run(
                              target.targetId,
                              () =>
                                confirm({
                                  data: {
                                    targetId: target.targetId,
                                    versionId: promotedVersionId,
                                    note:
                                      notes[target.targetId]?.trim() ||
                                      undefined,
                                    correlationId: crypto.randomUUID(),
                                  },
                                }),
                              (updated) => {
                                mergeVisibleTarget(updated)
                                setNotes((current) => {
                                  const next = { ...current }
                                  delete next[target.targetId]
                                  return next
                                })
                              }
                            )
                          : undefined
                      }
                    >
                      Mark responded
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
        {archivedCursor ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void loadMoreArchived()}
          >
            Load more archived channels
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
