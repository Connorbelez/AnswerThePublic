import {
  orchestrateScoutOpportunities,
  SCOUT_ORCHESTRATION_EXIT,
} from "@/automation/scout-opportunity-orchestrator"

function readFlag(args: Array<string>, flag: string) {
  const index = args.indexOf(flag)
  if (index < 0 || args[index + 1]?.startsWith("--")) return undefined
  return args[index + 1]
}

function usage() {
  return [
    "FairLend scout opportunity orchestrator",
    "  --file <report.md> [--target api|convex-dev] [--validate-only] [--idempotency-key <stable-key>]",
    "Environment:",
    "  convex-dev: CONVEX_DEPLOYMENT, VITE_CONVEX_URL, FAIRLEND_WORKOS_ORGANIZATION_ID",
    "  api (default):",
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
    const target = readFlag(args, "--target")
    if (target && target !== "api" && target !== "convex-dev") {
      process.stderr.write(`Invalid --target: ${target}\n${usage()}\n`)
      process.exitCode = SCOUT_ORCHESTRATION_EXIT.configurationError
    } else {
      process.exitCode = await orchestrateScoutOpportunities({
        file,
        idempotencyKey: readFlag(args, "--idempotency-key"),
        target,
        validateOnly: args.includes("--validate-only"),
      })
    }
  }
}
