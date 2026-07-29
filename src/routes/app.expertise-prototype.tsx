import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  FileSearch,
  Link2,
  ListChecks,
  Mic,
  Pause,
  Play,
  Search,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  FocusedProoflineBatchAnswers,
  FocusedProoflineQuestionAnswers,
  type FocusedProoflineAnswerQuestion,
} from "@/components/focused-proofline-answer-surfaces"
import { FocusedProoflineBrief } from "@/components/focused-proofline-brief"
import { FocusedProoflinePrototypeBatchComposer } from "@/components/focused-proofline-prototype-batch-composer"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type PrototypeVariant = "focused" | "atlas" | "call"
type PrototypeRole = "admin" | "founder"
type FounderAnswerMode = "one_by_one" | "batch"
type FounderScreen = "brief" | "answers"

type CoverageStatus = "covered" | "insufficient" | "not_applicable"

type CoverageEntry = {
  id: string
  label: string
  status: CoverageStatus
  sources: number
  detail: string
}

type Gap = {
  id: string
  label: string
  category: string
  currentCoverage: string
  inadequacy: string
  contribution: string
  confidence: "High" | "Medium"
  questionIds: string[]
}

type Question = {
  id: string
  prompt: string
  rationale: string
  proof: string
  gapIds: string[]
  required: boolean
}

type ConversationTurn = {
  id: string
  role: "researcher" | "expert" | "system"
  body: string
  gapId?: string
}

const variants: Array<{
  id: PrototypeVariant
  short: string
  name: string
}> = [
  { id: "focused", short: "A", name: "Focused Proofline" },
  { id: "atlas", short: "B", name: "Evidence Atlas" },
  { id: "call", short: "C", name: "Research Call" },
]

const coverageFixture: CoverageEntry[] = [
  {
    id: "ranking",
    label: "Ranking content",
    status: "covered",
    sources: 8,
    detail:
      "Top educational and commercial results across four query families.",
  },
  {
    id: "authority",
    label: "Primary authorities",
    status: "covered",
    sources: 4,
    detail: "FSRA guidance, licensing material, and lender documentation.",
  },
  {
    id: "local",
    label: "Ontario-specific",
    status: "insufficient",
    sources: 1,
    detail:
      "Only one source describes timing failures in Ontario transactions.",
  },
  {
    id: "practitioner",
    label: "Practitioner discussion",
    status: "covered",
    sources: 6,
    detail:
      "Broker discussions reveal recurring timing and documentation problems.",
  },
  {
    id: "fairlend",
    label: "FairLend library",
    status: "covered",
    sources: 5,
    detail: "No existing article explains the operational recovery process.",
  },
  {
    id: "recent",
    label: "Recent developments",
    status: "not_applicable",
    sources: 0,
    detail: "No material rule change affects the article's central question.",
  },
]

const gapFixture: Gap[] = [
  {
    id: "gap-1",
    label: "The official process ends where the real work begins",
    category: "Reality on the ground",
    currentCoverage:
      "Most guides explain bridge-loan eligibility, ratios, and standard timelines.",
    inadequacy:
      "They do not explain what a broker actually does when a bank closing and purchase closing stop lining up.",
    contribution:
      "Elie can describe the recovery sequence, who gets called first, and which options remain viable.",
    confidence: "High",
    questionIds: ["q1", "q2"],
  },
  {
    id: "gap-2",
    label: "Local constraints are mentioned but never operationalized",
    category: "Ontario-specific",
    currentCoverage:
      "Ontario sources repeat regulatory obligations and generic disclosure language.",
    inadequacy:
      "No indexed source turns those obligations into a practical decision tree for a time-sensitive deal.",
    contribution:
      "Elie can identify the Ontario-specific checks that alter advice in practice.",
    confidence: "Medium",
    questionIds: ["q3"],
  },
  {
    id: "gap-3",
    label: "Examples omit the cases practitioners learn from",
    category: "Missing case studies",
    currentCoverage:
      "Published examples are clean, successful, and stripped of difficult trade-offs.",
    inadequacy:
      "Readers cannot see which warning signs matter or how an experienced broker changes course.",
    contribution:
      "Elie can provide an anonymized case, the initial mistake, and the intervention that changed the outcome.",
    confidence: "High",
    questionIds: ["q4", "q5"],
  },
]

const questionsFixture: Question[] = [
  {
    id: "q1",
    prompt:
      "When a borrower cannot meet the bank’s bridge-loan timeline, what actually happens next?",
    rationale:
      "Published guides describe eligibility, but not how practitioners recover a deal when the dates stop lining up.",
    proof: "Process",
    gapIds: ["gap-1"],
    required: true,
  },
  {
    id: "q2",
    prompt:
      "What is the first call you make, and what information determines whether the deal can still be saved?",
    rationale:
      "The missing value is a usable sequence, not another list of bridge-loan requirements.",
    proof: "Rule of thumb",
    gapIds: ["gap-1"],
    required: true,
  },
  {
    id: "q3",
    prompt:
      "Which Ontario-specific obligations meaningfully change your advice in a time-sensitive bridge situation?",
    rationale:
      "Local sources state the rules but do not explain when those rules change the practical recommendation.",
    proof: "Local nuance",
    gapIds: ["gap-2"],
    required: true,
  },
  {
    id: "q4",
    prompt:
      "Can you walk through a real case where the obvious bridge solution was not the right answer?",
    rationale:
      "Existing examples are too clean to teach readers how an experienced broker spots a bad fit.",
    proof: "Case study",
    gapIds: ["gap-3"],
    required: true,
  },
  {
    id: "q5",
    prompt:
      "What warning sign in that case would a less experienced practitioner have missed?",
    rationale:
      "This turns the case into a transferable practitioner best practice.",
    proof: "Exception",
    gapIds: ["gap-3"],
    required: false,
  },
]

const founderAnswerQuestions: FocusedProoflineAnswerQuestion[] =
  questionsFixture.map((question) => ({
    id: question.id,
    question: question.prompt,
    motivation: question.rationale,
    proofLabel: question.proof,
    required: question.required,
  }))

const articleBriefFixture = {
  title: "How bridge financing actually works when the timeline breaks",
  topic: "Bridge financing when purchase and sale closing dates stop lining up",
  summary:
    "A practical Ontario guide showing what brokers do after the clean, textbook process stops matching the transaction.",
  audience:
    "Ontario homeowners navigating a time-sensitive purchase and the mortgage professionals advising them.",
  framing: ["Insider knowledge", "Educational", "How-to"],
  commercialPosture:
    "Demonstrate FairLend’s judgment and execution experience without turning the article into a direct sales pitch.",
  founderContribution:
    "Reality-on-the-ground process, Ontario-specific nuance, practitioner rules of thumb, and an anonymized case study.",
}

const initialTurns: ConversationTurn[] = [
  {
    id: "turn-1",
    role: "system",
    body: "Research package passed five of six coverage classes. Ontario-specific evidence needs a closer look.",
  },
  {
    id: "turn-2",
    role: "researcher",
    gapId: "gap-1",
    body: "Most guides stop after describing eligibility. What happens after a borrower misses the bank’s bridge timeline?",
  },
  {
    id: "turn-3",
    role: "expert",
    gapId: "gap-1",
    body: "The first move is not finding a new lender. It is rebuilding the closing timeline and finding which date is genuinely fixed.",
  },
  {
    id: "turn-4",
    role: "researcher",
    gapId: "gap-1",
    body: "Can you give me a real example where identifying the fixed date changed the solution?",
  },
]

function parseSearch(search: Record<string, unknown>): {
  variant: PrototypeVariant
  role: PrototypeRole
} {
  const variant = variants.some((item) => item.id === search.variant)
    ? (search.variant as PrototypeVariant)
    : "focused"
  const role = search.role === "founder" ? "founder" : "admin"
  return { variant, role }
}

export const Route = createFileRoute("/app/expertise-prototype")({
  validateSearch: parseSearch,
  component: ExpertisePrototypePage,
})

function ExpertisePrototypePage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [selectedCoverageId, setSelectedCoverageId] = useState("local")
  const [selectedGapId, setSelectedGapId] = useState("gap-1")
  const [selectedQuestionId, setSelectedQuestionId] = useState("q1")
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({
    q1: "",
    q2: "",
    q3: "",
    q4: "",
    q5: "",
  })
  const [skipped, setSkipped] = useState<string[]>([])
  const [turns, setTurns] = useState(initialTurns)
  const [callDraft, setCallDraft] = useState("")
  const [recording, setRecording] = useState(false)
  const [founderScreen, setFounderScreen] = useState<FounderScreen>("brief")
  const [answerMode, setAnswerMode] = useState<FounderAnswerMode>("one_by_one")
  const [batchDraft, setBatchDraft] = useState("")
  const [batchRecording, setBatchRecording] = useState(false)
  const [batchSubmitted, setBatchSubmitted] = useState(false)
  const [callPhase, setCallPhase] = useState<
    "live" | "paused" | "wrapping" | "complete"
  >("live")
  const [coverageResolved, setCoverageResolved] = useState(false)

  const setSearch = (
    next: Partial<{ variant: PrototypeVariant; role: PrototypeRole }>
  ) =>
    void navigate({
      search: {
        variant: next.variant ?? search.variant,
        role: next.role ?? search.role,
      },
      replace: true,
    })

  const cycleVariant = (direction: -1 | 1) => {
    const currentIndex = variants.findIndex(
      (variant) => variant.id === search.variant
    )
    const nextIndex =
      (currentIndex + direction + variants.length) % variants.length
    setSearch({ variant: variants[nextIndex].id })
  }

  const changeRole = (role: PrototypeRole) => {
    if (role === "founder") setFounderScreen("brief")
    setSearch({ role })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target?.matches("input, textarea, select, [contenteditable='true']")
      ) {
        return
      }
      if (event.key === "ArrowLeft") cycleVariant(-1)
      if (event.key === "ArrowRight") cycleVariant(1)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  const state = {
    variant: search.variant,
    role: search.role,
    selectedCoverageId,
    selectedGapId,
    selectedQuestionId,
    activeQuestionId: questionsFixture[activeQuestionIndex].id,
    answers,
    skipped,
    callPhase,
    recording,
    founderScreen,
    answerMode,
    batchDraft,
    batchRecording,
    batchSubmitted,
    turns,
    coverageResolved,
    readiness: coverageResolved ? "ready_for_expert" : "needs_review",
  }

  return (
    <main
      className="min-h-[calc(100svh-4.25rem)] bg-[var(--workspace-paper)] pb-28"
      id="main-content"
    >
      <PrototypeHeader
        variant={search.variant}
        role={search.role}
        onRoleChange={changeRole}
      />

      {search.role === "founder" ? (
        <FounderWorkflowNav
          answerMode={answerMode}
          screen={founderScreen}
          onAnswerModeChange={setAnswerMode}
          onScreenChange={setFounderScreen}
        />
      ) : null}

      {search.role === "founder" && founderScreen === "brief" ? (
        <FounderBriefScreen
          answerMode={answerMode}
          onStart={(mode) => {
            setAnswerMode(mode)
            setFounderScreen("answers")
          }}
        />
      ) : null}

      {search.role === "founder" &&
      founderScreen === "answers" &&
      answerMode === "batch" ? (
        <FocusedProoflineBatchAnswers
          draft={batchDraft}
          questions={founderAnswerQuestions}
          recording={batchRecording}
          submitted={batchSubmitted}
          variantLabel={
            variants.find((variant) => variant.id === search.variant)?.name ??
            variants[0].name
          }
          onDraftChange={(value) => {
            setBatchDraft(value)
            setBatchSubmitted(false)
          }}
          onRecordingChange={setBatchRecording}
          onSubmit={() => {
            setBatchRecording(false)
            setBatchSubmitted(true)
          }}
          renderComposer={(context) => (
            <FocusedProoflinePrototypeBatchComposer {...context} />
          )}
        />
      ) : null}

      {search.variant === "focused" ? (
        search.role === "admin" ? (
          <FocusedAdmin
            coverageResolved={coverageResolved}
            onResolveCoverage={() => setCoverageResolved(true)}
          />
        ) : founderScreen === "answers" && answerMode === "one_by_one" ? (
          <FocusedProoflineQuestionAnswers
            activeQuestionIndex={activeQuestionIndex}
            answers={answers}
            questions={founderAnswerQuestions}
            skipped={skipped}
            onAnswer={(id, answer) =>
              setAnswers((current) => ({ ...current, [id]: answer }))
            }
            onPrevious={() =>
              setActiveQuestionIndex((current) => Math.max(0, current - 1))
            }
            onNext={() =>
              setActiveQuestionIndex((current) =>
                Math.min(questionsFixture.length - 1, current + 1)
              )
            }
            onSkip={(id) => {
              setSkipped((current) =>
                current.includes(id) ? current : [...current, id]
              )
              setActiveQuestionIndex((current) =>
                Math.min(questionsFixture.length - 1, current + 1)
              )
            }}
            onJump={setActiveQuestionIndex}
          />
        ) : null
      ) : null}

      {search.variant === "atlas" ? (
        search.role === "admin" ? (
          <AtlasAdmin
            selectedCoverageId={selectedCoverageId}
            selectedGapId={selectedGapId}
            selectedQuestionId={selectedQuestionId}
            onCoverageSelect={setSelectedCoverageId}
            onGapSelect={setSelectedGapId}
            onQuestionSelect={setSelectedQuestionId}
          />
        ) : founderScreen === "answers" && answerMode === "one_by_one" ? (
          <AtlasFounder
            activeQuestionIndex={activeQuestionIndex}
            answerMode={answerMode}
            selectedQuestionId={selectedQuestionId}
            answers={answers}
            onActiveQuestionChange={setActiveQuestionIndex}
            onQuestionSelect={setSelectedQuestionId}
            onAnswer={(id, answer) =>
              setAnswers((current) => ({ ...current, [id]: answer }))
            }
          />
        ) : null
      ) : null}

      {search.variant === "call" ? (
        search.role === "admin" ? (
          <CallAdmin
            turns={turns}
            selectedGapId={selectedGapId}
            coverageResolved={coverageResolved}
            onGapSelect={setSelectedGapId}
            onResolveCoverage={() => {
              setCoverageResolved(true)
              setTurns((current) => [
                ...current,
                {
                  id: `turn-${current.length + 1}`,
                  role: "system",
                  body: "Ontario-specific coverage added. All readiness gates now pass.",
                },
              ])
            }}
          />
        ) : founderScreen === "answers" && answerMode === "one_by_one" ? (
          <CallFounder
            turns={turns}
            callDraft={callDraft}
            recording={recording}
            callPhase={callPhase}
            onDraftChange={setCallDraft}
            onRecordingChange={setRecording}
            onPhaseChange={setCallPhase}
            onSubmit={() => {
              const body = callDraft.trim()
              if (!body) return
              setTurns((current) => [
                ...current,
                {
                  id: `turn-${current.length + 1}`,
                  role: "expert",
                  gapId: "gap-1",
                  body,
                },
                {
                  id: `turn-${current.length + 2}`,
                  role: "researcher",
                  gapId: "gap-3",
                  body: body.toLowerCase().includes("client")
                    ? "What warning sign in that client case would a less experienced broker have missed?"
                    : "Can you ground that in one real client example?",
                },
              ])
              setCallDraft("")
            }}
          />
        ) : null
      ) : null}

      <PrototypeState state={state} />
      {import.meta.env.DEV || import.meta.env.MODE === "e2e" ? (
        <PrototypeSwitcher
          founderBriefOpen={
            search.role === "founder" && founderScreen === "brief"
          }
          founderBatchOpen={
            search.role === "founder" &&
            founderScreen === "answers" &&
            answerMode === "batch"
          }
          variant={search.variant}
          role={search.role}
          onPrevious={() => cycleVariant(-1)}
          onNext={() => cycleVariant(1)}
          onRoleChange={changeRole}
        />
      ) : null}
    </main>
  )
}

function PrototypeHeader({
  variant,
  role,
  onRoleChange,
}: {
  variant: PrototypeVariant
  role: PrototypeRole
  onRoleChange(role: PrototypeRole): void
}) {
  const current = variants.find((item) => item.id === variant) ?? variants[0]
  return (
    <header className="border-b border-border/70 bg-background/90 px-4 py-4 backdrop-blur md:px-8">
      <div className="mx-auto flex max-w-[96rem] flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Throwaway prototype</Badge>
            <span className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              {current.short} · {current.name}
            </span>
          </div>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">
            Expertise request experience
          </h1>
        </div>
        <Tabs
          value={role}
          onValueChange={(value) => onRoleChange(value as PrototypeRole)}
        >
          <TabsList aria-label="Prototype role">
            <TabsTrigger value="admin">
              <FileSearch /> Admin
            </TabsTrigger>
            <TabsTrigger value="founder">
              <UserRound /> Founder
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </header>
  )
}

function FounderWorkflowNav({
  screen,
  answerMode,
  onScreenChange,
  onAnswerModeChange,
}: {
  screen: FounderScreen
  answerMode: FounderAnswerMode
  onScreenChange(screen: FounderScreen): void
  onAnswerModeChange(mode: FounderAnswerMode): void
}) {
  return (
    <nav className="border-b border-border/70 bg-background px-4 py-3 md:px-8">
      <div className="mx-auto flex max-w-[96rem] flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-2xl bg-muted p-1">
          <Button
            aria-pressed={screen === "brief"}
            onClick={() => onScreenChange("brief")}
            size="sm"
            variant={screen === "brief" ? "default" : "ghost"}
          >
            <BookOpen /> Brief
          </Button>
          <Button
            aria-pressed={screen === "answers"}
            onClick={() => onScreenChange("answers")}
            size="sm"
            variant={screen === "answers" ? "default" : "ghost"}
          >
            <ListChecks /> Answer
          </Button>
        </div>
        {screen === "answers" ? (
          <Tabs
            value={answerMode}
            onValueChange={(value) =>
              onAnswerModeChange(value as FounderAnswerMode)
            }
          >
            <TabsList aria-label="Answering mode">
              <TabsTrigger value="batch">Answer all at once</TabsTrigger>
              <TabsTrigger value="one_by_one">Answer one at a time</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <span className="text-xs text-muted-foreground">
            Review the context, then choose how you want to answer.
          </span>
        )}
      </div>
    </nav>
  )
}

function FounderBriefScreen({
  answerMode,
  onStart,
}: {
  answerMode: FounderAnswerMode
  onStart(mode: FounderAnswerMode): void
}) {
  const questions = questionsFixture.map((question) => ({
    id: question.id,
    question: question.prompt,
    motivation: question.rationale,
    proofLabel: question.proof,
    required: question.required,
    gapLabel:
      gapFixture.find((item) => question.gapIds.includes(item.id))?.label ??
      gapFixture[0].label,
  }))

  return (
    <FocusedProoflineBrief
      titleAs="h2"
      request={{ humanId: "CR-0241", title: articleBriefFixture.title }}
      brief={{
        topic: articleBriefFixture.topic,
        summary: articleBriefFixture.summary,
        audience: articleBriefFixture.audience,
        framing: articleBriefFixture.framing,
        fairlendPosture: articleBriefFixture.commercialPosture,
        respondentContribution: articleBriefFixture.founderContribution,
      }}
      questions={questions}
      requestTypeLabel="Expertise interview"
      statusLabel="Ready for Elie"
      directedBy="Connor"
      actionFooter={
        <div className="fixed right-0 bottom-0 left-0 z-40 border-t border-border/80 bg-background/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-24px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div
            aria-label="Choose how to answer"
            className="mx-auto grid max-w-5xl grid-cols-2 overflow-hidden rounded-2xl border border-foreground bg-foreground shadow-xl"
            role="group"
          >
            <Button
              aria-pressed={answerMode === "batch"}
              className="min-h-16 justify-center rounded-none border-r border-background/20 px-3 text-sm sm:text-base"
              onClick={() => onStart("batch")}
              size="lg"
            >
              <ListChecks className="hidden sm:block" />
              Answer all at once
            </Button>
            <Button
              aria-pressed={answerMode === "one_by_one"}
              className="min-h-16 justify-center rounded-none bg-background px-3 text-sm text-foreground hover:bg-muted sm:text-base"
              onClick={() => onStart("one_by_one")}
              size="lg"
              variant="outline"
            >
              Answer one at a time <ArrowRight className="hidden sm:block" />
            </Button>
          </div>
        </div>
      }
    />
  )
}

function RequestHeading({
  state = "Needs review",
  compact = false,
}: {
  state?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-4",
        compact ? "mb-4" : "mb-7"
      )}
    >
      <div className="max-w-3xl">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="destructive">Critical</Badge>
          <Badge variant="outline">Expertise interview</Badge>
          <Badge variant={state === "Ready for Elie" ? "default" : "secondary"}>
            {state}
          </Badge>
        </div>
        <h2
          className={cn(
            "font-semibold tracking-[-0.035em] text-balance",
            compact ? "text-xl" : "text-2xl md:text-3xl"
          )}
        >
          How bridge financing actually works when the timeline breaks
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          A practical Ontario guide showing what brokers do after the clean,
          textbook process stops matching the transaction.
        </p>
      </div>
      <div className="text-right text-xs leading-5 text-muted-foreground">
        <strong className="block text-foreground">CR-0241</strong>
        Operator directed by Connor
      </div>
    </div>
  )
}

function FocusedAdmin({
  coverageResolved,
  onResolveCoverage,
}: {
  coverageResolved: boolean
  onResolveCoverage(): void
}) {
  return (
    <section className="mx-auto grid max-w-[96rem] gap-0 border-x border-b border-border/70 bg-background lg:grid-cols-[18rem_1fr]">
      <aside className="border-b border-border/70 bg-muted/20 p-4 lg:min-h-[72svh] lg:border-r lg:border-b-0">
        <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
          Research workline
        </p>
        <div className="mt-4 grid grid-cols-4 gap-1 text-center text-xs lg:grid-cols-1 lg:text-left">
          {[
            ["Needs review", "2"],
            ["Researching", "4"],
            ["Ready", "7"],
            ["Failed", "1"],
          ].map(([label, count], index) => (
            <button
              className={cn(
                "flex items-center justify-between rounded-xl px-3 py-2",
                index === 0 ? "bg-foreground text-background" : "hover:bg-muted"
              )}
              key={label}
              type="button"
            >
              <span>{label}</span>
              <span>{count}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 space-y-2">
          {[
            ["Bridge timelines", "2 issues", true],
            ["Mortgage renewals", "1 issue", false],
            ["Private lending", "Researching", false],
          ].map(([title, detail, active]) => (
            <button
              className={cn(
                "w-full rounded-xl border p-3 text-left",
                active
                  ? "border-foreground bg-background shadow-sm"
                  : "border-transparent hover:bg-muted/60"
              )}
              key={String(title)}
              type="button"
            >
              <strong className="block text-sm">{title}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                {detail}
              </span>
            </button>
          ))}
        </div>
        <Button className="mt-5 w-full" variant="outline">
          <Sparkles /> Add topic
        </Button>
      </aside>

      <article className="min-w-0 p-5 md:p-8 lg:p-10">
        <RequestHeading
          state={coverageResolved ? "Ready for Elie" : "Needs review"}
        />
        {!coverageResolved ? (
          <div className="mb-8 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="flex gap-3">
              <CircleAlert className="mt-0.5 size-5 shrink-0" />
              <div>
                <h3 className="font-semibold">Stopped by two quality gates</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  <li>Ontario-specific coverage is incomplete.</li>
                  <li>Gap 2 has only one supporting source.</li>
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-8 flex gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
            <CircleCheck className="mt-0.5 size-5 shrink-0" />
            <div>
              <h3 className="font-semibold">Research package is ready</h3>
              <p className="mt-1 text-sm">
                All evidence, coverage, and question-linkage gates pass.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-7">
          {gapFixture.map((gap, index) => (
            <section
              className="grid gap-4 border-t border-border/70 pt-6 md:grid-cols-[4rem_1fr]"
              key={gap.id}
            >
              <div className="font-mono text-2xl text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{gap.category}</Badge>
                  <Badge variant="outline">{gap.confidence} confidence</Badge>
                </div>
                <h3 className="mt-3 text-lg font-semibold">{gap.label}</h3>
                <dl className="mt-4 grid gap-4 text-sm leading-6 md:grid-cols-3">
                  <div>
                    <dt className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                      Existing coverage
                    </dt>
                    <dd className="mt-1">{gap.currentCoverage}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                      Why it falls short
                    </dt>
                    <dd className="mt-1">{gap.inadequacy}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                      Elie’s contribution
                    </dt>
                    <dd className="mt-1">{gap.contribution}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Link2 className="size-3.5" />
                  Sources {index * 2 + 1}, {index * 2 + 2}
                  <span>·</span>
                  Questions{" "}
                  {gap.questionIds
                    .map((id) => Number(id.replace("q", "")))
                    .join(", ")}
                </div>
              </div>
            </section>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-6">
          <div>
            <strong className="text-sm">
              Coverage {coverageResolved ? "6/6" : "5/6"} examined
            </strong>
            <p className="text-xs text-muted-foreground">
              Six source classes · 24 reviewed sources
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline">Return to agent with note</Button>
            {!coverageResolved ? (
              <Button onClick={onResolveCoverage}>
                <Check /> Simulate research repair
              </Button>
            ) : (
              <Button>
                <Send /> Send to Elie
              </Button>
            )}
          </div>
        </div>
      </article>
    </section>
  )
}

function CoverageBadge({ status }: { status: CoverageStatus }) {
  if (status === "covered") {
    return (
      <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
        Covered
      </Badge>
    )
  }
  if (status === "not_applicable") {
    return <Badge variant="outline">N/A</Badge>
  }
  return <Badge variant="destructive">Insufficient</Badge>
}

function AtlasAdmin({
  selectedCoverageId,
  selectedGapId,
  selectedQuestionId,
  onCoverageSelect,
  onGapSelect,
  onQuestionSelect,
}: {
  selectedCoverageId: string
  selectedGapId: string
  selectedQuestionId: string
  onCoverageSelect(id: string): void
  onGapSelect(id: string): void
  onQuestionSelect(id: string): void
}) {
  const relatedGaps = gapFixture.filter(
    (gap) => selectedCoverageId !== "local" || gap.id === "gap-2"
  )
  return (
    <section className="mx-auto max-w-[100rem] bg-background">
      <div className="border-b border-border/70 p-5 md:p-7">
        <RequestHeading compact />
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <Progress value={83}>
              <ProgressLabel>Readiness gates</ProgressLabel>
              <ProgressValue>{() => "10 / 12 passing"}</ProgressValue>
            </Progress>
          </div>
          <Button variant="outline">Return targeted items</Button>
        </div>
      </div>

      <Tabs className="p-4 xl:hidden" defaultValue="coverage">
        <TabsList className="w-full">
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="gaps">Gaps</TabsTrigger>
          <TabsTrigger value="questions">Interview</TabsTrigger>
        </TabsList>
        <TabsContent value="coverage">
          <CoveragePane
            selectedId={selectedCoverageId}
            onSelect={onCoverageSelect}
          />
        </TabsContent>
        <TabsContent value="gaps">
          <GapPane
            gaps={relatedGaps}
            selectedId={selectedGapId}
            onSelect={onGapSelect}
          />
        </TabsContent>
        <TabsContent value="questions">
          <QuestionPane
            selectedId={selectedQuestionId}
            onSelect={onQuestionSelect}
          />
        </TabsContent>
      </Tabs>

      <div className="hidden min-h-[65svh] grid-cols-[0.8fr_1.35fr_0.9fr] divide-x divide-border/70 xl:grid">
        <CoveragePane
          selectedId={selectedCoverageId}
          onSelect={onCoverageSelect}
        />
        <GapPane
          gaps={relatedGaps}
          selectedId={selectedGapId}
          onSelect={onGapSelect}
        />
        <QuestionPane
          selectedId={selectedQuestionId}
          onSelect={onQuestionSelect}
        />
      </div>
    </section>
  )
}

function PaneHeading({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string
  title: string
  detail: string
}) {
  return (
    <div className="border-b border-border/70 p-4">
      <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
        {eyebrow}
      </p>
      <h3 className="mt-1 text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  )
}

function CoveragePane({
  selectedId,
  onSelect,
}: {
  selectedId: string
  onSelect(id: string): void
}) {
  return (
    <div className="min-w-0 bg-muted/10">
      <PaneHeading
        detail="Every relevant source class must be examined or explicitly excluded."
        eyebrow="Layer 01"
        title="Coverage matrix"
      />
      <div className="space-y-2 p-3">
        {coverageFixture.map((entry) => (
          <button
            className={cn(
              "w-full rounded-2xl border p-3 text-left transition-colors",
              entry.id === selectedId
                ? "border-foreground bg-background shadow-sm"
                : "border-transparent hover:bg-muted/60"
            )}
            key={entry.id}
            onClick={() => onSelect(entry.id)}
            type="button"
          >
            <div className="flex items-start justify-between gap-2">
              <strong className="text-sm">{entry.label}</strong>
              <CoverageBadge status={entry.status} />
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {entry.detail}
            </p>
            <span className="mt-2 block text-xs font-medium">
              {entry.sources} sources
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function GapPane({
  gaps,
  selectedId,
  onSelect,
}: {
  gaps: Gap[]
  selectedId: string
  onSelect(id: string): void
}) {
  return (
    <div className="min-w-0">
      <PaneHeading
        detail="Selecting evidence, gaps, or questions reveals the relationships between them."
        eyebrow="Layer 02"
        title="Knowledge-gap map"
      />
      <div className="space-y-3 p-4">
        {gaps.map((gap) => (
          <button
            className={cn(
              "w-full rounded-2xl border p-4 text-left",
              gap.id === selectedId
                ? "border-foreground bg-muted/30"
                : "border-border/70 hover:border-foreground/40"
            )}
            key={gap.id}
            onClick={() => onSelect(gap.id)}
            type="button"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{gap.category}</Badge>
              <Badge variant="outline">{gap.confidence}</Badge>
            </div>
            <h4 className="mt-3 font-semibold">{gap.label}</h4>
            <dl className="mt-3 space-y-3 text-xs leading-5">
              <div>
                <dt className="font-bold text-muted-foreground uppercase">
                  Indexed knowledge
                </dt>
                <dd>{gap.currentCoverage}</dd>
              </div>
              <div>
                <dt className="font-bold text-muted-foreground uppercase">
                  Missing value
                </dt>
                <dd>{gap.inadequacy}</dd>
              </div>
              <div>
                <dt className="font-bold text-muted-foreground uppercase">
                  Expert opportunity
                </dt>
                <dd>{gap.contribution}</dd>
              </div>
            </dl>
          </button>
        ))}
      </div>
    </div>
  )
}

function QuestionPane({
  selectedId,
  onSelect,
}: {
  selectedId: string
  onSelect(id: string): void
}) {
  return (
    <div className="min-w-0 bg-muted/10">
      <PaneHeading
        detail="Each prompt must connect to a gap and request a concrete kind of proof."
        eyebrow="Layer 03"
        title="Interview builder"
      />
      <div className="space-y-2 p-3">
        {questionsFixture.map((question, index) => (
          <button
            className={cn(
              "w-full rounded-2xl border p-3 text-left",
              question.id === selectedId
                ? "border-foreground bg-background shadow-sm"
                : "border-transparent hover:bg-muted/60"
            )}
            key={question.id}
            onClick={() => onSelect(question.id)}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                Q{index + 1}
              </span>
              <Badge variant="outline">{question.proof}</Badge>
            </div>
            <p className="mt-2 text-sm leading-5">{question.prompt}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {question.required ? "Required" : "Optional"} ·{" "}
              {question.gapIds.join(", ")}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}

function AtlasFounder({
  activeQuestionIndex,
  answerMode,
  selectedQuestionId,
  answers,
  onActiveQuestionChange,
  onQuestionSelect,
  onAnswer,
}: {
  activeQuestionIndex: number
  answerMode: FounderAnswerMode
  selectedQuestionId: string
  answers: Record<string, string>
  onActiveQuestionChange(index: number): void
  onQuestionSelect(id: string): void
  onAnswer(id: string, answer: string): void
}) {
  const answeredCount = Object.values(answers).filter(Boolean).length
  const activeQuestion = questionsFixture[activeQuestionIndex]
  const selectedQuestion =
    questionsFixture.find((question) => question.id === selectedQuestionId) ??
    questionsFixture[0]
  const selectedGap =
    gapFixture.find((gap) => gap.id === selectedGapIdFor(selectedQuestion)) ??
    gapFixture[0]

  if (answerMode === "one_by_one") {
    const activeGap =
      gapFixture.find((gap) => gap.id === selectedGapIdFor(activeQuestion)) ??
      gapFixture[0]
    return (
      <section className="mx-auto max-w-[100rem] bg-background">
        <div className="border-b border-border/70 p-5 md:p-7">
          <RequestHeading compact state="Ready for Elie" />
          <Progress
            value={((activeQuestionIndex + 1) / questionsFixture.length) * 100}
          >
            <ProgressLabel>
              Question {activeQuestionIndex + 1} of {questionsFixture.length}
            </ProgressLabel>
            <ProgressValue>{() => `${answeredCount} answered`}</ProgressValue>
          </Progress>
        </div>
        <div className="grid min-h-[64svh] lg:grid-cols-[16rem_1fr_20rem]">
          <aside className="border-b border-border/70 bg-muted/15 p-4 lg:border-r lg:border-b-0">
            <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              Interview map
            </p>
            <div className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
              {questionsFixture.map((question, index) => (
                <button
                  className={cn(
                    "flex items-start gap-2 rounded-xl p-2 text-left text-xs leading-5",
                    activeQuestionIndex === index
                      ? "bg-foreground text-background"
                      : "hover:bg-muted"
                  )}
                  key={question.id}
                  onClick={() => {
                    onActiveQuestionChange(index)
                    onQuestionSelect(question.id)
                  }}
                  type="button"
                >
                  {answers[question.id] ? (
                    <CircleCheck className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <span className="grid size-4 shrink-0 place-items-center rounded-full border text-[9px]">
                      {index + 1}
                    </span>
                  )}
                  <span>{question.prompt}</span>
                </button>
              ))}
            </div>
          </aside>
          <div className="min-w-0 p-5 md:p-10">
            <div className="mx-auto max-w-2xl">
              <Badge variant="secondary">{activeQuestion.proof}</Badge>
              <h2 className="mt-4 text-2xl leading-tight font-semibold tracking-[-0.035em] md:text-4xl">
                {activeQuestion.prompt}
              </h2>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                {activeQuestion.rationale}
              </p>
              <Textarea
                aria-label={`Atlas answer to question ${activeQuestionIndex + 1}`}
                className="mt-6 min-h-44 bg-muted/35 p-4"
                onChange={(event) =>
                  onAnswer(activeQuestion.id, event.target.value)
                }
                placeholder="Add field notes…"
                value={answers[activeQuestion.id]}
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <Button variant="outline">
                  <Mic /> Record
                </Button>
                <div className="flex gap-2">
                  <Button
                    disabled={activeQuestionIndex === 0}
                    onClick={() =>
                      onActiveQuestionChange(activeQuestionIndex - 1)
                    }
                    variant="ghost"
                  >
                    Previous
                  </Button>
                  <Button
                    disabled={
                      activeQuestionIndex === questionsFixture.length - 1
                    }
                    onClick={() =>
                      onActiveQuestionChange(activeQuestionIndex + 1)
                    }
                  >
                    Save & next <ArrowRight />
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <aside className="border-t border-border/70 bg-muted/15 p-5 lg:border-t-0 lg:border-l">
            <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              Evidence shelf
            </p>
            <h3 className="mt-3 font-semibold">{activeGap.label}</h3>
            <div className="mt-4 space-y-4 text-sm leading-6">
              <div>
                <strong className="block text-xs tracking-wide text-muted-foreground uppercase">
                  What the web says
                </strong>
                <p className="mt-1">{activeGap.currentCoverage}</p>
              </div>
              <div>
                <strong className="block text-xs tracking-wide text-muted-foreground uppercase">
                  What is missing
                </strong>
                <p className="mt-1">{activeGap.inadequacy}</p>
              </div>
            </div>
          </aside>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-[100rem] bg-background">
      <div className="border-b border-border/70 p-5 md:p-7">
        <RequestHeading compact state="Ready for Elie" />
        <div className="flex items-center justify-between gap-3 text-sm">
          <strong>{answeredCount} of 5 answered</strong>
          <span className="text-muted-foreground">Saved</span>
        </div>
      </div>
      <div className="grid min-h-[66svh] lg:grid-cols-[16rem_1fr_20rem]">
        <aside className="border-b border-border/70 bg-muted/15 p-4 lg:border-r lg:border-b-0">
          <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Interview map
          </p>
          <div className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
            {questionsFixture.map((question, index) => (
              <button
                className={cn(
                  "flex items-start gap-2 rounded-xl p-2 text-left text-xs leading-5",
                  selectedQuestionId === question.id
                    ? "bg-foreground text-background"
                    : "hover:bg-muted"
                )}
                key={question.id}
                onClick={() => onQuestionSelect(question.id)}
                type="button"
              >
                {answers[question.id] ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <span className="grid size-4 shrink-0 place-items-center rounded-full border text-[9px]">
                    {index + 1}
                  </span>
                )}
                <span>{question.prompt}</span>
              </button>
            ))}
          </div>
          <Button className="mt-4 w-full" variant="outline">
            <Sparkles /> Unplaced note
          </Button>
        </aside>

        <div className="min-w-0 space-y-8 p-4 md:p-8">
          {gapFixture.map((gap) => (
            <section key={gap.id}>
              <div className="mb-3 flex items-center gap-2">
                <Badge variant="secondary">{gap.category}</Badge>
                <h3 className="font-semibold">{gap.label}</h3>
              </div>
              <div className="space-y-3">
                {questionsFixture
                  .filter((question) => question.gapIds.includes(gap.id))
                  .map((question) => (
                    <article
                      className={cn(
                        "rounded-2xl border p-4 transition-colors",
                        selectedQuestionId === question.id
                          ? "border-foreground shadow-sm"
                          : "border-border/70"
                      )}
                      key={question.id}
                      onFocusCapture={() => onQuestionSelect(question.id)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge variant="outline">{question.proof}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {question.required ? "Required" : "Optional"}
                        </span>
                      </div>
                      <h4 className="mt-3 text-lg font-semibold">
                        {question.prompt}
                      </h4>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {question.rationale}
                      </p>
                      <Textarea
                        className="mt-4 min-h-28 bg-muted/40 p-3"
                        onChange={(event) =>
                          onAnswer(question.id, event.target.value)
                        }
                        placeholder="Add field notes…"
                        value={answers[question.id]}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline">
                          <Mic /> Record
                        </Button>
                        <Button size="sm" variant="ghost">
                          Link this answer
                        </Button>
                      </div>
                    </article>
                  ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="border-t border-border/70 bg-muted/15 p-5 lg:border-t-0 lg:border-l">
          <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Evidence shelf
          </p>
          <h3 className="mt-3 font-semibold">{selectedQuestion.proof}</h3>
          <p className="mt-2 text-sm leading-6">{selectedQuestion.rationale}</p>
          <div className="mt-5 space-y-4 text-sm">
            <div>
              <strong className="block text-xs tracking-wide text-muted-foreground uppercase">
                What the web says
              </strong>
              <p className="mt-1 leading-6">{selectedGap.currentCoverage}</p>
            </div>
            <div>
              <strong className="block text-xs tracking-wide text-muted-foreground uppercase">
                What is missing
              </strong>
              <p className="mt-1 leading-6">{selectedGap.inadequacy}</p>
            </div>
            <Button className="px-0" variant="link">
              <Link2 /> Open 4 citations
            </Button>
          </div>
        </aside>
      </div>
    </section>
  )
}

function selectedGapIdFor(question: Question) {
  return question.gapIds[0]
}

function CallAdmin({
  turns,
  selectedGapId,
  coverageResolved,
  onGapSelect,
  onResolveCoverage,
}: {
  turns: ConversationTurn[]
  selectedGapId: string
  coverageResolved: boolean
  onGapSelect(id: string): void
  onResolveCoverage(): void
}) {
  const selectedGap =
    gapFixture.find((gap) => gap.id === selectedGapId) ?? gapFixture[0]
  return (
    <section className="mx-auto max-w-[96rem] bg-background">
      <div className="border-b border-border/70 p-5 md:p-7">
        <RequestHeading
          compact
          state={coverageResolved ? "Ready for Elie" : "Needs review"}
        />
      </div>
      <div className="grid min-h-[68svh] lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 border-b border-border/70 p-4 md:p-7 lg:border-r lg:border-b-0">
          <div className="mx-auto max-w-3xl">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
                  Interview rehearsal
                </p>
                <h3 className="mt-1 text-xl font-semibold">Research tape</h3>
              </div>
              <Button variant="outline">
                <Play /> Run rehearsal
              </Button>
            </div>
            <div className="space-y-4">
              {turns.map((turn) => (
                <button
                  className={cn(
                    "block max-w-[88%] rounded-2xl p-4 text-left text-sm leading-6",
                    turn.role === "researcher" &&
                      "mr-auto border border-border bg-muted/45",
                    turn.role === "expert" &&
                      "ml-auto bg-foreground text-background",
                    turn.role === "system" &&
                      "mx-auto max-w-full border border-dashed border-border bg-background text-center text-muted-foreground"
                  )}
                  key={turn.id}
                  onClick={() => turn.gapId && onGapSelect(turn.gapId)}
                  type="button"
                >
                  <span className="mb-2 flex items-center gap-2 text-xs font-semibold opacity-70">
                    {turn.role === "researcher" ? (
                      <Bot className="size-3.5" />
                    ) : turn.role === "expert" ? (
                      <UserRound className="size-3.5" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    {turn.role === "researcher"
                      ? "Researcher prompt"
                      : turn.role === "expert"
                        ? "Simulated expert answer"
                        : "Research update"}
                  </span>
                  {turn.body}
                  {turn.gapId ? (
                    <span className="mt-2 block text-xs opacity-65">
                      {
                        gapFixture.find((gap) => gap.id === turn.gapId)
                          ?.category
                      }
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
        <aside className="bg-muted/15 p-5">
          <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
            Source tray
          </p>
          <Badge className="mt-4" variant="secondary">
            {selectedGap.category}
          </Badge>
          <h3 className="mt-3 text-lg font-semibold">{selectedGap.label}</h3>
          <div className="mt-5 space-y-4 text-sm leading-6">
            <div>
              <strong className="text-xs tracking-wide text-muted-foreground uppercase">
                Existing coverage
              </strong>
              <p>{selectedGap.currentCoverage}</p>
            </div>
            <div>
              <strong className="text-xs tracking-wide text-muted-foreground uppercase">
                Completion criteria
              </strong>
              <ul className="mt-1 space-y-1">
                <li>Concrete practitioner sequence</li>
                <li>One real example</li>
                <li>Ontario-specific caveat</li>
              </ul>
            </div>
            <Button className="px-0" variant="link">
              <ExternalLink /> Inspect evidence
            </Button>
          </div>
          <div className="mt-6 border-t border-border/70 pt-5">
            <p className="text-sm font-semibold">
              {coverageResolved ? "12/12 gates pass" : "10/12 gates pass"}
            </p>
            <Button
              className="mt-3 w-full"
              disabled={coverageResolved}
              onClick={onResolveCoverage}
            >
              <Search />{" "}
              {coverageResolved ? "Research complete" : "Research Ontario gap"}
            </Button>
          </div>
        </aside>
      </div>
    </section>
  )
}

function CallFounder({
  turns,
  callDraft,
  recording,
  callPhase,
  onDraftChange,
  onRecordingChange,
  onPhaseChange,
  onSubmit,
}: {
  turns: ConversationTurn[]
  callDraft: string
  recording: boolean
  callPhase: "live" | "paused" | "wrapping" | "complete"
  onDraftChange(value: string): void
  onRecordingChange(value: boolean): void
  onPhaseChange(value: "live" | "paused" | "wrapping" | "complete"): void
  onSubmit(): void
}) {
  const founderTurns = turns.filter((turn) => turn.role !== "system")
  const isPaused = callPhase === "paused"
  const isWrapping = callPhase === "wrapping"

  return (
    <section className="mx-auto flex min-h-[76svh] max-w-5xl flex-col bg-background">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 p-4 md:px-7">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="destructive">Critical</Badge>
            <Badge variant="outline">Live research call</Badge>
          </div>
          <h2 className="mt-2 font-semibold">
            How bridge financing actually works
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Help us capture the parts published guides leave out.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => onPhaseChange(isPaused ? "live" : "paused")}
            variant="outline"
          >
            {isPaused ? <Play /> : <Pause />}
            {isPaused ? "Resume" : "Pause"}
          </Button>
          <Button onClick={() => onPhaseChange("wrapping")} variant="ghost">
            Wrap up
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto max-w-2xl space-y-5">
          {isPaused ? (
            <div className="rounded-2xl border border-dashed p-8 text-center">
              <Pause className="mx-auto size-6 text-muted-foreground" />
              <h3 className="mt-3 font-semibold">Call paused safely</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Your transcript is saved. Resume whenever you are ready.
              </p>
            </div>
          ) : null}
          {founderTurns.map((turn) => (
            <div
              className={cn(
                "max-w-[88%] rounded-3xl p-4 text-sm leading-6",
                turn.role === "researcher"
                  ? "mr-auto bg-muted"
                  : "ml-auto bg-foreground text-background"
              )}
              key={turn.id}
            >
              <span className="mb-2 flex items-center gap-2 text-xs font-semibold opacity-65">
                {turn.role === "researcher" ? (
                  <Bot className="size-3.5" />
                ) : (
                  <UserRound className="size-3.5" />
                )}
                {turn.role === "researcher" ? "Researcher" : "You"}
              </span>
              {turn.body}
              {turn.role === "researcher" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="xs" variant="outline">
                    Why are you asking?
                  </Button>
                  <Button size="xs" variant="ghost">
                    Skip
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {isWrapping ? (
            <div className="rounded-3xl border border-foreground bg-muted/30 p-5">
              <Badge variant="secondary">Call recap</Badge>
              <h3 className="mt-3 font-semibold">
                Here is what I heard from you
              </h3>
              <ul className="mt-3 space-y-2 text-sm leading-6">
                <li>
                  The first job is rebuilding the timeline, not immediately
                  replacing the lender.
                </li>
                <li>
                  The decisive question is which closing date is truly fixed.
                </li>
                <li>
                  The article still needs a concrete Ontario client example.
                </li>
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline">Correct something</Button>
                <Button onClick={() => onPhaseChange("complete")}>
                  <Check /> This captures it
                </Button>
              </div>
            </div>
          ) : null}
          {callPhase === "complete" ? (
            <div className="rounded-3xl bg-emerald-50 p-6 text-center text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100">
              <CircleCheck className="mx-auto size-6" />
              <h3 className="mt-2 font-semibold">Expertise submitted</h3>
              <p className="mt-1 text-sm">
                The confirmed recap is now the canonical founder input.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {callPhase === "live" ? (
        <div className="sticky bottom-0 border-t border-border/70 bg-background/95 p-4 pb-24 backdrop-blur md:p-5">
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <Button
              aria-label={recording ? "Stop recording" : "Start recording"}
              className={cn(recording && "animate-pulse")}
              onClick={() => onRecordingChange(!recording)}
              size="icon-lg"
              variant={recording ? "destructive" : "default"}
            >
              {recording ? <Pause /> : <Mic />}
            </Button>
            <Textarea
              className="min-h-11 flex-1"
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={
                recording
                  ? "Recording… tap the microphone to stop"
                  : "Answer naturally, or use the microphone…"
              }
              value={callDraft}
            />
            <Button
              aria-label="Send answer"
              disabled={!callDraft.trim()}
              onClick={onSubmit}
              size="icon-lg"
            >
              <Send />
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function PrototypeState({ state }: { state: object }) {
  return (
    <Collapsible className="mx-auto mt-6 max-w-[96rem] px-4">
      <CollapsibleTrigger
        render={<Button className="w-full justify-between" variant="outline" />}
      >
        <span className="flex items-center gap-2">
          <ListChecks /> Prototype state
        </span>
        <ChevronRight />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 max-h-80 overflow-auto rounded-2xl bg-foreground p-4 text-xs leading-5 text-background">
          {JSON.stringify(state, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

function PrototypeSwitcher({
  founderBatchOpen,
  founderBriefOpen,
  variant,
  role,
  onPrevious,
  onNext,
  onRoleChange,
}: {
  founderBatchOpen: boolean
  founderBriefOpen: boolean
  variant: PrototypeVariant
  role: PrototypeRole
  onPrevious(): void
  onNext(): void
  onRoleChange(role: PrototypeRole): void
}) {
  const current = variants.find((item) => item.id === variant) ?? variants[0]
  return (
    <div
      className={cn(
        "fixed right-3 left-3 z-50 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-2xl border border-white/15 bg-neutral-950 p-1.5 text-white shadow-2xl",
        founderBatchOpen
          ? "bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+12rem)] md:bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+6.75rem)]"
          : founderBriefOpen
            ? "bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5.75rem)]"
            : "bottom-[max(0.75rem,env(safe-area-inset-bottom))]"
      )}
    >
      <Button
        aria-label="Previous prototype variant"
        className="text-white hover:bg-white/15 hover:text-white"
        onClick={onPrevious}
        size="icon"
        variant="ghost"
      >
        <ArrowLeft />
      </Button>
      <div className="min-w-0 px-2 text-center">
        <strong className="block truncate text-xs">
          {current.short} — {current.name}
        </strong>
        <button
          className="text-[11px] text-white/65 hover:text-white"
          onClick={() => onRoleChange(role === "admin" ? "founder" : "admin")}
          type="button"
        >
          Viewing {role} · switch role
        </button>
      </div>
      <Button
        aria-label="Next prototype variant"
        className="text-white hover:bg-white/15 hover:text-white"
        onClick={onNext}
        size="icon"
        variant="ghost"
      >
        <ArrowRight />
      </Button>
    </div>
  )
}
