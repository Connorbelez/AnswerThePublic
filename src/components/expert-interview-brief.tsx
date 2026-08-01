import { Badge } from "@/components/ui/badge"
import type { ExpertInterviewPackage } from "@/application/expert-interviews"

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase())
}

export function ExpertInterviewBriefView({
  expertInterview,
}: {
  expertInterview: ExpertInterviewPackage
}) {
  const { brief, gaps, questions, operatorInstructions } = expertInterview
  return (
    <section
      className="expert-interview-brief"
      aria-labelledby="expert-interview-brief-title"
    >
      <header className="expert-interview-brief__header">
        <div>
          <p className="expert-interview-brief__eyebrow">Evidence strategy</p>
          <h2 id="expert-interview-brief-title">Expert interview brief</h2>
        </div>
        <Badge variant="secondary">{humanize(brief.framing)}</Badge>
      </header>

      <p className="expert-interview-brief__summary">{brief.summary}</p>

      <dl className="expert-interview-brief__metadata">
        <div>
          <dt>Topic</dt>
          <dd>{brief.topic}</dd>
        </div>
        <div>
          <dt>Audience</dt>
          <dd>{brief.audience}</dd>
        </div>
        <div>
          <dt>FairLend posture</dt>
          <dd>{brief.fairlendPosture}</dd>
        </div>
        <div>
          <dt>Founder contribution</dt>
          <dd>{brief.founderContribution}</dd>
        </div>
      </dl>

      {operatorInstructions ? (
        <aside className="expert-interview-brief__instructions">
          <strong>Priority operator instructions</strong>
          <p>{operatorInstructions}</p>
        </aside>
      ) : null}

      <div className="expert-interview-brief__section">
        <div className="expert-interview-brief__section-heading">
          <div>
            <p className="expert-interview-brief__eyebrow">Evidence gaps</p>
            <h2>Knowledge gaps</h2>
          </div>
          <Badge variant="outline">{gaps.length}</Badge>
        </div>
        <div className="expert-interview-brief__grid">
          {gaps.map((gap, index) => (
            <article
              className="expert-interview-brief__card"
              data-testid="expert-interview-gap"
              key={gap.id}
            >
              <div className="expert-interview-brief__card-heading">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <Badge variant="outline">{humanize(gap.kind)}</Badge>
                  <h3>{gap.title}</h3>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Existing coverage</dt>
                  <dd>{gap.existingCoverage}</dd>
                </div>
                <div>
                  <dt>Why it falls short</dt>
                  <dd>{gap.whyItFallsShort}</dd>
                </div>
                <div>
                  <dt>Expert opportunity</dt>
                  <dd>{gap.expertOpportunity}</dd>
                </div>
              </dl>
              {gap.citations.length ? (
                <div className="expert-interview-brief__citations">
                  <strong>Sources</strong>
                  <ul>
                    {gap.citations.map((citation) => (
                      <li key={`${gap.id}:${citation.url}`}>
                        <a href={citation.url} target="_blank" rel="noreferrer">
                          {citation.label}
                        </a>
                        <span>{citation.supports}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>

      <div className="expert-interview-brief__section">
        <div className="expert-interview-brief__section-heading">
          <div>
            <p className="expert-interview-brief__eyebrow">
              Practitioner prompts
            </p>
            <h2>Interview questions</h2>
          </div>
          <Badge variant="outline">{questions.length}</Badge>
        </div>
        <ol className="expert-interview-brief__questions">
          {questions.map((question, index) => (
            <li
              className="expert-interview-brief__question"
              data-testid="expert-interview-question"
              key={question.id}
            >
              <span aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3>{question.question}</h3>
                <p>{question.motivation}</p>
                <div
                  className="expert-interview-brief__gap-links"
                  aria-label="Related knowledge gaps"
                >
                  {question.gapIds.map((gapId) => (
                    <Badge variant="secondary" key={gapId}>
                      {gapId}
                    </Badge>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
