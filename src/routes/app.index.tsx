import { useEffect, useRef, useState } from "react"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Inbox, Layers3, LayoutGrid, Plus, Search } from "lucide-react"

import type {
  OperatorQueue,
  RequestDisposition,
  RequestLifecycle,
  RequestOrigin,
  RequestPriority,
  RequestRetention,
} from "@/application/content-requests"
import {
  listContentRequests,
  listElieWorkspace,
  listAssignablePrincipals,
  listOperatorWorkspace,
} from "@/application/content-request-server-functions"
import { ContentRequestCard } from "@/components/content-request-card"
import { RequestCategoryFilter } from "@/components/request-category-filter"
import {
  WorkspaceRetentionToggle,
  type WorkspaceCollection,
} from "@/components/workspace-retention-toggle"
import {
  getRequestClassification,
  type RequestCategory,
} from "@/lib/request-classification"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { useHydrated } from "@/hooks/use-hydrated"

export const Route = createFileRoute("/app/")({
  loader: async ({ context }) => {
    const session = context.workspaceSession
    if (session.workspaceView === "elie")
      return {
        requests:
          session.role === "administrator"
            ? await listElieWorkspace()
            : await listContentRequests(),
        operatorWorkspace: null,
        principals: [],
      }
    const [operatorWorkspace, principals] = await Promise.all([
      listOperatorWorkspace({ data: { limit: 50 } }),
      listAssignablePrincipals(),
    ])
    return {
      requests: [],
      operatorWorkspace,
      principals,
    }
  },
  component: RequestLibrary,
})

const appRoute = getRouteApi("/app")

type WorkspaceFilters = {
  queue: OperatorQueue | "all"
  search: string
  priority: RequestPriority | ""
  lifecycle: RequestLifecycle | ""
  disposition: RequestDisposition | ""
  retention: RequestRetention | ""
  origin: RequestOrigin | ""
  assigneePrincipalId: string
  deliveryChannel: string
}

function RequestLibrary() {
  const { requests, operatorWorkspace, principals } = Route.useLoaderData()
  const session = appRoute.useLoaderData()
  const isFounder = session.workspaceView === "elie"
  const canCreate = !isFounder
  const [view, setView] = useState<"stack" | "list" | "grid">(
    isFounder ? "stack" : "list"
  )
  const [queue, setQueue] = useState<OperatorQueue | "all">("all")
  const [search, setSearch] = useState("")
  const [priority, setPriority] = useState<RequestPriority | "">("")
  const [lifecycle, setLifecycle] = useState<RequestLifecycle | "">("")
  const [disposition, setDisposition] = useState<RequestDisposition | "">("")
  const [retention, setRetention] = useState<RequestRetention | "">("")
  const [origin, setOrigin] = useState<RequestOrigin | "">("")
  const [category, setCategory] = useState<RequestCategory | "all">("all")
  const [assigneePrincipalId, setAssigneePrincipalId] = useState("")
  const [deliveryChannel, setDeliveryChannel] = useState("")
  const [workspacePage, setWorkspacePage] = useState(operatorWorkspace)
  const [loading, setLoading] = useState(false)
  const appliedFilters = useRef<WorkspaceFilters>({
    queue: "all",
    search: "",
    priority: "",
    lifecycle: "",
    disposition: "",
    retention: "",
    origin: "",
    assigneePrincipalId: "",
    deliveryChannel: "",
  })
  const requestGeneration = useRef(0)
  const fetchWorkspace = useServerFn(listOperatorWorkspace)
  const hydrated = useHydrated()
  const operatorItems = workspacePage?.page ?? []
  const baseRequests = isFounder
    ? requests
    : operatorItems.map((item) => item.request)
  const categoryCounts: Partial<Record<RequestCategory | "all", number>> = {
    all: baseRequests.length,
  }
  for (const request of baseRequests) {
    const requestCategory = getRequestClassification(request).category
    categoryCounts[requestCategory] = (categoryCounts[requestCategory] ?? 0) + 1
  }
  const matchesCategory = (request: (typeof baseRequests)[number]) =>
    category === "all" ||
    getRequestClassification(request).category === category
  const visibleOperatorItems = operatorItems.filter(({ request }) =>
    matchesCategory(request)
  )
  const visibleRequests = baseRequests.filter(matchesCategory)

  useEffect(() => {
    if (!isFounder || requests.length === 0) return
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string }
      }
    ).connection
    if (
      connection?.saveData ||
      connection?.effectiveType === "slow-2g" ||
      connection?.effectiveType === "2g"
    ) {
      return
    }
    const preload = () => void import("@/components/founder-request-canvas")
    const scheduleIdle = window.requestIdleCallback?.bind(window)
    if (scheduleIdle) {
      const idleId = scheduleIdle(preload, { timeout: 2_000 })
      return () => window.cancelIdleCallback(idleId)
    }
    const timeoutId = globalThis.setTimeout(preload, 1_200)
    return () => globalThis.clearTimeout(timeoutId)
  }, [isFounder, requests.length])

  function updateView(nextView: "stack" | "list" | "grid") {
    setView(nextView)
  }

  function currentFilters(
    nextQueue: OperatorQueue | "all" = queue
  ): WorkspaceFilters {
    return {
      queue: nextQueue,
      search,
      priority,
      lifecycle,
      disposition,
      retention,
      origin,
      assigneePrincipalId,
      deliveryChannel,
    }
  }

  async function refreshWorkspace(
    filters: WorkspaceFilters,
    cursor: string | null = null,
    append = false
  ) {
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    if (!append) appliedFilters.current = filters
    setLoading(true)
    try {
      const next = await fetchWorkspace({
        data: {
          queue: filters.queue === "all" ? undefined : filters.queue,
          search: filters.search.trim() || undefined,
          priority: filters.priority || undefined,
          lifecycle: filters.lifecycle || undefined,
          disposition: filters.disposition || undefined,
          retention: filters.retention || undefined,
          origin: filters.origin || undefined,
          assigneePrincipalId: filters.assigneePrincipalId || undefined,
          deliveryChannel: filters.deliveryChannel.trim() || undefined,
          cursor,
          limit: 50,
        },
      })
      if (requestGeneration.current !== generation) return
      setWorkspacePage((current) =>
        append && current
          ? { ...next, page: [...current.page, ...next.page] }
          : next
      )
    } finally {
      if (requestGeneration.current === generation) setLoading(false)
    }
  }

  const hasOperatorFilters = Boolean(
    queue !== "all" ||
    search.trim() ||
    priority ||
    lifecycle ||
    disposition ||
    retention ||
    origin ||
    assigneePrincipalId ||
    deliveryChannel.trim()
  )
  const advancedFilterCount = [
    priority,
    lifecycle,
    origin,
    assigneePrincipalId,
    deliveryChannel.trim(),
  ].filter(Boolean).length
  const collection: WorkspaceCollection =
    retention === "archived"
      ? "archived"
      : disposition === "expired"
        ? "expired"
        : "active"

  function changeCollection(nextCollection: WorkspaceCollection) {
    const nextRetention = nextCollection === "archived" ? "archived" : ""
    const nextDisposition = nextCollection === "expired" ? "expired" : ""
    const nextFilters = {
      ...currentFilters("all"),
      disposition: nextDisposition,
      retention: nextRetention,
    } satisfies WorkspaceFilters

    setQueue("all")
    setDisposition(nextDisposition)
    setRetention(nextRetention)
    void refreshWorkspace(nextFilters)
  }

  return (
    <main
      className="workspace"
      data-hmr-probe="v3"
      data-hydrated={hydrated}
      id="main-content"
    >
      <div className="workspace__heading">
        <div>
          <Badge variant="secondary">
            {isFounder ? "Founder library" : "Operator workspace"}
          </Badge>
          <h1>Content requests</h1>
          <p>
            {isFounder
              ? "Your prioritized queue of expert response opportunities."
              : "Capture, prioritize, and route expert response opportunities."}
          </p>
        </div>
        {canCreate ? (
          <ButtonLink to="/app/new">
            <Plus data-icon="inline-start" />
            New request
          </ButtonLink>
        ) : null}
      </div>

      {canCreate ? (
        <ButtonLink
          className="mobile-create workspace__mobile-create"
          to="/app/new"
        >
          <Plus data-icon="inline-start" />
          New request
        </ButtonLink>
      ) : null}

      {!isFounder && operatorWorkspace ? (
        <form
          className="workspace-filters"
          aria-label="Operator action queues"
          onSubmit={(event) => {
            event.preventDefault()
            void refreshWorkspace(currentFilters())
          }}
        >
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="h-11 pl-9"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title or request ID"
              aria-label="Search content requests"
            />
          </div>
          <WorkspaceRetentionToggle
            value={collection}
            onChange={changeCollection}
            disabled={loading}
          />
          <details className="workspace-filter-details">
            <summary>
              More filters
              {advancedFilterCount > 0 ? (
                <Badge variant="secondary">{advancedFilterCount} active</Badge>
              ) : null}
            </summary>
            <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-5">
              <NativeSelect
                aria-label="Priority"
                className="w-full [&_select]:h-11"
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as RequestPriority | "")
                }
              >
                <NativeSelectOption value="">Any priority</NativeSelectOption>
                <NativeSelectOption value="critical">
                  Critical
                </NativeSelectOption>
                <NativeSelectOption value="high">High</NativeSelectOption>
                <NativeSelectOption value="normal">Normal</NativeSelectOption>
                <NativeSelectOption value="low">Low</NativeSelectOption>
              </NativeSelect>
              <NativeSelect
                aria-label="Lifecycle"
                className="w-full [&_select]:h-11"
                value={lifecycle}
                onChange={(event) =>
                  setLifecycle(event.target.value as RequestLifecycle | "")
                }
              >
                <NativeSelectOption value="">Any lifecycle</NativeSelectOption>
                <NativeSelectOption value="pending">Pending</NativeSelectOption>
                <NativeSelectOption value="in_progress">
                  In progress
                </NativeSelectOption>
                <NativeSelectOption value="founder_complete">
                  Founder complete
                </NativeSelectOption>
                <NativeSelectOption value="ready_to_respond">
                  Ready to respond
                </NativeSelectOption>
                <NativeSelectOption value="responded">
                  Responded
                </NativeSelectOption>
              </NativeSelect>
              <NativeSelect
                aria-label="Source"
                className="w-full [&_select]:h-11"
                value={origin}
                onChange={(event) =>
                  setOrigin(event.target.value as RequestOrigin | "")
                }
              >
                <NativeSelectOption value="">Any source</NativeSelectOption>
                <NativeSelectOption value="manual">Manual</NativeSelectOption>
                <NativeSelectOption value="automated_scout">
                  Scout
                </NativeSelectOption>
                <NativeSelectOption value="chatgpt_app">
                  ChatGPT
                </NativeSelectOption>
                <NativeSelectOption value="cli">CLI</NativeSelectOption>
                <NativeSelectOption value="http_api">
                  HTTP API
                </NativeSelectOption>
              </NativeSelect>
              <NativeSelect
                aria-label="Assignee"
                className="w-full [&_select]:h-11"
                value={assigneePrincipalId}
                onChange={(event) => setAssigneePrincipalId(event.target.value)}
              >
                <NativeSelectOption value="">Any assignee</NativeSelectOption>
                {principals.map((principal) => (
                  <NativeSelectOption
                    key={principal.principalId}
                    value={principal.principalId}
                  >
                    {principal.subject}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Input
                className="h-11"
                aria-label="Delivery channel"
                value={deliveryChannel}
                onChange={(event) => setDeliveryChannel(event.target.value)}
                placeholder="Delivery channel"
              />
            </div>
          </details>
          <div
            className="flex flex-wrap gap-2 pb-1"
            role="group"
            aria-label="Next action queue"
          >
            {(
              [
                ["all", "All"],
                ["needs_elie", "Needs Elie"],
                ["agent_drafting", "Agent drafting"],
                ["needs_operator", "Needs operator"],
                ["delivered", "Delivered"],
                ["attention_required", "Attention required"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                className="min-h-11 max-w-full min-w-0 whitespace-normal"
                variant={queue === value ? "default" : "outline"}
                aria-pressed={queue === value}
                type="button"
                onClick={() => {
                  setQueue(value)
                  void refreshWorkspace(currentFilters(value))
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              className="min-h-11"
              disabled={loading}
            >
              Apply filters
            </Button>
            {hasOperatorFilters ? (
              <Button
                type="button"
                size="sm"
                className="min-h-11"
                variant="ghost"
                onClick={() => {
                  setQueue("all")
                  setSearch("")
                  setPriority("")
                  setLifecycle("")
                  setDisposition("")
                  setRetention("")
                  setOrigin("")
                  setAssigneePrincipalId("")
                  setDeliveryChannel("")
                  void refreshWorkspace({
                    queue: "all",
                    search: "",
                    priority: "",
                    lifecycle: "",
                    disposition: "",
                    retention: "",
                    origin: "",
                    assigneePrincipalId: "",
                    deliveryChannel: "",
                  })
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {baseRequests.length > 0 ? (
        <RequestCategoryFilter
          value={category}
          onChange={setCategory}
          counts={categoryCounts}
          className="workspace__category-filter"
        />
      ) : null}

      {visibleRequests.length > 0 ? (
        <div className="library-controls">
          <div className="library-controls__summary">
            <span>
              {isFounder
                ? "Priority queue"
                : collection === "archived"
                  ? "Archive"
                  : collection === "expired"
                    ? "Expired opportunities"
                    : "Request queue"}
            </span>
            <strong>
              {visibleRequests.length} request
              {visibleRequests.length === 1 ? "" : "s"}
            </strong>
          </div>
          <ToggleGroup
            aria-label="Library view"
            disabled={!hydrated}
            value={[view]}
            onValueChange={(values) => {
              const nextView = values[0]
              if (
                nextView === "stack" ||
                nextView === "list" ||
                nextView === "grid"
              )
                updateView(nextView)
            }}
            variant="outline"
            spacing={0}
          >
            <ToggleGroupItem
              value={isFounder ? "stack" : "list"}
              className="library-controls__view"
              aria-label={isFounder ? "Stack view" : "List view"}
            >
              <Layers3 />
              <span>{isFounder ? "Queue" : "List"}</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="grid"
              className="library-controls__view"
              aria-label="Grid view"
            >
              <LayoutGrid />
              <span>Grid</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : null}

      {visibleRequests.length === 0 ? (
        <Card className="empty-queue">
          <CardContent>
            <span className="empty-queue__icon" aria-hidden="true">
              <Inbox />
            </span>
            <h2>
              {(!isFounder && hasOperatorFilters) || category !== "all"
                ? "No matching requests"
                : "No requests yet"}
            </h2>
            <p>
              {(!isFounder && hasOperatorFilters) || category !== "all"
                ? collection === "archived"
                  ? "No archived requests match these filters. Clear them to view the complete archive."
                  : collection === "expired"
                    ? "No expired requests match these filters. Clear them to review every expired opportunity."
                    : "No active work matches these filters. Clear them to return to the complete workspace."
                : canCreate
                  ? "Add a direct request for Elie. Only a title is required; source material and context can be filled in when available."
                  : "Assigned requests will appear here when they are ready for your input."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <section
          className={`request-list request-list--${view}`}
          aria-label="Content requests"
          data-view={view}
        >
          {isFounder
            ? visibleRequests.map((request) => (
                <ContentRequestCard key={request.humanId} request={request} />
              ))
            : visibleOperatorItems.map(({ request, ...operational }) => (
                <ContentRequestCard
                  key={request.humanId}
                  request={request}
                  operational={operational}
                />
              ))}
        </section>
      )}
      {!isFounder && workspacePage && !workspacePage.isDone ? (
        <Button
          className="min-h-11"
          variant="outline"
          disabled={loading}
          onClick={() =>
            void refreshWorkspace(
              appliedFilters.current,
              workspacePage.continueCursor,
              true
            )
          }
        >
          Load more requests
        </Button>
      ) : null}
    </main>
  )
}
