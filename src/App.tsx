// THROWAWAY PROTOTYPE — Three variants of the mobile Founder Input composer,
// switchable via `?variant=A|B|C`, answering how context should stay available while responding.
import { useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileCheck2,
  FileText,
  GripHorizontal,
  GripVertical,
  Link2,
  Keyboard,
  Mic,
  MoreHorizontal,
  Pause,
  Pin,
  PinOff,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react"
import { Group as PanelGroup, Panel, Separator } from "react-resizable-panels"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

type VariantKey = "A" | "B" | "C"
type ComposerMode = "type" | "record"

const variants: { key: VariantKey; name: string }[] = [
  { key: "A", name: "Context dock" },
  { key: "B", name: "Brief + editor" },
  { key: "C", name: "Context deck" },
]

const request = {
  id: "CR-0142",
  title: "Financing a laneway suite without breaking a low-rate mortgage",
  source: "r/TorontoRealEstate",
  age: "Posted 3h ago",
  urgency: "Due today",
  responseLength: "3–5 min",
  question:
    "We own a detached Toronto home and want to build a laneway suite. Can we use our equity to finance construction without refinancing our existing 2.19% mortgage?",
  talkingPoints: [
    {
      id: "tp-1",
      title: "Separate the mortgage from the construction facility",
      detail:
        "A home-equity product or second-position facility may preserve the first mortgage, but available options depend on combined loan-to-value, income qualification, and lender consent.",
    },
    {
      id: "tp-2",
      title: "Construction money is usually released in stages",
      detail:
        "Draw schedules, inspections, permits, and cost-to-complete controls matter more than the headline loan amount. Explain the cash-flow gap before the first draw.",
    },
    {
      id: "tp-3",
      title: "Compare total carrying cost—not only the new rate",
      detail:
        "Preserving a low first-mortgage rate can be valuable, but legal fees, appraisal costs, interest-only periods, and renewal timing belong in the comparison.",
    },
  ],
  research: [
    {
      label: "City of Toronto — Laneway suites",
      note: "Eligibility, zoning pathway, permits, and city guidance.",
      url: "https://www.toronto.ca/city-government/planning-development/planning-studies-initiatives/laneway-suites/",
      verified: true,
    },
    {
      label: "CMHC — Secondary suites",
      note: "General housing-supply and secondary-suite context.",
      url: "https://www.cmhc-schl.gc.ca/",
      verified: true,
    },
    {
      label: "FairLend construction file checklist",
      note: "Internal operating context: budget, permits, appraisal, draw schedule.",
      url: "#",
      verified: true,
    },
  ],
  missingResearch: [
    "Confirm whether the existing lender permits secondary financing.",
    "Ask whether permits and a fixed construction budget are already in hand.",
    "Do not estimate borrowing capacity without current income, debt, and property value.",
  ],
  guardrail:
    "Keep the answer educational. Do not imply approval, quote a rate, or give zoning or legal advice. Disclose the FairLend affiliation if replying publicly.",
}

const initialDraft =
  "The key point is that refinancing the existing mortgage is not necessarily the only path. I would first separate the decision into two facilities: the low-rate first mortgage you want to preserve, and the new money required for construction.\n\n"

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

function usePrototypeState() {
  const [draft, setDraft] = useState(initialDraft)
  const [mode, setMode] = useState<ComposerMode>("type")
  const [pinned, setPinned] = useState<string[]>(["tp-1"])
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(73)
  const [saveState, setSaveState] = useState<"Saved" | "Saving…" | "Offline">(
    "Saved",
  )
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(
      () => setRecordingSeconds((value) => value + 1),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [recording])

  const updateDraft = (value: string) => {
    setDraft(value)
    setSaveState("Saving…")
    window.setTimeout(() => setSaveState("Saved"), 550)
  }

  const togglePin = (id: string) => {
    setPinned((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )
  }

  return {
    draft,
    mode,
    pinned,
    recording,
    recordingSeconds,
    saveState,
    submitted,
    setMode,
    setRecording,
    setSubmitted,
    togglePin,
    updateDraft,
  }
}

type PrototypeState = ReturnType<typeof usePrototypeState>

function RequestTopBar({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <header
      className={cn(
        "flex min-h-14 items-center justify-between gap-3 border-b px-4",
        tone === "dark"
          ? "border-white/10 bg-[#17211b] text-white"
          : "border-black/8 bg-white/90 text-[#17211b] backdrop-blur-xl",
      )}
    >
      <Button
        aria-label="Back to content requests"
        variant="ghost"
        size="icon-lg"
        className={cn(
          "-ml-2 rounded-full",
          tone === "dark" && "text-white hover:bg-white/10 hover:text-white",
        )}
      >
        <ArrowLeft />
      </Button>
      <div className="min-w-0 flex-1 text-center">
        <p
          className={cn(
            "truncate text-[11px] font-semibold tracking-[0.14em] uppercase",
            tone === "dark" ? "text-white/55" : "text-black/45",
          )}
        >
          {request.id} · Founder input
        </p>
        <p className="truncate text-sm font-semibold">{request.title}</p>
      </div>
      <Button
        aria-label="More actions"
        variant="ghost"
        size="icon-lg"
        className={cn(
          "-mr-2 rounded-full",
          tone === "dark" && "text-white hover:bg-white/10 hover:text-white",
        )}
      >
        <MoreHorizontal />
      </Button>
    </header>
  )
}

function SaveStatus({ state }: { state: PrototypeState["saveState"] }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full",
          state === "Saved" && "bg-emerald-500",
          state === "Saving…" && "animate-pulse bg-amber-500",
          state === "Offline" && "bg-slate-400",
        )}
      />
      {state}
    </div>
  )
}

function ModeSwitch({ state }: { state: PrototypeState }) {
  return (
    <div className="grid grid-cols-2 rounded-2xl bg-black/5 p-1">
      <button
        type="button"
        onClick={() => state.setMode("type")}
        className={cn(
          "flex min-h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition",
          state.mode === "type"
            ? "bg-white text-[#17211b] shadow-sm"
            : "text-black/50",
        )}
      >
        <FileText className="size-4" />
        Type
      </button>
      <button
        type="button"
        onClick={() => state.setMode("record")}
        className={cn(
          "flex min-h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition",
          state.mode === "record"
            ? "bg-white text-[#17211b] shadow-sm"
            : "text-black/50",
        )}
      >
        <Mic className="size-4" />
        Record
      </button>
    </div>
  )
}

function TextComposer({
  state,
  className,
}: {
  state: PrototypeState
  className?: string
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <Textarea
        aria-label="Founder input"
        value={state.draft}
        onChange={(event) => state.updateDraft(event.target.value)}
        placeholder="Add your perspective…"
        className="min-h-56 flex-1 resize-none border-0 bg-transparent px-0 py-2 text-[17px] leading-7 shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between border-t border-black/8 pt-3">
        <span className="text-xs text-muted-foreground">
          {state.draft.trim().split(/\s+/).length} words
        </span>
        <SaveStatus state={state.saveState} />
      </div>
    </div>
  )
}

function AudioComposer({ state }: { state: PrototypeState }) {
  return (
    <div className="flex min-h-64 flex-1 flex-col items-center justify-center rounded-[28px] border border-black/8 bg-[#f3f0e8] px-5 py-8 text-center">
      <div className="mb-7 flex h-14 items-end gap-1" aria-hidden="true">
        {[18, 34, 48, 25, 54, 38, 22, 44, 58, 31, 46, 24, 37, 52, 28].map(
          (height, index) => (
            <span
              key={index}
              className={cn(
                "w-1 rounded-full bg-[#2e765e] transition-all",
                state.recording && "animate-wave",
              )}
              style={{
                height,
                animationDelay: `${index * 45}ms`,
              }}
            />
          ),
        )}
      </div>
      <p className="font-mono text-3xl font-semibold tracking-tight tabular-nums">
        {formatTimer(state.recordingSeconds)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {state.recording ? "Recording locally" : "Recording paused"}
      </p>
      <button
        type="button"
        onClick={() => state.setRecording(!state.recording)}
        className={cn(
          "mt-6 flex size-16 items-center justify-center rounded-full text-white shadow-lg transition active:scale-95",
          state.recording ? "bg-[#17211b]" : "bg-[#df5b3f]",
        )}
        aria-label={state.recording ? "Pause recording" : "Resume recording"}
      >
        {state.recording ? (
          <Pause className="size-6 fill-current" />
        ) : (
          <Mic className="size-6" />
        )}
      </button>
      <p className="mt-5 max-w-60 text-xs leading-5 text-muted-foreground">
        Prototype recording only—no microphone access. Audio continues while you
        open the brief.
      </p>
    </div>
  )
}

function SubmitBar({ state }: { state: PrototypeState }) {
  return (
    <div className="flex items-center gap-3 border-t border-black/8 bg-white/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
      <Button variant="outline" size="lg" className="h-12 flex-1 rounded-2xl">
        Save & close
      </Button>
      <Button
        size="lg"
        className={cn(
          "h-12 flex-[1.35] rounded-2xl",
          state.submitted
            ? "bg-emerald-700 hover:bg-emerald-700"
            : "bg-[#17211b] hover:bg-[#2a392f]",
        )}
        onClick={() => state.setSubmitted(true)}
      >
        {state.submitted ? (
          <>
            <Check /> Submitted
          </>
        ) : (
          <>
            <Send /> Submit for review
          </>
        )}
      </Button>
    </div>
  )
}

function QuestionBlock({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[24px] border border-[#17211b]/10 bg-[#e8f0e9]",
        compact ? "p-4" : "p-5",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge className="bg-[#17211b] text-white">Original question</Badge>
        <Badge variant="outline" className="border-[#df5b3f]/30 text-[#b43e28]">
          <Clock3 /> {request.urgency}
        </Badge>
      </div>
      <p
        className={cn(
          "font-heading font-semibold tracking-[-0.025em] text-[#17211b]",
          compact ? "text-base leading-6" : "text-xl leading-7",
        )}
      >
        “{request.question}”
      </p>
      {!compact && (
        <div className="mt-4 flex items-center gap-2 text-xs font-medium text-[#17211b]/55">
          <span>{request.source}</span>
          <span>·</span>
          <span>{request.age}</span>
        </div>
      )}
    </div>
  )
}

function TalkingPointList({
  state,
  pinning = true,
}: {
  state: PrototypeState
  pinning?: boolean
}) {
  return (
    <div className="space-y-3">
      {request.talkingPoints.map((point, index) => {
        const isPinned = state.pinned.includes(point.id)
        return (
          <article
            key={point.id}
            className={cn(
              "rounded-[22px] border bg-white p-4 transition",
              isPinned ? "border-[#2e765e]/40" : "border-black/8",
            )}
          >
            <div className="flex items-start gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#17211b] text-xs font-bold text-white">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold leading-5 text-[#17211b]">
                  {point.title}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-black/55">
                  {point.detail}
                </p>
              </div>
              {pinning && (
                <button
                  type="button"
                  onClick={() => state.togglePin(point.id)}
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border transition",
                    isPinned
                      ? "border-[#2e765e] bg-[#e8f0e9] text-[#2e765e]"
                      : "border-black/10 text-black/40 hover:bg-black/5",
                  )}
                  aria-label={isPinned ? `Unpin ${point.title}` : `Pin ${point.title}`}
                >
                  {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function ResearchList() {
  return (
    <div className="space-y-2">
      {request.research.map((source) => (
        <a
          key={source.label}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="group flex items-start gap-3 rounded-[20px] border border-black/8 bg-white p-3.5 transition hover:border-[#2e765e]/30 hover:bg-[#f8faf8]"
        >
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e8f0e9] text-[#2e765e]">
            <Link2 className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-sm font-semibold text-[#17211b]">
              {source.label}
              <ExternalLink className="size-3 opacity-0 transition group-hover:opacity-100" />
            </span>
            <span className="mt-1 block text-xs leading-5 text-black/50">
              {source.note}
            </span>
          </span>
          <Check className="mt-1 size-4 shrink-0 text-emerald-600" />
        </a>
      ))}
    </div>
  )
}

function PinnedPointChips({ state }: { state: PrototypeState }) {
  const points = request.talkingPoints.filter((point) =>
    state.pinned.includes(point.id),
  )
  if (!points.length) return null

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
      {points.map((point) => (
        <button
          key={point.id}
          type="button"
          onClick={() => state.togglePin(point.id)}
          className="flex min-w-52 items-start gap-2 rounded-2xl border border-[#2e765e]/20 bg-[#eef5ef] p-3 text-left text-xs font-semibold leading-4 text-[#214f40]"
        >
          <Pin className="mt-0.5 size-3 shrink-0 fill-current" />
          <span className="line-clamp-2">{point.title}</span>
          <X className="ml-auto size-3 shrink-0 opacity-50" />
        </button>
      ))}
    </div>
  )
}

function FullBrief({ state }: { state: PrototypeState }) {
  return (
    <div className="space-y-7 px-5 pb-10">
      <QuestionBlock />
      <section>
        <SectionHeading icon={Sparkles} eyebrow="Prepared for you" title="Talking points" />
        <TalkingPointList state={state} />
      </section>
      <section>
        <SectionHeading icon={Search} eyebrow="Evidence pack" title="Research & citations" />
        <ResearchList />
      </section>
      <section>
        <SectionHeading icon={CircleAlert} eyebrow="Before answering" title="Still to verify" />
        <div className="rounded-[22px] border border-amber-900/10 bg-amber-50 p-4">
          <ul className="space-y-3 text-sm leading-6 text-amber-950/70">
            {request.missingResearch.map((item) => (
              <li key={item} className="flex gap-2.5">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section>
        <SectionHeading icon={FileCheck2} eyebrow="Guardrail" title="How to frame the answer" />
        <p className="rounded-[22px] bg-[#17211b] p-4 text-sm leading-6 text-white/75">
          {request.guardrail}
        </p>
      </section>
    </div>
  )
}

function SectionHeading({
  icon: Icon,
  eyebrow,
  title,
}: {
  icon: typeof Sparkles
  eyebrow: string
  title: string
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="flex size-9 items-center justify-center rounded-full bg-[#17211b] text-white">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-[10px] font-bold tracking-[0.16em] text-black/40 uppercase">
          {eyebrow}
        </p>
        <h2 className="font-heading text-lg font-semibold tracking-tight text-[#17211b]">
          {title}
        </h2>
      </div>
    </div>
  )
}

function VariantA({ state }: { state: PrototypeState }) {
  const [briefOpen, setBriefOpen] = useState(false)

  return (
    <main className="flex min-h-svh flex-col bg-[#fbfaf6] text-[#17211b]">
      <RequestTopBar />
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <button
          type="button"
          onClick={() => setBriefOpen(true)}
          className="group m-4 mb-3 rounded-[26px] border border-[#17211b]/10 bg-[#e8f0e9] p-4 text-left shadow-[0_12px_32px_rgba(23,33,27,0.06)] transition hover:border-[#2e765e]/35"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-[#17211b] text-white">Original question</Badge>
              <Badge variant="outline" className="border-[#df5b3f]/30 text-[#b43e28]">
                {request.urgency}
              </Badge>
            </div>
            <span className="flex items-center gap-1 text-xs font-semibold text-[#2e765e]">
              Open brief <ChevronDown className="size-3.5" />
            </span>
          </div>
          <p className="mt-3 line-clamp-2 text-[17px] font-semibold leading-6 tracking-tight">
            “{request.question}”
          </p>
          <div className="mt-3 flex items-center justify-between text-xs text-black/45">
            <span>{request.source} · {request.age}</span>
            <span className="opacity-0 transition group-hover:opacity-100">Tap to expand</span>
          </div>
        </button>

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-3">
          <div className="mb-3 flex items-center justify-between gap-4">
            <ModeSwitch state={state} />
            <SaveStatus state={state.saveState} />
          </div>
          <PinnedPointChips state={state} />
          <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-[28px] border border-black/8 bg-white p-5 shadow-[0_16px_40px_rgba(23,33,27,0.05)]">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-xs font-bold tracking-[0.14em] text-black/35 uppercase">
                Your perspective
              </h2>
              <span className="text-xs text-black/35">Private draft</span>
            </div>
            {state.mode === "type" ? (
              <TextComposer state={state} />
            ) : (
              <AudioComposer state={state} />
            )}
          </div>
        </div>
      </div>
      <SubmitBar state={state} />

      <Sheet open={briefOpen} onOpenChange={setBriefOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[94svh] overflow-y-auto rounded-t-[32px] bg-[#fbfaf6]"
        >
          <SheetHeader className="sticky top-0 z-10 border-b border-black/8 bg-[#fbfaf6]/95 px-5 py-4 backdrop-blur-xl">
            <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-black/15" />
            <div className="flex items-center justify-between pr-9">
              <div>
                <SheetTitle className="text-lg">Response brief</SheetTitle>
                <SheetDescription>
                  Pin anything you want beside your response.
                </SheetDescription>
              </div>
              <Badge variant="secondary">3 sources</Badge>
            </div>
          </SheetHeader>
          <FullBrief state={state} />
        </SheetContent>
      </Sheet>
    </main>
  )
}

function PinnedSpeakingNotes({ state }: { state: PrototypeState }) {
  const points = request.talkingPoints.filter((point) =>
    state.pinned.includes(point.id),
  )
  if (!points.length) return null

  return (
    <section>
      <SectionHeading icon={Pin} eyebrow="Kept in view" title="Pinned speaking notes" />
      <div className="space-y-3">
        {points.map((point) => (
          <article
            key={point.id}
            className="rounded-[22px] border border-[#2e765e]/25 bg-[#eef5ef] p-4"
          >
            <div className="flex items-start gap-3">
              <Pin className="mt-1 size-4 shrink-0 fill-current text-[#2e765e]" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold leading-5 text-[#17211b]">
                  {point.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#17211b]/65">
                  {point.detail}
                </p>
              </div>
              <button
                type="button"
                onClick={() => state.togglePin(point.id)}
                className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#2e765e]/20 text-[#2e765e] hover:bg-white/70"
                aria-label={`Unpin ${point.title}`}
              >
                <PinOff className="size-3.5" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function BriefReferencePane({ state }: { state: PrototypeState }) {
  return (
    <section className="h-full overflow-y-auto bg-[#efece3]">
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-5 sm:px-7 lg:py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.18em] text-black/40 uppercase">
              Brief first
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
              Everything you need to answer.
            </h1>
          </div>
          <Badge className="bg-[#df5b3f] text-white">{request.urgency}</Badge>
        </div>
        <QuestionBlock />
        <PinnedSpeakingNotes state={state} />
        <section>
          <SectionHeading icon={Sparkles} eyebrow="Prepared for you" title="Talking points" />
          <TalkingPointList state={state} />
        </section>
        <section>
          <SectionHeading icon={Search} eyebrow="Evidence pack" title="Research & citations" />
          <ResearchList />
        </section>
        <section className="pb-8">
          <SectionHeading icon={CircleAlert} eyebrow="Before answering" title="Open questions" />
          <ul className="space-y-2 rounded-[22px] border border-black/8 bg-white p-4 text-sm leading-6 text-black/55">
            {request.missingResearch.map((item) => (
              <li key={item} className="flex gap-2.5">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#df5b3f]" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  )
}

function CompactInputSurface({
  state,
  openEditor,
}: {
  state: PrototypeState
  openEditor: () => void
}) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-black/8 px-4 py-2.5">
        <div>
          <p className="text-[10px] font-bold tracking-[0.14em] text-black/35 uppercase">
            Quick capture
          </p>
          <p className="text-sm font-semibold">Add a thought without leaving the brief</p>
        </div>
        <SaveStatus state={state.saveState} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr] gap-3 p-3 sm:grid-cols-[12rem_1fr]">
        <ModeSwitch state={state} />
        {state.mode === "type" ? (
          <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-black/8 bg-[#fbfaf6] px-3">
            <Keyboard className="size-4 shrink-0 text-black/35" />
            <Textarea
              aria-label="Quick Founder Input"
              value={state.draft}
              onChange={(event) => state.updateDraft(event.target.value)}
              className="max-h-20 min-h-11 flex-1 border-0 bg-transparent px-0 py-2 text-sm leading-5 focus-visible:ring-0"
            />
            <Button
              size="sm"
              className="shrink-0 rounded-xl bg-[#17211b]"
              onClick={openEditor}
            >
              Expand
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-black/8 bg-[#fbfaf6] px-3">
            <button
              type="button"
              onClick={() => state.setRecording(!state.recording)}
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full text-white",
                state.recording ? "bg-[#17211b]" : "bg-[#df5b3f]",
              )}
              aria-label={state.recording ? "Pause recording" : "Start recording"}
            >
              {state.recording ? <Pause className="size-4" /> : <Mic className="size-4" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-semibold tabular-nums">
                {formatTimer(state.recordingSeconds)}
              </p>
              <p className="truncate text-xs text-black/40">
                {state.recording ? "Recording locally" : "Ready to record"}
              </p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 rounded-xl" onClick={openEditor}>
              Expand
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

function ResizeHandle({ orientation }: { orientation: "horizontal" | "vertical" }) {
  return (
    <Separator
      className={cn(
        "group relative z-20 flex shrink-0 items-center justify-center bg-[#17211b]/12 outline-none transition hover:bg-[#2e765e]/35 focus-visible:bg-[#2e765e]/40",
        orientation === "horizontal" ? "w-3 cursor-col-resize" : "h-3 cursor-row-resize",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full border border-black/10 bg-white text-black/35 shadow-sm",
          orientation === "horizontal" ? "h-11 w-5" : "h-5 w-11",
        )}
      >
        {orientation === "horizontal" ? (
          <GripVertical className="size-3.5" />
        ) : (
          <GripHorizontal className="size-3.5" />
        )}
      </span>
    </Separator>
  )
}

function EditorContextDeck({ state }: { state: PrototypeState }) {
  const [visible, setVisible] = useState<string[]>(["question", "points"])
  const [pinned, setPinned] = useState<string[]>(["question"])

  const toggleVisible = (id: string) => {
    setVisible((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }
  const togglePinned = (id: string) => {
    setPinned((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
    setVisible((current) => (current.includes(id) ? current : [...current, id]))
  }

  const displayed = contextCards.filter(
    (card) => visible.includes(card.id) || pinned.includes(card.id),
  )

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#15231d] text-white">
      <div className="border-b border-white/10 px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold tracking-[0.16em] text-white/40 uppercase">
              Editor reference
            </p>
            <h2 className="mt-0.5 text-lg font-semibold tracking-tight">Context deck</h2>
          </div>
          <Badge className="bg-[#e6fe55] text-[#17211b]">
            {pinned.length} pinned
          </Badge>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {contextCards.map((card) => {
            const isVisible = visible.includes(card.id)
            const isPinned = pinned.includes(card.id)
            return (
              <div
                key={card.id}
                className={cn(
                  "flex shrink-0 items-center rounded-full border p-1 pl-3 transition",
                  isVisible || isPinned
                    ? "border-[#e6fe55]/70 bg-[#e6fe55]/10 text-white"
                    : "border-white/12 bg-white/5 text-white/45",
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleVisible(card.id)}
                  className="flex items-center gap-1.5 py-1 text-xs font-semibold"
                >
                  {(isVisible || isPinned) && <Check className="size-3" />}
                  {card.title}
                </button>
                <button
                  type="button"
                  onClick={() => togglePinned(card.id)}
                  className={cn(
                    "ml-1 flex size-7 items-center justify-center rounded-full",
                    isPinned ? "bg-[#e6fe55] text-[#17211b]" : "text-white/40 hover:bg-white/10",
                  )}
                  aria-label={isPinned ? `Unpin ${card.title}` : `Pin ${card.title}`}
                >
                  <Pin className={cn("size-3", isPinned && "fill-current")} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
        {displayed.length ? (
          displayed.map((card) => (
            <article
              key={card.id}
              className={cn(
                "rounded-[24px] bg-[#f4f0e4] p-4 text-[#17211b]",
                pinned.includes(card.id) && "ring-2 ring-[#e6fe55]",
              )}
            >
              <div className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-[#17211b] text-white">
                  <card.icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-bold tracking-[0.14em] text-black/40 uppercase">
                    {card.eyebrow}
                  </p>
                  <h3 className="text-sm font-semibold">{card.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => togglePinned(card.id)}
                  className="flex size-8 items-center justify-center rounded-full bg-black/5"
                >
                  <Pin className={cn("size-3.5", pinned.includes(card.id) && "fill-current")} />
                </button>
              </div>
              <ContextCardBody id={card.id} state={state} />
            </article>
          ))
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center rounded-[24px] border border-dashed border-white/15 p-6 text-center text-sm text-white/45">
            Toggle a context item above to keep it beside the editor.
          </div>
        )}
      </div>
    </section>
  )
}

function EditorInputPane({ state }: { state: PrototypeState }) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-black/8 px-4 py-3 sm:px-6">
        <div>
          <p className="text-[10px] font-bold tracking-[0.16em] text-black/35 uppercase">
            Founder input
          </p>
          <h2 className="text-lg font-semibold tracking-tight">Add what only you know.</h2>
        </div>
        <SaveStatus state={state.saveState} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <ModeSwitch state={state} />
        <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-[26px] border border-black/8 bg-[#fbfaf6] p-5">
          {state.mode === "type" ? <TextComposer state={state} /> : <AudioComposer state={state} />}
        </div>
      </div>
      <SubmitBar state={state} />
    </section>
  )
}

function VariantB({ state }: { state: PrototypeState }) {
  const [screen, setScreen] = useState<"brief" | "editor">("brief")
  const isMobile = useIsMobile()
  const orientation = isMobile ? "vertical" : "horizontal"

  return (
    <main className="flex h-svh min-h-svh flex-col overflow-hidden bg-[#efece3] text-[#17211b]">
      <RequestTopBar tone="dark" />
      <nav className="grid shrink-0 grid-cols-2 gap-1 border-b border-black/10 bg-[#efece3] p-2.5 sm:mx-auto sm:my-2 sm:w-full sm:max-w-md sm:rounded-2xl sm:border">
        <button
          type="button"
          onClick={() => setScreen("brief")}
          className={cn(
            "flex min-h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition",
            screen === "brief" ? "bg-[#17211b] text-white shadow-sm" : "text-black/45",
          )}
        >
          <BookOpen className="size-4" /> Brief
        </button>
        <button
          type="button"
          onClick={() => setScreen("editor")}
          className={cn(
            "flex min-h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition",
            screen === "editor" ? "bg-[#17211b] text-white shadow-sm" : "text-black/45",
          )}
        >
          <FileText className="size-4" /> Editor
        </button>
      </nav>

      <div className="mx-auto min-h-0 w-full max-w-7xl flex-1 overflow-hidden border-x border-black/8">
        {screen === "brief" ? (
          <PanelGroup
            key={`brief-${orientation}`}
            orientation={orientation}
            className="h-full"
            defaultLayout={{ "brief-reference": 70, "brief-input": 30 }}
          >
            <Panel id="brief-reference" minSize={45} defaultSize={70}>
              <BriefReferencePane state={state} />
            </Panel>
            <ResizeHandle orientation={orientation} />
            <Panel id="brief-input" minSize={18} maxSize={55} defaultSize={30}>
              <CompactInputSurface state={state} openEditor={() => setScreen("editor")} />
            </Panel>
          </PanelGroup>
        ) : (
          <PanelGroup
            key={`editor-${orientation}`}
            orientation={orientation}
            className="h-full"
            defaultLayout={{ "editor-reference": 42, "editor-input": 58 }}
          >
            <Panel id="editor-reference" minSize={25} maxSize={68} defaultSize={42}>
              <EditorContextDeck state={state} />
            </Panel>
            <ResizeHandle orientation={orientation} />
            <Panel id="editor-input" minSize={32} defaultSize={58}>
              <EditorInputPane state={state} />
            </Panel>
          </PanelGroup>
        )}
      </div>
    </main>
  )
}

const contextCards = [
  {
    id: "question",
    eyebrow: "The ask",
    title: "Original question",
    icon: BookOpen,
  },
  {
    id: "points",
    eyebrow: "Prepared for you",
    title: "3 talking points",
    icon: Sparkles,
  },
  {
    id: "research",
    eyebrow: "Evidence pack",
    title: "3 verified sources",
    icon: FileCheck2,
  },
  {
    id: "guardrail",
    eyebrow: "Keep in mind",
    title: "Response guardrail",
    icon: CircleAlert,
  },
]

function VariantC({ state }: { state: PrototypeState }) {
  const [activeCard, setActiveCard] = useState(0)
  const active = contextCards[activeCard]

  const go = (direction: -1 | 1) => {
    setActiveCard((current) =>
      (current + direction + contextCards.length) % contextCards.length,
    )
  }

  return (
    <main className="flex min-h-svh flex-col bg-[#15231d] text-white">
      <RequestTopBar tone="dark" />
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
        <section className="shrink-0 px-4 pt-5 sm:px-7">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Badge className="bg-[#e6fe55] text-[#17211b]">{request.urgency}</Badge>
                <span className="text-xs font-medium text-white/45">{request.responseLength}</span>
              </div>
              <h1 className="mt-3 max-w-xl text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
                Keep the brief in motion.
              </h1>
            </div>
            <div className="flex gap-2">
              <Button
                aria-label="Previous context card"
                size="icon-lg"
                variant="outline"
                className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                onClick={() => go(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                aria-label="Next context card"
                size="icon-lg"
                variant="outline"
                className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                onClick={() => go(1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-none">
            {contextCards.map((card, index) => (
              <button
                key={card.id}
                type="button"
                onClick={() => setActiveCard(index)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition",
                  index === activeCard
                    ? "border-[#e6fe55] bg-[#e6fe55] text-[#17211b]"
                    : "border-white/12 bg-white/5 text-white/55",
                )}
              >
                {index + 1}. {card.title}
              </button>
            ))}
          </div>

          <article className="relative min-h-56 overflow-hidden rounded-[30px] bg-[#f4f0e4] p-5 text-[#17211b] shadow-[0_24px_70px_rgba(0,0,0,0.28)] sm:p-6">
            <div className="absolute top-0 right-0 size-32 translate-x-8 -translate-y-8 rounded-full bg-[#e6fe55]/70 blur-2xl" />
            <div className="relative flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-[#17211b] text-white">
                <active.icon className="size-4" />
              </span>
              <div>
                <p className="text-[10px] font-bold tracking-[0.16em] text-black/40 uppercase">
                  {active.eyebrow}
                </p>
                <h2 className="font-semibold">{active.title}</h2>
              </div>
            </div>
            <ContextCardBody id={active.id} state={state} />
          </article>
        </section>

        <section className="mt-5 flex min-h-0 flex-1 flex-col rounded-t-[32px] bg-white text-[#17211b] shadow-[0_-20px_60px_rgba(0,0,0,0.18)]">
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pt-4 sm:px-7">
            <div className="mb-3 flex items-center justify-between gap-3">
              <ModeSwitch state={state} />
              <SaveStatus state={state.saveState} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col rounded-t-[24px] border-x border-t border-black/8 bg-[#fbfaf6] px-5 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-[0.14em] text-black/35 uppercase">
                  Your perspective
                </span>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs font-semibold text-[#2e765e]"
                  onClick={() => go(1)}
                >
                  Next context <ChevronRight className="size-3.5" />
                </button>
              </div>
              {state.mode === "type" ? (
                <TextComposer state={state} />
              ) : (
                <AudioComposer state={state} />
              )}
            </div>
          </div>
          <SubmitBar state={state} />
        </section>
      </div>
    </main>
  )
}

function ContextCardBody({ id, state }: { id: string; state: PrototypeState }) {
  if (id === "question") {
    return (
      <div className="relative mt-5">
        <p className="text-lg font-semibold leading-7 tracking-tight sm:text-xl">
          “{request.question}”
        </p>
        <p className="mt-4 text-xs font-medium text-black/45">
          {request.source} · {request.age}
        </p>
      </div>
    )
  }

  if (id === "points") {
    return (
      <div className="relative mt-5 grid gap-2 sm:grid-cols-3">
        {request.talkingPoints.map((point, index) => (
          <button
            key={point.id}
            type="button"
            onClick={() => state.togglePin(point.id)}
            className={cn(
              "flex items-start gap-2 rounded-2xl border p-3 text-left text-xs font-semibold leading-4",
              state.pinned.includes(point.id)
                ? "border-[#2e765e] bg-[#e8f0e9]"
                : "border-black/10 bg-white/70",
            )}
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#17211b] text-[10px] text-white">
              {index + 1}
            </span>
            {point.title}
          </button>
        ))}
      </div>
    )
  }

  if (id === "research") {
    return (
      <div className="relative mt-5 space-y-2">
        {request.research.map((source) => (
          <div key={source.label} className="flex items-center gap-3 rounded-2xl bg-white/75 p-3">
            <Check className="size-4 shrink-0 text-emerald-600" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{source.label}</span>
            <ExternalLink className="size-3.5 text-black/35" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="relative mt-5 rounded-2xl bg-[#17211b] p-4 text-sm leading-6 text-white/75">
      {request.guardrail}
    </div>
  )
}

function PrototypeSwitcher({
  variant,
  onChange,
  state,
}: {
  variant: VariantKey
  onChange: (variant: VariantKey) => void
  state: PrototypeState
}) {
  const current = variants.findIndex((item) => item.key === variant)
  const move = (direction: -1 | 1) => {
    const next = (current + direction + variants.length) % variants.length
    onChange(variants[next].key)
  }
  const label = variants[current]

  return (
    <aside className="prototype-switcher" aria-label="Prototype variant switcher">
      <Button
        aria-label="Previous prototype variant"
        size="icon-lg"
        variant="ghost"
        className="rounded-full text-white hover:bg-white/10 hover:text-white"
        onClick={() => move(-1)}
      >
        <ChevronLeft />
      </Button>
      <div className="min-w-0 flex-1 px-1 text-center">
        <p className="truncate text-xs font-semibold text-white">
          {label.key} — {label.name}
        </p>
        <p className="truncate text-[10px] text-white/45">
          {state.mode} · {state.draft.trim().split(/\s+/).length} words · {state.pinned.length} pinned
        </p>
      </div>
      <Button
        aria-label="Next prototype variant"
        size="icon-lg"
        variant="ghost"
        className="rounded-full text-white hover:bg-white/10 hover:text-white"
        onClick={() => move(1)}
      >
        <ChevronRight />
      </Button>
    </aside>
  )
}

export function App() {
  const initialVariant = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("variant")
    return variants.some((item) => item.key === value)
      ? (value as VariantKey)
      : "B"
  }, [])
  const [variant, setVariant] = useState<VariantKey>(initialVariant)
  const state = usePrototypeState()

  const changeVariant = (next: VariantKey) => {
    const params = new URLSearchParams(window.location.search)
    params.set("variant", next)
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`)
    setVariant(next)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target?.matches("input, textarea, select, [contenteditable='true']") ||
        !["ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        return
      }
      const current = variants.findIndex((item) => item.key === variant)
      const direction = event.key === "ArrowRight" ? 1 : -1
      const next = (current + direction + variants.length) % variants.length
      changeVariant(variants[next].key)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [variant])

  return (
    <div className="prototype-shell">
      {variant === "A" && <VariantA state={state} />}
      {variant === "B" && <VariantB state={state} />}
      {variant === "C" && <VariantC state={state} />}
      {(import.meta.env.DEV || import.meta.env.VITE_PROTOTYPE_BUILD === "true") && (
        <PrototypeSwitcher variant={variant} onChange={changeVariant} state={state} />
      )}
    </div>
  )
}

export default App
