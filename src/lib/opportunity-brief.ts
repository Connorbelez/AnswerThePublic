export type OpportunityRisk = "low" | "medium" | "high" | null

export type OpportunityBrief = {
  score: number | null
  ageLabel: string | null
  risk: OpportunityRisk
  whyItMatters: string | null
  responseGap: string | null
  compliance: string | null
  draftResponse: string | null
  evidenceMarkdown: string | null
  evidenceCount: number
}

const numberWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

function cleanInlineMarkdown(value: string) {
  return value
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function labelledValue(markdown: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = markdown.match(
    new RegExp(
      `(?:^|\\n)\\s*[-*]?\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*([^\\n]+)`,
      "i"
    )
  )
  return match ? cleanInlineMarkdown(match[1]) : null
}

function section(markdown: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = markdown.match(
    new RegExp(
      `(?:^|\\n)#{1,6}\\s+${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n#{1,6}\\s+|$)`,
      "i"
    )
  )
  return match?.[1].trim() || null
}

function sourceAge(markdown: string) {
  const compact = markdown.match(/\b(\d{1,3})\s*(minutes?|hours?|days?)\b/i)
  const words = markdown.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(minutes?|hours?|days?)\b/i
  )
  const amount = compact
    ? Number(compact[1])
    : words
      ? numberWords[words[1].toLowerCase()]
      : null
  const unit = compact?.[2] ?? words?.[2]
  if (!amount || !unit) return null
  return `${amount}${unit.toLowerCase().startsWith("minute") ? "m" : unit.toLowerCase().startsWith("hour") ? "h" : "d"}`
}

export function extractOpportunityBrief(
  markdown?: string | null
): OpportunityBrief {
  const body = markdown?.trim() ?? ""
  const scoreMatch = body.match(/\bScore\s*:\s*(\d{1,3})\s*\/\s*100\b/i)
  const compliance = labelledValue(body, "Compliance/moderation check")
  const riskMatch = compliance?.match(/\b(low|medium|high)\s+risk\b/i)
  const draftResponse = section(body, "Draft response")
  const evidenceMarkdown = section(body, "Evidence used")
  const evidenceCount = evidenceMarkdown
    ? evidenceMarkdown.split("\n").filter((line) => /^\s*[-*]\s+/.test(line))
        .length
    : 0

  return {
    score: scoreMatch ? Number(scoreMatch[1]) : null,
    ageLabel: sourceAge(body),
    risk: (riskMatch?.[1].toLowerCase() as OpportunityRisk) ?? null,
    whyItMatters: labelledValue(body, "Why FairLend can help"),
    responseGap: labelledValue(body, "What is missing from existing replies"),
    compliance,
    draftResponse,
    evidenceMarkdown,
    evidenceCount,
  }
}
