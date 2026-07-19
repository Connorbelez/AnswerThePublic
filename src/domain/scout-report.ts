import { normalizeSourceUrl } from "../../shared/url-normalization"

export const SCOUT_PARSER_VERSION = "fairlend-scout-v1"

export type ScoutSection = "A" | "B" | "C" | "D"

export type ScoutDiagnostic = {
  code:
    | "MISSING_HEADER"
    | "MISSING_SECTION"
    | "MISSING_FIELD"
    | "INVALID_URL"
    | "INVALID_SCORE"
    | "INVALID_HEADING"
    | "MISPLACED_ITEM"
    | "DUPLICATE_ITEM"
    | "DUPLICATE_SOURCE"
    | "LIMIT_EXCEEDED"
    | "COUNT_MISMATCH"
    | "BELOW_THRESHOLD"
  message: string
  path: string
  line: number
  remediation: string
}

export type ScoutCitation = { label: string; url: string; supports: string }

export type ParsedScoutOpportunity = {
  section: ScoutSection
  itemId: string
  title: string
  score: number
  timingLabel?: string
  sourceUrl: string
  normalizedSourceUrl: string
  rawMarkdown: string
  question?: string
  sourceMetadata: Array<string>
  talkingPoints: Array<string>
  researchRequirements: Array<string>
  citations: Array<ScoutCitation>
  guardrails: Array<string>
  operatorCue?: string
  deliveryHints: Array<string>
}

export type ParsedScoutReport = {
  reportIdentity: string
  parserVersion: typeof SCOUT_PARSER_VERSION
  rawMarkdown: string
  opportunities: Array<ParsedScoutOpportunity>
  demandLedgerMarkdown: string
}

export type ScoutParseResult =
  | { ok: true; report: ParsedScoutReport }
  | { ok: false; diagnostics: Array<ScoutDiagnostic> }

const REQUIRED_SECTIONS: Record<string, string> = {
  A: "Community questions to answer",
  B: "Live journalist/source requests",
  C: "Beat-aligned journalist/editorial prospects",
  D: "Journalist story leads from community discussions",
  E: "Content-demand ledger",
  F: "Needs manual verification",
  G: "Rejected high-surface-area leads",
  H: "No-op status",
}

const REQUIRED_FIELDS: Record<ScoutSection, Array<string>> = {
  A: [
    "Thread",
    "Source",
    "Question",
    "Why FairLend can help",
    "What is missing from existing replies",
    "Compliance/moderation check",
    "Recommended response",
    "Optional FairLend resource",
    "SEO/content signal",
  ],
  B: [
    "Request",
    "Reporter/publication",
    "Need",
    "Fit",
    "Credibility/deadline check",
    "What FairLend can contribute",
    "Risks",
    "Recommended action",
  ],
  C: [
    "Identity/current role",
    "Canonical work",
    "Demonstrated beat",
    "Why FairLend is relevant",
    "Potential future angles",
    "Public editorial channel",
    "Risks/constraints",
    "Recommended action",
  ],
  D: [
    "Community evidence",
    "Observed pattern",
    "Why it may matter now",
    "What is known vs. unverified",
    "Reporting path",
    "FairLend contribution",
    "Suggested journalist framing",
    "Risk check",
  ],
}

const HEADER = /^# FairLend Community \+ Media Opportunity Report — (.+)$/m
const ITEM_HEADER = /^### ([A-D]\d+)\. (.+)$/gm
export const MAX_SCOUT_REPORT_BYTES = 350_000
export const MAX_SCOUT_OPPORTUNITIES = 100
const MAX_SCOUT_DIAGNOSTICS = 100
const SECTION_RULES: Record<
  ScoutSection,
  { minimumScore: number; maximumItems: number }
> = {
  A: { minimumScore: 70, maximumItems: 10 },
  B: { minimumScore: 70, maximumItems: 8 },
  C: { minimumScore: 60, maximumItems: 10 },
  D: { minimumScore: 70, maximumItems: 5 },
}

function lineAt(markdown: string, index: number) {
  return markdown.slice(0, Math.max(index, 0)).split("\n").length
}

function diagnostic(
  code: ScoutDiagnostic["code"],
  message: string,
  path: string,
  line: number,
  remediation: string
): ScoutDiagnostic {
  return { code, message, path, line, remediation }
}

function fieldValue(block: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = block.match(
    new RegExp(`^- \\*\\*${escaped}:\\*\\*\\s*(.+)$`, "m")
  )
  return match?.[1].trim()
}

function markdownLinks(value: string) {
  return [...value.matchAll(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g)].map(
    (match) => ({
      label: match[1].trim(),
      url: match[2].trim(),
    })
  )
}

function splitPoints(value: string | undefined) {
  return (
    value
      ?.split(/;|\.\s+(?=[A-Z])/)
      .map((part) => part.trim())
      .filter(Boolean) ?? []
  )
}

function headerDetails(section: ScoutSection, rest: string) {
  const patterns: Record<ScoutSection, RegExp> = {
    A: /^(.*?) — Score: (\d{1,3})\/100 — Act by: (.+)$/,
    B: /^(.*?) — Score: (\d{1,3})\/100 — Deadline: (.+)$/,
    C: /^(.*?) — Prospect fit: (\d{1,3})\/100 — (.+)$/,
    D: /^(.*?) — Score: (\d{1,3})\/100$/,
  }
  const match = rest.match(patterns[section])
  return match
    ? {
        title: match[1].trim(),
        score: Number(match[2]),
        timingLabel: match[3]?.trim(),
      }
    : null
}

function primaryField(section: ScoutSection) {
  return section === "A"
    ? "Thread"
    : section === "B"
      ? "Request"
      : section === "C"
        ? "Identity/current role"
        : "Community evidence"
}

export function parseScoutReport(markdown: string): ScoutParseResult {
  const diagnostics: Array<ScoutDiagnostic> = []
  if (new TextEncoder().encode(markdown).byteLength > MAX_SCOUT_REPORT_BYTES) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "LIMIT_EXCEEDED",
          "The scout report exceeds the 350,000-byte ingestion limit.",
          "report",
          1,
          "Split the research into bounded complete automation reports."
        ),
      ],
    }
  }
  const reportHeader = markdown.match(HEADER)
  if (!reportHeader) {
    diagnostics.push(
      diagnostic(
        "MISSING_HEADER",
        "The canonical report header is missing.",
        "report.header",
        1,
        "Use the maintained automation report heading verbatim."
      )
    )
  }
  if (!/^## Executive summary$/m.test(markdown)) {
    diagnostics.push(
      diagnostic(
        "MISSING_SECTION",
        "The Executive summary section is missing or renamed.",
        "section.executive_summary",
        1,
        'Add "## Executive summary" using the maintained report contract.'
      )
    )
  }
  const sectionPositions = new Map<string, number>()
  for (const [letter, title] of Object.entries(REQUIRED_SECTIONS)) {
    const match = new RegExp(
      `^## ${letter}\\. ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "m"
    ).exec(markdown)
    if (!match) {
      diagnostics.push(
        diagnostic(
          "MISSING_SECTION",
          `Section ${letter} is missing or renamed.`,
          `section.${letter}`,
          1,
          `Add "## ${letter}. ${title}".`
        )
      )
    } else {
      sectionPositions.set(letter, match.index)
    }
  }

  for (const heading of markdown.matchAll(/^### ([^\n]+)$/gm)) {
    const expectedSection = (["A", "B", "C", "D"] as const).find((section) => {
      const start = sectionPositions.get(section)
      const end =
        sectionPositions.get(String.fromCharCode(section.charCodeAt(0) + 1)) ??
        markdown.length
      return start !== undefined && heading.index > start && heading.index < end
    })
    if (
      expectedSection &&
      !new RegExp(`^${expectedSection}\\d+\\.`).test(heading[1])
    ) {
      const visibleId = heading[1].match(/^([A-D]\d+)/)?.[1]
      diagnostics.push(
        diagnostic(
          "INVALID_HEADING",
          `A level-three heading in section ${expectedSection} does not use the maintained opportunity format.`,
          visibleId
            ? `${visibleId}.heading`
            : `section.${expectedSection}.heading`,
          lineAt(markdown, heading.index),
          `Start the heading with ${expectedSection} plus a unique number and period.`
        )
      )
    }
  }

  const matches = [...markdown.matchAll(ITEM_HEADER)]
  const summaryCounts = {
    A: "Qualified community questions",
    B: "Live journalist/source requests",
    C: "Beat-aligned journalist/editorial prospects",
    D: "Journalist story leads",
  } as const
  for (const [section, label] of Object.entries(summaryCounts)) {
    const declared = markdown.match(
      new RegExp(
        `^- ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: (\\d+)$`,
        "m"
      )
    )
    const actual = matches.filter((match) => match[1][0] === section).length
    const maximumItems = SECTION_RULES[section as ScoutSection].maximumItems
    if (actual > maximumItems) {
      diagnostics.push(
        diagnostic(
          "LIMIT_EXCEEDED",
          `Section ${section} contains ${actual} items; the maintained maximum is ${maximumItems}.`,
          `section.${section}`,
          sectionPositions.has(section)
            ? lineAt(markdown, sectionPositions.get(section)!)
            : 1,
          "Retain only the highest-confidence opportunities allowed by the maintained scout contract."
        )
      )
    }
    if (!declared) {
      diagnostics.push(
        diagnostic(
          "MISSING_FIELD",
          `Executive summary is missing the ${label} count.`,
          `executive_summary.${section}`,
          1,
          `Add "- ${label}: N" using the actual qualified-item count.`
        )
      )
    } else if (Number(declared[1]) !== actual) {
      diagnostics.push(
        diagnostic(
          "COUNT_MISMATCH",
          `Executive summary declares ${declared[1]} ${section} items but ${actual} valid headings were found.`,
          `executive_summary.${section}`,
          lineAt(markdown, declared.index ?? 0),
          "Reconcile the summary count with the complete actionable section."
        )
      )
    }
  }
  if (matches.length > MAX_SCOUT_OPPORTUNITIES) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "LIMIT_EXCEEDED",
          `The report contains more than ${MAX_SCOUT_OPPORTUNITIES} actionable opportunities.`,
          "report.opportunities",
          lineAt(markdown, matches[MAX_SCOUT_OPPORTUNITIES].index),
          "Keep each maintained report within the bounded opportunity limit."
        ),
      ],
    }
  }
  const opportunities: Array<ParsedScoutOpportunity> = []
  const seenItemIds = new Set<string>()
  const seenSourceUrls = new Map<string, string>()
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const itemId = match[1]
    const section = itemId[0] as ScoutSection
    const start = match.index
    if (seenItemIds.has(itemId)) {
      diagnostics.push(
        diagnostic(
          "DUPLICATE_ITEM",
          `${itemId} appears more than once.`,
          `${itemId}.heading`,
          lineAt(markdown, start),
          "Use one unique item ID per opportunity."
        )
      )
    }
    seenItemIds.add(itemId)
    const expectedSectionStart = sectionPositions.get(section)
    const nextSectionStart =
      sectionPositions.get(String.fromCharCode(section.charCodeAt(0) + 1)) ??
      markdown.length
    if (
      expectedSectionStart === undefined ||
      start < expectedSectionStart ||
      start >= nextSectionStart
    ) {
      diagnostics.push(
        diagnostic(
          "MISPLACED_ITEM",
          `${itemId} is outside section ${section}.`,
          `${itemId}.heading`,
          lineAt(markdown, start),
          `Move ${itemId} beneath the section ${section} heading.`
        )
      )
    }
    const end = matches[index + 1]?.index ?? markdown.length
    const nextSection = markdown.slice(start).search(/^## [A-H]\. /m)
    const blockEnd = nextSection > 0 ? Math.min(end, start + nextSection) : end
    const block = markdown.slice(start, blockEnd).trim()
    const details = headerDetails(section, match[2])
    if (!details || details.score < 0 || details.score > 100) {
      diagnostics.push(
        diagnostic(
          "INVALID_SCORE",
          `The ${itemId} heading or score is invalid.`,
          `${itemId}.score`,
          lineAt(markdown, start),
          "Use the exact maintained item heading and a score from 0 to 100."
        )
      )
      continue
    }
    if (details.score < SECTION_RULES[section].minimumScore) {
      diagnostics.push(
        diagnostic(
          "BELOW_THRESHOLD",
          `${itemId} scores below the maintained ${SECTION_RULES[section].minimumScore}/100 threshold.`,
          `${itemId}.score`,
          lineAt(markdown, start),
          "Reject the opportunity or provide verified evidence supporting a qualifying score."
        )
      )
    }
    const fields = Object.fromEntries(
      REQUIRED_FIELDS[section].map((field) => [field, fieldValue(block, field)])
    )
    for (const field of REQUIRED_FIELDS[section]) {
      if (!fields[field]) {
        diagnostics.push(
          diagnostic(
            "MISSING_FIELD",
            `${itemId} is missing ${field}.`,
            `${itemId}.${field}`,
            lineAt(markdown, start),
            `Add the required "- **${field}:**" field.`
          )
        )
      }
    }
    const primary = fields[primaryField(section)] ?? ""
    const primaryLink = markdownLinks(primary)[0]
    const normalizedSourceUrl = primaryLink
      ? normalizeSourceUrl(primaryLink.url)
      : null
    if (!normalizedSourceUrl) {
      diagnostics.push(
        diagnostic(
          "INVALID_URL",
          `${itemId} has no valid canonical HTTP(S) source URL.`,
          `${itemId}.${primaryField(section)}`,
          lineAt(markdown, start),
          "Provide a canonical Markdown link in the primary source field."
        )
      )
      continue
    }
    const previousItemId = seenSourceUrls.get(normalizedSourceUrl)
    if (previousItemId) {
      diagnostics.push(
        diagnostic(
          "DUPLICATE_SOURCE",
          `${itemId} duplicates the canonical source used by ${previousItemId}.`,
          `${itemId}.${primaryField(section)}`,
          lineAt(markdown, start),
          "Merge duplicate opportunities before ingestion."
        )
      )
    } else {
      seenSourceUrls.set(normalizedSourceUrl, itemId)
    }

    const evidenceHeading =
      section === "A"
        ? "Evidence used"
        : section === "B"
          ? "Evidence pack"
          : null
    const evidence = evidenceHeading
      ? block.slice(Math.max(0, block.indexOf(`**${evidenceHeading}**`)))
      : [fields["Canonical work"], fields["Community evidence"]]
          .filter(Boolean)
          .join("\n")
    const citations = markdownLinks(evidence).map((link) => ({
      ...link,
      url: normalizeSourceUrl(link.url) ?? link.url,
      supports:
        evidence
          .split("\n")
          .find((line) => line.includes(`](${link.url})`))
          ?.split("—")[1]
          ?.trim() ?? "Source evidence",
    }))
    const talkingFields =
      section === "A"
        ? [
            "Why FairLend can help",
            "What is missing from existing replies",
            "SEO/content signal",
          ]
        : section === "B"
          ? ["Need", "Fit", "What FairLend can contribute"]
          : section === "C"
            ? [
                "Demonstrated beat",
                "Why FairLend is relevant",
                "Potential future angles",
              ]
            : [
                "Observed pattern",
                "Why it may matter now",
                "FairLend contribution",
                "Suggested journalist framing",
              ]
    const researchFields =
      section === "B"
        ? ["Credibility/deadline check"]
        : section === "C"
          ? ["Identity/current role", "Canonical work"]
          : section === "D"
            ? ["What is known vs. unverified", "Reporting path"]
            : ["Source"]
    const riskField =
      section === "A"
        ? "Compliance/moderation check"
        : section === "C"
          ? "Risks/constraints"
          : section === "D"
            ? "Risk check"
            : "Risks"
    const actionField =
      section === "A" ? "Recommended response" : "Recommended action"
    opportunities.push({
      section,
      itemId,
      title: details.title,
      score: details.score,
      timingLabel: details.timingLabel,
      sourceUrl: primaryLink!.url,
      normalizedSourceUrl,
      rawMarkdown: block,
      question: fields.Question,
      sourceMetadata: splitPoints(
        fields.Source ??
          fields["Reporter/publication"] ??
          fields["Identity/current role"]
      ),
      talkingPoints: talkingFields.flatMap((field) =>
        splitPoints(fields[field])
      ),
      researchRequirements: researchFields.flatMap((field) =>
        splitPoints(fields[field])
      ),
      citations,
      guardrails: splitPoints(fields[riskField]),
      operatorCue: fields[actionField],
      deliveryHints: fields[actionField] ? [fields[actionField]] : [],
    })
  }

  if (diagnostics.length > 0)
    return {
      ok: false,
      diagnostics: diagnostics.slice(0, MAX_SCOUT_DIAGNOSTICS),
    }
  const demandStart = markdown.search(/^## E\. /m)
  const demandEnd = markdown.search(/^## F\. /m)
  return {
    ok: true,
    report: {
      reportIdentity: reportHeader![1].trim(),
      parserVersion: SCOUT_PARSER_VERSION,
      rawMarkdown: markdown,
      opportunities,
      demandLedgerMarkdown:
        demandStart >= 0 && demandEnd > demandStart
          ? markdown.slice(demandStart, demandEnd).trim()
          : "",
    },
  }
}
