import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clipboard,
  ExternalLink,
  ListFilter,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
} from "lucide-react"

import type {
  ContentRequest,
  OperatorWorkspaceItem,
} from "@/application/content-requests"
import { extractOpportunityBrief } from "@/lib/opportunity-brief"
import type { OpportunityBrief } from "@/lib/opportunity-brief"
import {
  getRequestClassification,
  type RequestCategory,
} from "@/lib/request-classification"
import { cn } from "@/lib/utils"
import { MarkdownContent } from "@/components/markdown-content"
import { RequestCategoryFilter } from "@/components/request-category-filter"
import { SourcePlatformIcon } from "@/components/ui/source-platform-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonAnchor } from "@/components/ui/button-link"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

type OpportunityQueueRailProps = {
  items: Array<OperatorWorkspaceItem>
  activeHumanId: string
  initialCollapsed?: boolean
  collapsible?: boolean
  onCollapsedChange?(collapsed: boolean): void
  className?: string
}

function scoreFor(item: OperatorWorkspaceItem) {
  return extractOpportunityBrief(item.request.source?.body).score
}

function ageFor(item: OperatorWorkspaceItem) {
  return extractOpportunityBrief(item.request.source?.body).ageLabel
}

function lifecycleLabel(request: ContentRequest) {
  return request.lifecycle
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase())
}

export function OpportunityQueueRail({
  items,
  activeHumanId,
  initialCollapsed = false,
  collapsible = true,
  onCollapsedChange,
  className,
}: OpportunityQueueRailProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [filter, setFilter] = useState<"needs_review" | "attention" | "all">(
    "needs_review"
  )
  const [sort, setSort] = useState<"score" | "newest">("score")
  const [category, setCategory] = useState<RequestCategory | "all">("all")
  const visibleItems = useMemo(() => {
    const filtered =
      filter === "attention"
        ? items.filter((item) => item.openConflictCount > 0)
        : items
    const categoryFiltered =
      category === "all"
        ? filtered
        : filtered.filter(
            (item) =>
              getRequestClassification(item.request).category === category
          )
    return [...categoryFiltered].sort((left, right) =>
      sort === "newest"
        ? right.request.createdAt - left.request.createdAt
        : (scoreFor(right) ?? -1) - (scoreFor(left) ?? -1)
    )
  }, [filter, category, items, sort])
  const activeIndex = Math.max(
    0,
    visibleItems.findIndex((item) => item.request.humanId === activeHumanId)
  )
  const setQueueCollapsed = (next: boolean) => {
    setCollapsed(next)
    onCollapsedChange?.(next)
  }

  return (
    <aside
      className={cn("triage-queue", className)}
      data-collapsed={collapsed || undefined}
      aria-label="Opportunity queue"
    >
      <div className="triage-queue__header">
        <div className="triage-queue__title">
          <ListFilter aria-hidden="true" />
          <strong>Opportunity queue</strong>
          <Badge variant="secondary">
            {visibleItems.length}
            {visibleItems.length !== items.length ? `/${items.length}` : ""}
          </Badge>
        </div>
        {collapsible ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={
              collapsed
                ? "Expand opportunity queue"
                : "Collapse opportunity queue"
            }
            aria-expanded={!collapsed}
            onClick={() => setQueueCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        ) : null}
      </div>

      {collapsed ? (
        <div className="triage-queue__collapsed-count">
          {activeIndex + 1} of {visibleItems.length}
        </div>
      ) : (
        <>
          <div
            className="triage-queue__filters"
            role="group"
            aria-label="Queue filters"
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" />}
              >
                {filter === "attention"
                  ? "Attention"
                  : filter === "all"
                    ? "All open"
                    : "Needs review"}
                <ChevronDown data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setFilter("needs_review")}>
                  Needs review
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFilter("attention")}>
                  Attention required
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFilter("all")}>
                  All open
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" aria-label="Sort queue" />
                }
              >
                {sort === "score" ? "Highest score" : "Newest"}
                <SlidersHorizontal data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSort("score")}>
                  Highest score
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSort("newest")}>
                  Newest first
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <RequestCategoryFilter
            value={category}
            onChange={setCategory}
            className="triage-queue__category-filter flex-wrap"
          />
          <nav
            className="triage-queue__items"
            aria-label="Queued opportunities"
          >
            {visibleItems.map((item) => {
              const active = item.request.humanId === activeHumanId
              const content = (
                <>
                  <span className="triage-queue__source">
                    <SourcePlatformIcon
                      platform={
                        getRequestClassification(item.request).source.platform
                      }
                    />
                  </span>
                  <span className="triage-queue__copy">
                    <strong>{item.request.title}</strong>
                    <span>
                      {scoreFor(item) ?? "—"} ·{" "}
                      {ageFor(item) ?? item.request.priority}
                    </span>
                  </span>
                  <span
                    className="triage-queue__risk"
                    data-attention={item.openConflictCount > 0 || undefined}
                  >
                    <span className="sr-only">
                      {item.openConflictCount > 0
                        ? "Attention required"
                        : "Ready for review"}
                    </span>
                  </span>
                </>
              )
              return active ? (
                <div
                  className="triage-queue__item"
                  data-active="true"
                  key={item.request.humanId}
                >
                  {content}
                </div>
              ) : (
                <Link
                  className="triage-queue__item"
                  to="/app/requests/$requestId"
                  params={{ requestId: item.request.humanId }}
                  key={item.request.humanId}
                >
                  {content}
                </Link>
              )
            })}
            {visibleItems.length === 0 ? (
              <p className="triage-queue__empty">
                No opportunities match this view.
              </p>
            ) : null}
          </nav>
          <div className="triage-queue__shortcuts">
            <Kbd>J</Kbd>
            <span>/</span>
            <Kbd>K</Kbd>
            <span>Navigate</span>
          </div>
        </>
      )}
    </aside>
  )
}

type OpportunityAssessmentProps = {
  request: ContentRequest
  brief: OpportunityBrief
  children?: React.ReactNode
}

export function OpportunityAssessment({
  request,
  brief,
  children,
}: OpportunityAssessmentProps) {
  const [copied, setCopied] = useState(false)
  const sourceLabel =
    request.source?.name || request.source?.channel || "Source"
  const draft = brief.draftResponse
  const copyDraft = async () => {
    if (!draft) return
    await navigator.clipboard.writeText(draft)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <article className="triage-assessment" aria-labelledby="opportunity-title">
      <div className="triage-assessment__signals">
        <div className="triage-assessment__source-context">
          <span className="triage-assessment__source">
            <MessageCircle aria-hidden="true" />
            {sourceLabel}
            {brief.ageLabel ? ` · ${brief.ageLabel}` : ""}
          </span>
          <span className="triage-assessment__id">{request.humanId}</span>
        </div>
        <div>
          {request.hasFounderDraft ? (
            <Badge variant="secondary">Founder draft saved</Badge>
          ) : null}
          <Badge variant="outline">{lifecycleLabel(request)}</Badge>
          {brief.score !== null ? (
            <Badge variant="outline">{brief.score} / 100</Badge>
          ) : null}
          {brief.risk ? (
            <Badge
              variant={brief.risk === "high" ? "destructive" : "secondary"}
            >
              {brief.risk[0].toUpperCase()}
              {brief.risk.slice(1)} risk
            </Badge>
          ) : null}
        </div>
      </div>

      <h1 id="opportunity-title">{request.title}</h1>

      {request.source?.question ? (
        <section className="triage-assessment__section">
          <h2>Original question</h2>
          <MarkdownContent>{request.source.question}</MarkdownContent>
        </section>
      ) : null}

      {brief.whyItMatters ? (
        <section className="triage-assessment__section">
          <h2>Why this matters</h2>
          <p>{brief.whyItMatters}</p>
        </section>
      ) : null}

      {brief.responseGap ? (
        <section className="triage-assessment__section">
          <h2>What replies miss</h2>
          <p>{brief.responseGap}</p>
        </section>
      ) : null}

      <section className="triage-assessment__section triage-assessment__draft">
        <div className="triage-assessment__section-heading">
          <h2>Draft response</h2>
          <div>
            {request.source?.url ? (
              <ButtonAnchor
                variant="ghost"
                size="sm"
                href={request.source.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open source <ExternalLink data-icon="inline-end" />
              </ButtonAnchor>
            ) : null}
            {draft ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => void copyDraft()}
              >
                <Clipboard data-icon="inline-start" />{" "}
                {copied ? "Copied" : "Copy draft"}
              </Button>
            ) : null}
          </div>
        </div>
        {draft ? (
          <MarkdownContent className="typeset-request" minimumHeadingLevel={3}>
            {draft}
          </MarkdownContent>
        ) : request.source?.body ? (
          <MarkdownContent className="typeset-request" minimumHeadingLevel={3}>
            {request.source.body}
          </MarkdownContent>
        ) : (
          <p className="text-muted-foreground">
            No response draft has been supplied.
          </p>
        )}
      </section>

      {brief.evidenceMarkdown ? (
        <Collapsible className="triage-assessment__disclosure">
          <CollapsibleTrigger render={<Button variant="outline" />}>
            Evidence ({brief.evidenceCount}){" "}
            <ChevronDown data-icon="inline-end" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <MarkdownContent
              className="typeset-request"
              minimumHeadingLevel={3}
            >
              {brief.evidenceMarkdown}
            </MarkdownContent>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {brief.compliance ? (
        <Collapsible className="triage-assessment__disclosure">
          <CollapsibleTrigger render={<Button variant="outline" />}>
            Compliance <ChevronDown data-icon="inline-end" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p>{brief.compliance}</p>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {children}
    </article>
  )
}

type TriageInboxProps = {
  queueItems: Array<OperatorWorkspaceItem>
  activeHumanId: string
  assessment: React.ReactNode
  decision: React.ReactNode
  mobileDecision: React.ReactNode
  mobileActionDecision: React.ReactNode
  selectedFormatCount: number
}

export function TriageInbox({
  queueItems,
  activeHumanId,
  assessment,
  decision,
  mobileDecision,
  mobileActionDecision,
  selectedFormatCount,
}: TriageInboxProps) {
  const navigate = useNavigate()
  const activeIndex = Math.max(
    0,
    queueItems.findIndex((item) => item.request.humanId === activeHumanId)
  )
  const previous = queueItems[activeIndex - 1]?.request
  const next = queueItems[activeIndex + 1]?.request
  const initialCollapsed = useMemo(() => {
    if (typeof window === "undefined") return false
    return (
      window.localStorage.getItem("fairlend:triage-queue-collapsed") === "true"
    )
  }, [])
  const rememberCollapsed = (collapsed: boolean) => {
    window.localStorage.setItem(
      "fairlend:triage-queue-collapsed",
      String(collapsed)
    )
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      const destination =
        event.key.toLowerCase() === "j"
          ? next
          : event.key.toLowerCase() === "k"
            ? previous
            : null
      if (!destination) return
      event.preventDefault()
      void navigate({
        to: "/app/requests/$requestId",
        params: { requestId: destination.humanId },
        viewTransition: false,
      })
    }
    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [navigate, next, previous])

  return (
    <main className="triage-inbox" id="main-content">
      <div className="triage-mobile-nav">
        <Sheet>
          <SheetTrigger render={<Button variant="outline" />}>
            <ListFilter data-icon="inline-start" /> {activeIndex + 1} of{" "}
            {queueItems.length}
            <ChevronDown data-icon="inline-end" />
          </SheetTrigger>
          <SheetContent side="left" className="triage-mobile-queue-sheet">
            <SheetHeader>
              <SheetTitle>Opportunity queue</SheetTitle>
              <SheetDescription>
                Review and route the highest-value opportunities.
              </SheetDescription>
            </SheetHeader>
            <OpportunityQueueRail
              items={queueItems}
              activeHumanId={activeHumanId}
              collapsible={false}
            />
          </SheetContent>
        </Sheet>
        <div className="triage-mobile-nav__stepper">
          {previous ? (
            <Link
              className="triage-stepper-link"
              to="/app/requests/$requestId"
              params={{ requestId: previous.humanId }}
            >
              <ChevronLeft data-icon="inline-start" /> Previous
            </Link>
          ) : (
            <Button variant="outline" disabled>
              Previous
            </Button>
          )}
          {next ? (
            <Link
              className="triage-stepper-link"
              to="/app/requests/$requestId"
              params={{ requestId: next.humanId }}
            >
              Next <ChevronRight data-icon="inline-end" />
            </Link>
          ) : (
            <Button variant="outline" disabled>
              Next
            </Button>
          )}
        </div>
      </div>

      <OpportunityQueueRail
        className="triage-inbox__queue"
        items={queueItems}
        activeHumanId={activeHumanId}
        initialCollapsed={initialCollapsed}
        onCollapsedChange={rememberCollapsed}
      />
      <div className="triage-inbox__assessment">{assessment}</div>
      <aside className="triage-inbox__decision">{decision}</aside>

      <Sheet>
        <div className="triage-mobile-action-bar">
          <SheetTrigger render={<Button variant="outline" size="icon-sm" />}>
            <ChevronUp aria-hidden="true" />
            <span className="sr-only">
              Review {selectedFormatCount} selected outputs
            </span>
          </SheetTrigger>
          {mobileActionDecision}
        </div>
        <SheetContent side="bottom" className="triage-mobile-decision-sheet">
          <SheetHeader>
            <SheetTitle>Route and repurpose</SheetTitle>
            <SheetDescription>
              Confirm the founder and the content formats to create.
            </SheetDescription>
          </SheetHeader>
          {mobileDecision}
        </SheetContent>
      </Sheet>
    </main>
  )
}
