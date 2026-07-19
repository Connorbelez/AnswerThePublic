import { useRef, useState } from "react"
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router"
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
import { loadWorkspaceSession } from "@/application/load-workspace-session"
import { requestListVariants } from "@/components/request-list-variants"
import { ContentRequestCard } from "@/components/content-request-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { useHydrated } from "@/hooks/use-hydrated"

export const Route = createFileRoute("/app/")({
  loader: async () => {
    const session = await loadWorkspaceSession()
    if (
      session.status === "authenticated" &&
      session.session.workspaceView === "elie"
    )
      return {
        requests:
          session.session.role === "administrator"
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
  const visibleOperatorItems = workspacePage?.page ?? []
  const visibleRequests = isFounder
    ? requests
    : visibleOperatorItems.map((item) => item.request)

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

  return (
    <main className="workspace" data-hydrated={hydrated}>
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
          <Button render={<Link to="/app/new" />}>
            <Plus data-icon="inline-start" />
            New request
          </Button>
        ) : null}
      </div>

      {!isFounder && operatorWorkspace ? (
        <Card tone="subtle" className="mt-6">
          <CardContent>
            <form
              className="grid gap-3"
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
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
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
                  aria-label="Retention"
                  className="w-full [&_select]:h-11"
                  value={retention}
                  onChange={(event) =>
                    setRetention(event.target.value as RequestRetention | "")
                  }
                >
                  <NativeSelectOption value="">
                    Active library
                  </NativeSelectOption>
                  <NativeSelectOption value="active">
                    Active only
                  </NativeSelectOption>
                  <NativeSelectOption value="archived">
                    Archived
                  </NativeSelectOption>
                </NativeSelect>
                <NativeSelect
                  aria-label="Lifecycle"
                  className="w-full [&_select]:h-11"
                  value={lifecycle}
                  onChange={(event) =>
                    setLifecycle(event.target.value as RequestLifecycle | "")
                  }
                >
                  <NativeSelectOption value="">
                    Any lifecycle
                  </NativeSelectOption>
                  <NativeSelectOption value="pending">
                    Pending
                  </NativeSelectOption>
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
                  aria-label="Disposition"
                  className="w-full [&_select]:h-11"
                  value={disposition}
                  onChange={(event) =>
                    setDisposition(
                      event.target.value as RequestDisposition | ""
                    )
                  }
                >
                  <NativeSelectOption value="">
                    Any disposition
                  </NativeSelectOption>
                  <NativeSelectOption value="active">Active</NativeSelectOption>
                  <NativeSelectOption value="expired">
                    Expired
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
                  onChange={(event) =>
                    setAssigneePrincipalId(event.target.value)
                  }
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
              <ToggleGroup
                className="justify-start overflow-x-auto pb-1"
                aria-label="Next action queue"
                value={[queue]}
                variant="outline"
                spacing={1}
                onValueChange={(values) => {
                  const value = values[0] as OperatorQueue | "all" | undefined
                  if (!value) return
                  setQueue(value)
                  void refreshWorkspace(currentFilters(value))
                }}
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
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    className="h-11 shrink-0 px-3"
                  >
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <div className="flex gap-2">
                <Button type="submit" size="sm-touch" disabled={loading}>
                  Apply filters
                </Button>
                {hasOperatorFilters ? (
                  <Button
                    type="button"
                    size="sm-touch"
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
          </CardContent>
        </Card>
      ) : null}

      {visibleRequests.length > 0 ? (
        <div className="library-controls">
          <span>
            {visibleRequests.length} request
            {visibleRequests.length === 1 ? "" : "s"}
          </span>
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
              className="size-11"
              aria-label={isFounder ? "Stack view" : "List view"}
            >
              <Layers3 />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="grid"
              className="size-11"
              aria-label="Grid view"
            >
              <LayoutGrid />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : null}

      {visibleRequests.length === 0 ? (
        <Card className="empty-queue" tone="subtle">
          <CardContent>
            <span className="empty-queue__icon" aria-hidden="true">
              <Inbox />
            </span>
            <h2>
              {!isFounder && hasOperatorFilters
                ? "No matching requests"
                : "No requests yet"}
            </h2>
            <p>
              {!isFounder && hasOperatorFilters
                ? "No active work matches these filters. Clear them to return to the complete workspace."
                : canCreate
                  ? "Add a direct request for Elie. Only a title is required; source material and context can be filled in when available."
                  : "Assigned requests will appear here when they are ready for your input."}
            </p>
            {canCreate ? (
              <Button className="mobile-create" render={<Link to="/app/new" />}>
                <Plus data-icon="inline-start" />
                Create a request
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <section
          className={requestListVariants({ view })}
          aria-label="Content requests"
          data-view={view}
        >
          {isFounder
            ? requests.map((request) => (
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
