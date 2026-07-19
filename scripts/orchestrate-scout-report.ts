import {
  orchestrateScoutOpportunities,
  SCOUT_ORCHESTRATION_EXIT,
} from "@/automation/scout-opportunity-orchestrator"

function readFlag(args: Array<string>, flag: string) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function usage() {
  return [
    "FairLend scout opportunity orchestrator",
    "  --file <report.md> [--validate-only] [--idempotency-key <stable-key>]",
    "Environment:",
    "  CONTENT_REQUESTS_API_URL or FAIRLEND_APP_URL",
    "  CONTENT_REQUESTS_ACCESS_TOKEN",
  ].join("\n")
}

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("help")) {
  process.stdout.write(`${usage()}\n`)
} else {
  const file = readFlag(args, "--file")
  if (!file) {
    process.stderr.write(`${usage()}\n`)
    process.exitCode = SCOUT_ORCHESTRATION_EXIT.configurationError
  } else {
    process.exitCode = await orchestrateScoutOpportunities({
      file,
      idempotencyKey: readFlag(args, "--idempotency-key"),
      validateOnly: args.includes("--validate-only"),
    })
  }
}
