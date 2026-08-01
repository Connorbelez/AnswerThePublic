import { useRef, useState } from "react"
import { LoaderCircle, Minus, Plus } from "lucide-react"

import type { CreateManualRequestInput } from "@/application/content-requests"
import type {
  CreateExpertInterviewInput,
  ExpertInterviewFraming,
  ExpertInterviewGap,
} from "@/application/expert-interviews"
import { Button } from "@/components/ui/button"
import { ButtonLink } from "@/components/ui/button-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"

type RequestKind = "standard" | "expert-interview"
type GapKind = ExpertInterviewGap["kind"]

type GapDraft = {
  key: number
  kind: GapKind
  citationKeys: Array<number>
}

type QuestionDraft = {
  key: number
  gapKey: number
}

type StandardCreateResult = { humanId: string }
type ExpertCreateResult = { request: { humanId: string } }

type ContentRequestCreateFormProps = {
  hydrated: boolean
  onCreateStandard: (
    input: CreateManualRequestInput
  ) => Promise<StandardCreateResult>
  onCreateExpertInterview: (
    input: CreateExpertInterviewInput
  ) => Promise<ExpertCreateResult>
  onCreated: (humanId: string) => Promise<void> | void
}

const gapKinds: Array<{ value: GapKind; label: string }> = [
  { value: "confusing_coverage", label: "Confusing coverage" },
  { value: "local_specific", label: "Local-specific knowledge" },
  { value: "reality_on_the_ground", label: "Reality on the ground" },
  {
    value: "practitioner_best_practice",
    label: "Practitioner best practice",
  },
  { value: "fragmented_how_to", label: "Fragmented how-to" },
  { value: "missing_evidence", label: "Missing evidence" },
  { value: "other", label: "Other" },
]

const framingOptions: Array<{
  value: ExpertInterviewFraming
  label: string
}> = [
  { value: "educational", label: "Educational" },
  { value: "how_to", label: "How-to" },
  { value: "insider_knowledge", label: "Insider knowledge" },
  { value: "fairlend_sales", label: "FairLend sales" },
]
const maxCitationsPerGap = 20

function requiredValue(form: FormData, name: string, label: string) {
  const value = String(form.get(name) ?? "").trim()
  if (!value) {
    throw new Error(`${label} is required.`)
  }
  return value
}

function optionalValue(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").trim()
  return value || undefined
}

function parseStandardInput(
  form: FormData,
  correlationId: string
): CreateManualRequestInput {
  const source = {
    question: optionalValue(form, "question"),
    body: optionalValue(form, "body"),
    url: optionalValue(form, "url"),
  }
  const filteredSource = Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] =>
      Boolean(entry[1])
    )
  )
  return {
    title: requiredValue(form, "title", "Title"),
    source: Object.keys(filteredSource).length > 0 ? filteredSource : undefined,
    correlationId,
  }
}

function parseExpertInput(
  form: FormData,
  gaps: Array<GapDraft>,
  questions: Array<QuestionDraft>,
  correlationId: string
): CreateExpertInterviewInput {
  const gapIds = new Map(
    gaps.map((gap, index) => [gap.key, `gap-${index + 1}`])
  )
  const parsedGaps = gaps.map((gap, index) => {
    const prefix = `gap-${gap.key}`
    const citations = gap.citationKeys.map((citationKey, citationIndex) => {
      const citationPrefix = `${prefix}-citation-${citationKey}`
      return {
        label: requiredValue(
          form,
          `${citationPrefix}-label`,
          `Knowledge gap ${index + 1} citation ${citationIndex + 1} label`
        ),
        url: requiredValue(
          form,
          `${citationPrefix}-url`,
          `Knowledge gap ${index + 1} citation ${citationIndex + 1} URL`
        ),
        supports: requiredValue(
          form,
          `${citationPrefix}-supports`,
          `Knowledge gap ${index + 1} citation ${citationIndex + 1} support`
        ),
      }
    })
    return {
      id: gapIds.get(gap.key)!,
      kind: gap.kind,
      title: requiredValue(
        form,
        `${prefix}-title`,
        `Knowledge gap ${index + 1} title`
      ),
      existingCoverage: requiredValue(
        form,
        `${prefix}-coverage`,
        `Knowledge gap ${index + 1} existing coverage`
      ),
      whyItFallsShort: requiredValue(
        form,
        `${prefix}-shortfall`,
        `Knowledge gap ${index + 1} shortfall`
      ),
      expertOpportunity: requiredValue(
        form,
        `${prefix}-opportunity`,
        `Knowledge gap ${index + 1} expert opportunity`
      ),
      citations,
    }
  })
  const parsedQuestions = questions.map((question, index) => ({
    id: `question-${index + 1}`,
    question: requiredValue(
      form,
      `question-${question.key}-text`,
      `Interview question ${index + 1}`
    ),
    motivation: requiredValue(
      form,
      `question-${question.key}-motivation`,
      `Interview question ${index + 1} motivation`
    ),
    gapIds: [gapIds.get(question.gapKey) ?? parsedGaps[0].id],
  }))
  const aliases =
    optionalValue(form, "aliases")
      ?.split(",")
      .map((alias) => alias.trim())
      .filter(Boolean) ?? []
  const source = {
    question: optionalValue(form, "source-question"),
    body: optionalValue(form, "source-body"),
    url: optionalValue(form, "source-url"),
  }
  const filteredSource = Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] =>
      Boolean(entry[1])
    )
  )

  return {
    title: requiredValue(form, "expert-title", "Title"),
    aliases: aliases.length > 0 ? aliases : undefined,
    brief: {
      topic: requiredValue(form, "topic", "Topic"),
      summary: requiredValue(form, "summary", "Article summary"),
      audience: requiredValue(form, "audience", "Audience"),
      framing: requiredValue(
        form,
        "framing",
        "Framing"
      ) as ExpertInterviewFraming,
      fairlendPosture: requiredValue(
        form,
        "fairlend-posture",
        "FairLend posture"
      ),
      founderContribution: requiredValue(
        form,
        "founder-contribution",
        "Founder contribution"
      ),
    },
    gaps: parsedGaps,
    questions: parsedQuestions,
    operatorInstructions: optionalValue(form, "operator-instructions"),
    source: Object.keys(filteredSource).length > 0 ? filteredSource : undefined,
    correlationId,
  }
}

export function ContentRequestCreateForm({
  hydrated,
  onCreateStandard,
  onCreateExpertInterview,
  onCreated,
}: ContentRequestCreateFormProps) {
  const [requestKind, setRequestKind] = useState<RequestKind>("standard")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [gaps, setGaps] = useState<Array<GapDraft>>([
    { key: 1, kind: "confusing_coverage", citationKeys: [1] },
  ])
  const [questions, setQuestions] = useState<Array<QuestionDraft>>([
    { key: 1, gapKey: 1 },
  ])
  const nextGapKey = useRef(2)
  const nextQuestionKey = useRef(2)
  const nextCitationKey = useRef(2)
  const submissionAttempt = useRef<{
    key: string
    correlationId: string
  } | null>(null)

  function addGap() {
    setGaps((current) => [
      ...current,
      {
        key: nextGapKey.current++,
        kind: "confusing_coverage",
        citationKeys: [nextCitationKey.current++],
      },
    ])
  }

  function removeGap(key: number) {
    const remaining = gaps.filter((gap) => gap.key !== key)
    if (remaining.length === 0) return
    setGaps(remaining)
    setQuestions((current) =>
      current.map((question) =>
        question.gapKey === key
          ? { ...question, gapKey: remaining[0].key }
          : question
      )
    )
  }

  return (
    <Card className="request-form-card platform-panel" tone="elevated">
      <CardHeader>
        <CardTitle as="h1">Create a content request</CardTitle>
        <p>
          Create a direct request or package the research gaps and questions
          needed for an expert interview. Both enter the Critical queue.
        </p>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setSubmitting(true)
            setError(null)
            const form = new FormData(event.currentTarget)
            const attemptKey = JSON.stringify({
              requestKind,
              form: Array.from(form.entries()),
              gaps,
              questions,
            })
            const attempt =
              submissionAttempt.current?.key === attemptKey
                ? submissionAttempt.current
                : {
                    key: attemptKey,
                    correlationId: crypto.randomUUID(),
                  }
            submissionAttempt.current = attempt
            try {
              const humanId =
                requestKind === "standard"
                  ? (
                      await onCreateStandard(
                        parseStandardInput(form, attempt.correlationId)
                      )
                    ).humanId
                  : (
                      await onCreateExpertInterview(
                        parseExpertInput(
                          form,
                          gaps,
                          questions,
                          attempt.correlationId
                        )
                      )
                    ).request.humanId
              await onCreated(humanId)
              submissionAttempt.current = null
            } catch (submissionError) {
              setError(
                submissionError instanceof Error
                  ? submissionError.message
                  : "The request could not be created."
              )
              setSubmitting(false)
            }
          }}
        >
          <FieldGroup>
            <FieldSet>
              <FieldLegend>Request type</FieldLegend>
              <RadioGroup
                aria-label="Request type"
                className="grid gap-3 md:grid-cols-2"
                disabled={!hydrated || submitting}
                value={requestKind}
                onValueChange={(value) => {
                  setRequestKind(value as RequestKind)
                  setError(null)
                }}
              >
                <Label className="flex min-h-16 cursor-pointer items-start gap-3 rounded-2xl border border-border/70 p-4 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
                  <RadioGroupItem
                    aria-label="Standard request"
                    value="standard"
                  />
                  <span className="grid gap-1">
                    <strong>Standard request</strong>
                    <span className="text-sm font-normal text-muted-foreground">
                      Capture a direct question, source, or response request.
                    </span>
                  </span>
                </Label>
                <Label className="flex min-h-16 cursor-pointer items-start gap-3 rounded-2xl border border-border/70 p-4 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
                  <RadioGroupItem
                    aria-label="Expert interview"
                    value="expert-interview"
                  />
                  <span className="grid gap-1">
                    <strong>Expert interview</strong>
                    <span className="text-sm font-normal text-muted-foreground">
                      Build a research-backed brief, knowledge gaps, and
                      interview questions.
                    </span>
                  </span>
                </Label>
              </RadioGroup>
            </FieldSet>

            {requestKind === "standard" ? (
              <StandardRequestFields />
            ) : (
              <>
                <ExpertBriefFields />
                <FieldSet>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <FieldLegend>Knowledge gaps</FieldLegend>
                      <FieldDescription>
                        Define what current coverage misses and where an expert
                        can add unique value.
                      </FieldDescription>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm-touch"
                      onClick={addGap}
                    >
                      <Plus />
                      Add gap
                    </Button>
                  </div>
                  <div className="grid gap-4">
                    {gaps.map((gap, index) => (
                      <GapFields
                        key={gap.key}
                        gap={gap}
                        index={index}
                        removable={gaps.length > 1}
                        onKindChange={(kind) =>
                          setGaps((current) =>
                            current.map((candidate) =>
                              candidate.key === gap.key
                                ? { ...candidate, kind }
                                : candidate
                            )
                          )
                        }
                        onAddCitation={() =>
                          setGaps((current) =>
                            current.map((candidate) =>
                              candidate.key === gap.key
                                ? {
                                    ...candidate,
                                    citationKeys:
                                      candidate.citationKeys.length >=
                                      maxCitationsPerGap
                                        ? candidate.citationKeys
                                        : [
                                            ...candidate.citationKeys,
                                            nextCitationKey.current++,
                                          ],
                                  }
                                : candidate
                            )
                          )
                        }
                        onRemoveCitation={(citationKey) =>
                          setGaps((current) =>
                            current.map((candidate) =>
                              candidate.key === gap.key
                                ? {
                                    ...candidate,
                                    citationKeys: candidate.citationKeys.filter(
                                      (key) => key !== citationKey
                                    ),
                                  }
                                : candidate
                            )
                          )
                        }
                        onRemove={() => removeGap(gap.key)}
                      />
                    ))}
                  </div>
                </FieldSet>
                <FieldSet>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <FieldLegend>Interview questions</FieldLegend>
                      <FieldDescription>
                        Connect every question to the knowledge gap it should
                        resolve.
                      </FieldDescription>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm-touch"
                      onClick={() =>
                        setQuestions((current) => [
                          ...current,
                          {
                            key: nextQuestionKey.current++,
                            gapKey: gaps[0].key,
                          },
                        ])
                      }
                    >
                      <Plus />
                      Add question
                    </Button>
                  </div>
                  <div className="grid gap-4">
                    {questions.map((question, index) => (
                      <QuestionFields
                        key={question.key}
                        question={question}
                        index={index}
                        gaps={gaps}
                        removable={questions.length > 1}
                        onGapChange={(gapKey) =>
                          setQuestions((current) =>
                            current.map((candidate) =>
                              candidate.key === question.key
                                ? { ...candidate, gapKey }
                                : candidate
                            )
                          )
                        }
                        onRemove={() =>
                          setQuestions((current) =>
                            current.filter(
                              (candidate) => candidate.key !== question.key
                            )
                          )
                        }
                      />
                    ))}
                  </div>
                </FieldSet>
                <ExpertSourceFields />
              </>
            )}
          </FieldGroup>
          {error ? <FieldError className="mt-6">{error}</FieldError> : null}
          <div className="form-actions">
            <ButtonLink variant="ghost" to="/app">
              Cancel
            </ButtonLink>
            <Button type="submit" disabled={submitting || !hydrated}>
              {submitting ? <LoaderCircle className="animate-spin" /> : null}
              {requestKind === "standard"
                ? "Create Critical request"
                : "Create expert interview"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function StandardRequestFields() {
  return (
    <FieldSet>
      <FieldLegend>Request details</FieldLegend>
      <Field>
        <FieldLabel htmlFor="title">Title</FieldLabel>
        <Input
          id="title"
          name="title"
          required
          autoFocus
          placeholder="What does Elie need to respond to?"
        />
        <FieldDescription>The only required field.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="question">Original question</FieldLabel>
        <Textarea
          id="question"
          name="question"
          placeholder="Paste the question exactly as it appeared."
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="body">Original source material</FieldLabel>
        <Textarea
          id="body"
          name="body"
          placeholder="Optional post body, request text, or source notes."
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="url">Source URL</FieldLabel>
        <Input
          id="url"
          name="url"
          type="url"
          inputMode="url"
          placeholder="https://"
        />
      </Field>
    </FieldSet>
  )
}

function ExpertBriefFields() {
  return (
    <FieldSet>
      <FieldLegend>Interview brief</FieldLegend>
      <Field>
        <FieldLabel htmlFor="expert-title">Request title</FieldLabel>
        <Input
          id="expert-title"
          name="expert-title"
          required
          autoFocus
          placeholder="Interview a broker about construction financing"
        />
      </Field>
      <div className="grid gap-6 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="topic">Topic</FieldLabel>
          <Input
            id="topic"
            name="topic"
            required
            placeholder="Garden suite construction financing"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="audience">Audience</FieldLabel>
          <Input
            id="audience"
            name="audience"
            required
            placeholder="Toronto homeowners planning a build"
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="summary">Article summary</FieldLabel>
        <Textarea
          id="summary"
          name="summary"
          required
          placeholder="What the final content should help the audience understand."
        />
      </Field>
      <div className="grid gap-6 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="framing">Framing</FieldLabel>
          <NativeSelect className="w-full" id="framing" name="framing" required>
            {framingOptions.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="aliases">Aliases</FieldLabel>
          <Input
            id="aliases"
            name="aliases"
            placeholder="laneway suite, backyard suite"
          />
          <FieldDescription>Optional, comma-separated.</FieldDescription>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="fairlend-posture">FairLend posture</FieldLabel>
        <Textarea
          id="fairlend-posture"
          name="fairlend-posture"
          required
          placeholder="How FairLend should show up in the final content."
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="founder-contribution">
          Founder contribution
        </FieldLabel>
        <Textarea
          id="founder-contribution"
          name="founder-contribution"
          required
          placeholder="What Elie's firsthand perspective should contribute."
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="operator-instructions">
          Operator instructions
        </FieldLabel>
        <Textarea
          id="operator-instructions"
          name="operator-instructions"
          placeholder="Optional handling, tone, or interview instructions."
        />
      </Field>
    </FieldSet>
  )
}

function GapFields({
  gap,
  index,
  removable,
  onKindChange,
  onAddCitation,
  onRemoveCitation,
  onRemove,
}: {
  gap: GapDraft
  index: number
  removable: boolean
  onKindChange: (kind: GapKind) => void
  onAddCitation: () => void
  onRemoveCitation: (citationKey: number) => void
  onRemove: () => void
}) {
  const prefix = `gap-${gap.key}`
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 md:p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h3 className="font-medium">Knowledge gap {index + 1}</h3>
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm-touch"
            onClick={onRemove}
          >
            <Minus />
            Remove
          </Button>
        ) : null}
      </div>
      <FieldGroup>
        <div className="grid gap-6 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${prefix}-kind`}>Gap type</FieldLabel>
            <NativeSelect
              className="w-full"
              id={`${prefix}-kind`}
              value={gap.kind}
              onChange={(event) =>
                onKindChange(event.currentTarget.value as GapKind)
              }
            >
              {gapKinds.map((kind) => (
                <NativeSelectOption key={kind.value} value={kind.value}>
                  {kind.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${prefix}-title`}>Gap title</FieldLabel>
            <Input id={`${prefix}-title`} name={`${prefix}-title`} required />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`${prefix}-coverage`}>
            Existing coverage
          </FieldLabel>
          <Textarea
            id={`${prefix}-coverage`}
            name={`${prefix}-coverage`}
            required
            placeholder="What is already published or commonly said?"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-shortfall`}>
            Why it falls short
          </FieldLabel>
          <Textarea
            id={`${prefix}-shortfall`}
            name={`${prefix}-shortfall`}
            required
            placeholder="What remains unclear, unsupported, or too generic?"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-opportunity`}>
            Expert opportunity
          </FieldLabel>
          <Textarea
            id={`${prefix}-opportunity`}
            name={`${prefix}-opportunity`}
            required
            placeholder="What can a practitioner uniquely clarify?"
          />
        </Field>
        <FieldSet className="gap-4 rounded-xl border border-border/50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <FieldLegend variant="label">Supporting citations</FieldLegend>
              <FieldDescription>
                At least one complete source is required for every knowledge
                gap.
              </FieldDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm-touch"
              disabled={gap.citationKeys.length >= maxCitationsPerGap}
              onClick={onAddCitation}
            >
              <Plus />
              Add citation
            </Button>
          </div>
          {gap.citationKeys.map((citationKey, citationIndex) => {
            const citationPrefix = `${prefix}-citation-${citationKey}`
            return (
              <div
                key={citationKey}
                className="grid gap-4 rounded-xl border border-border/50 p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <strong className="text-sm">
                    Citation {citationIndex + 1}
                  </strong>
                  {gap.citationKeys.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm-touch"
                      onClick={() => onRemoveCitation(citationKey)}
                    >
                      <Minus />
                      Remove
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={`${citationPrefix}-label`}>
                      Source label
                    </FieldLabel>
                    <Input
                      id={`${citationPrefix}-label`}
                      name={`${citationPrefix}-label`}
                      required
                      placeholder="CMHC guide"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${citationPrefix}-url`}>
                      Source URL
                    </FieldLabel>
                    <Input
                      id={`${citationPrefix}-url`}
                      name={`${citationPrefix}-url`}
                      required
                      type="url"
                      inputMode="url"
                      placeholder="https://"
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor={`${citationPrefix}-supports`}>
                    What it supports
                  </FieldLabel>
                  <Input
                    id={`${citationPrefix}-supports`}
                    name={`${citationPrefix}-supports`}
                    required
                    placeholder="The claim or context supported by this source."
                  />
                </Field>
              </div>
            )
          })}
        </FieldSet>
      </FieldGroup>
    </div>
  )
}

function QuestionFields({
  question,
  index,
  gaps,
  removable,
  onGapChange,
  onRemove,
}: {
  question: QuestionDraft
  index: number
  gaps: Array<GapDraft>
  removable: boolean
  onGapChange: (gapKey: number) => void
  onRemove: () => void
}) {
  const prefix = `question-${question.key}`
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 md:p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h3 className="font-medium">Interview question {index + 1}</h3>
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm-touch"
            onClick={onRemove}
          >
            <Minus />
            Remove
          </Button>
        ) : null}
      </div>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${prefix}-text`}>Question</FieldLabel>
          <Textarea id={`${prefix}-text`} name={`${prefix}-text`} required />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-motivation`}>
            Why ask this?
          </FieldLabel>
          <Textarea
            id={`${prefix}-motivation`}
            name={`${prefix}-motivation`}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-gap`}>Knowledge gap</FieldLabel>
          <NativeSelect
            className="w-full"
            id={`${prefix}-gap`}
            value={String(question.gapKey)}
            onChange={(event) => onGapChange(Number(event.currentTarget.value))}
          >
            {gaps.map((gap, gapIndex) => (
              <NativeSelectOption key={gap.key} value={String(gap.key)}>
                Knowledge gap {gapIndex + 1}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </FieldGroup>
    </div>
  )
}

function ExpertSourceFields() {
  return (
    <FieldSet>
      <FieldLegend>Original source</FieldLegend>
      <FieldDescription>
        Optional context that prompted the interview request.
      </FieldDescription>
      <Field>
        <FieldLabel htmlFor="source-question">Original question</FieldLabel>
        <Textarea id="source-question" name="source-question" />
      </Field>
      <Field>
        <FieldLabel htmlFor="source-body">Original source material</FieldLabel>
        <Textarea id="source-body" name="source-body" />
      </Field>
      <Field>
        <FieldLabel htmlFor="source-url">Original source URL</FieldLabel>
        <Input
          id="source-url"
          name="source-url"
          type="url"
          inputMode="url"
          placeholder="https://"
        />
      </Field>
    </FieldSet>
  )
}
