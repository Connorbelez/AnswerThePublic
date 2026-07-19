type CliIo = {
  writeOut(value: string): void
  writeError(value: string): void
}

type CliOptions = {
  fetchImpl?: typeof fetch
  readFile?: (path: string) => Promise<string>
  env?: Record<string, string | undefined>
  io?: CliIo
}

function readFlag(args: Array<string>, flag: string) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function requireFlag(args: Array<string>, flag: string) {
  const value = readFlag(args, flag)
  if (!value) throw new Error(`${flag} is required.`)
  return value
}

function usage() {
  return [
    "Content Requests CLI",
    "  list [--limit 50]",
    "  get <CR-ID>",
    "  find <ID, title, or fuzzy query>",
    "  create --title <title> [--question <text>] [--body <text>] [--url <url>]",
    "  ingest --file <report.md> --idempotency-key <stable-key>",
    "  jobs",
    "  job-claim --lease-token <token> [--lease-ms 300000]",
    "  job-input <job-id>",
    "  job-heartbeat <job-id> --lease-token <token> --lease-generation <n> [--lease-ms 300000]",
    "  job-complete <job-id> --lease-token <token> --lease-generation <n> --file <response.md>",
    "  job-fail <job-id> --lease-token <token> --lease-generation <n> --error-code <code> [--permanent]",
    "  deliverables <CR-ID>",
    "  derivative <CR-ID> --kind <kind> --name <name> [--file content.md] [--idempotency-key key]",
    "  version <deliverable-id> --file content.md [--summary text] [--idempotency-key key]",
    "  promote <deliverable-id> --version-id <version-id> --expected-version-id <version-id|none> [--idempotency-key key]",
    "  primary <CR-ID> --deliverable-id <deliverable-id> --expected-primary-id <deliverable-id> [--idempotency-key key]",
    "  conflicts <CR-ID>",
    "  conflict-resolve <conflict-id> --value <selected-id> [--idempotency-key key]",
    "  targets <CR-ID>",
    "  target-create <CR-ID> --deliverable-id <id> --channel <channel> --destination <label> [--url url] [--required] [--idempotency-key key]",
    "  target-required <target-id> --required <true|false> [--idempotency-key key]",
    "  target-confirm <target-id> --version-id <id> [--note text] [--integration-success-id id] [--idempotency-key key]",
    "  target-reopen <target-id> [--idempotency-key key]",
    "Environment: CONTENT_REQUESTS_API_URL, CONTENT_REQUESTS_ACCESS_TOKEN",
  ].join("\n")
}

export async function runContentRequestsCli(
  argv: Array<string>,
  options: CliOptions = {}
) {
  const fetchImpl = options.fetchImpl ?? fetch
  const env = options.env ?? process.env
  const io = options.io ?? {
    writeOut: (value: string) => process.stdout.write(`${value}\n`),
    writeError: (value: string) => process.stderr.write(`${value}\n`),
  }
  const [command, ...args] = argv
  if (!command || command === "help" || command === "--help") {
    io.writeOut(usage())
    return 0
  }
  const baseUrl = env.CONTENT_REQUESTS_API_URL?.replace(/\/$/, "")
  const token = env.CONTENT_REQUESTS_ACCESS_TOKEN
  if (!baseUrl) throw new Error("CONTENT_REQUESTS_API_URL is required.")
  if (!token) throw new Error("CONTENT_REQUESTS_ACCESS_TOKEN is required.")
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  }

  let url = `${baseUrl}/api/v1/cli/content-requests`
  let init: RequestInit = { headers }
  if (command === "list") {
    const limit = readFlag(args, "--limit")
    if (limit) url += `?limit=${encodeURIComponent(limit)}`
  } else if (command === "get") {
    if (!args[0]) throw new Error("get requires a Content Request ID.")
    url += `/${encodeURIComponent(args[0])}`
  } else if (command === "find") {
    if (args.length === 0) throw new Error("find requires a query.")
    url += `?q=${encodeURIComponent(args.join(" "))}`
  } else if (command === "create") {
    const source = {
      question: readFlag(args, "--question"),
      body: readFlag(args, "--body"),
      url: readFlag(args, "--url"),
    }
    init = {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: requireFlag(args, "--title"),
        source: Object.values(source).some(Boolean) ? source : undefined,
        correlationId: crypto.randomUUID(),
      }),
    }
  } else if (command === "ingest") {
    const file = requireFlag(args, "--file")
    const idempotencyKey = requireFlag(args, "--idempotency-key")
    const readFile =
      options.readFile ??
      (async (path: string) =>
        (await import("node:fs/promises")).readFile(path, "utf8"))
    url = `${baseUrl}/api/v1/cli/scout-ingestions`
    init = {
      method: "POST",
      headers,
      body: JSON.stringify({ markdown: await readFile(file), idempotencyKey }),
    }
  } else if (command === "jobs") {
    url = `${baseUrl}/api/v1/agent-jobs`
  } else if (command === "job-claim") {
    url = `${baseUrl}/api/v1/agent-jobs`
    init = {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "claim",
        leaseToken: requireFlag(args, "--lease-token"),
        leaseMs: Number(readFlag(args, "--lease-ms") ?? 300_000),
      }),
    }
  } else if (
    ["job-input", "job-heartbeat", "job-complete", "job-fail"].includes(command)
  ) {
    const jobId = args[0]
    if (!jobId) throw new Error(`${command} requires a job ID.`)
    url = `${baseUrl}/api/v1/agent-jobs/${encodeURIComponent(jobId)}`
    if (command !== "job-input") {
      const leaseToken = requireFlag(args, "--lease-token")
      const leaseGeneration = Number(requireFlag(args, "--lease-generation"))
      let body: Record<string, unknown>
      if (command === "job-heartbeat")
        body = {
          action: "heartbeat",
          leaseToken,
          leaseMs: Number(readFlag(args, "--lease-ms") ?? 300_000),
          leaseGeneration,
        }
      else if (command === "job-complete") {
        const readFile =
          options.readFile ??
          (async (path: string) =>
            (await import("node:fs/promises")).readFile(path, "utf8"))
        body = {
          action: "complete",
          leaseToken,
          body: await readFile(requireFlag(args, "--file")),
          correlationId: crypto.randomUUID(),
          leaseGeneration,
        }
      } else
        body = {
          action: "fail",
          leaseToken,
          errorCode: requireFlag(args, "--error-code"),
          transient: !args.includes("--permanent"),
          correlationId: crypto.randomUUID(),
          leaseGeneration,
        }
      init = { method: "POST", headers, body: JSON.stringify(body) }
    }
  } else if (["deliverables", "derivative", "primary"].includes(command)) {
    const requestId = args[0]
    if (!requestId) throw new Error(`${command} requires a Content Request ID.`)
    url = `${baseUrl}/api/v1/content-requests/${encodeURIComponent(requestId)}/deliverables`
    if (command !== "deliverables") {
      let body: Record<string, unknown>
      if (command === "primary")
        body = {
          action: "set_primary",
          deliverableId: requireFlag(args, "--deliverable-id"),
          expectedPrimaryDeliverableId: requireFlag(
            args,
            "--expected-primary-id"
          ),
          correlationId:
            readFlag(args, "--idempotency-key") ?? crypto.randomUUID(),
        }
      else {
        const file = readFlag(args, "--file")
        const readFile =
          options.readFile ??
          (async (path: string) =>
            (await import("node:fs/promises")).readFile(path, "utf8"))
        body = {
          action: "create_derivative",
          kind: requireFlag(args, "--kind"),
          name: requireFlag(args, "--name"),
          body: file ? await readFile(file) : undefined,
          correlationId:
            readFlag(args, "--idempotency-key") ?? crypto.randomUUID(),
        }
      }
      init = { method: "POST", headers, body: JSON.stringify(body) }
    }
  } else if (["version", "promote"].includes(command)) {
    const deliverableId = args[0]
    if (!deliverableId) throw new Error(`${command} requires a deliverable ID.`)
    url = `${baseUrl}/api/v1/deliverables/${encodeURIComponent(deliverableId)}`
    if (command === "version") {
      const readFile =
        options.readFile ??
        (async (path: string) =>
          (await import("node:fs/promises")).readFile(path, "utf8"))
      init = {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "create_version",
          body: await readFile(requireFlag(args, "--file")),
          changeSummary: readFlag(args, "--summary"),
          correlationId:
            readFlag(args, "--idempotency-key") ?? crypto.randomUUID(),
        }),
      }
    } else {
      const expectedVersionId = requireFlag(args, "--expected-version-id")
      init = {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "promote",
          versionId: requireFlag(args, "--version-id"),
          expectedPromotedVersionId:
            expectedVersionId === "none" ? null : expectedVersionId,
          correlationId:
            readFlag(args, "--idempotency-key") ?? crypto.randomUUID(),
        }),
      }
    }
  } else if (command === "conflicts") {
    if (!args[0]) throw new Error("conflicts requires a Content Request ID.")
    url = `${baseUrl}/api/v1/content-requests/${encodeURIComponent(args[0])}/semantic-conflicts`
  } else if (command === "conflict-resolve") {
    if (!args[0]) throw new Error("conflict-resolve requires a conflict ID.")
    url = `${baseUrl}/api/v1/semantic-conflicts/${encodeURIComponent(args[0])}`
    init = {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "resolve",
        selectedValue: requireFlag(args, "--value"),
        correlationId:
          readFlag(args, "--idempotency-key") ?? crypto.randomUUID(),
      }),
    }
  } else if (["targets", "target-create"].includes(command)) {
    if (!args[0]) throw new Error(`${command} requires a Content Request ID.`)
    url = `${baseUrl}/api/v1/content-requests/${encodeURIComponent(args[0])}/delivery-targets`
    if (command === "target-create")
      init = {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "create",
          deliverableId: requireFlag(args, "--deliverable-id"),
          channel: requireFlag(args, "--channel"),
          destinationLabel: requireFlag(args, "--destination"),
          destinationUrl: readFlag(args, "--url"),
          isRequired: args.includes("--required"),
          correlationId:
            readFlag(args, "--idempotency-key") ?? crypto.randomUUID(),
        }),
      }
  } else if (
    ["target-required", "target-confirm", "target-reopen"].includes(command)
  ) {
    if (!args[0]) throw new Error(`${command} requires a target ID.`)
    url = `${baseUrl}/api/v1/delivery-targets/${encodeURIComponent(args[0])}`
    let body: Record<string, unknown>
    if (command === "target-required") {
      const required = requireFlag(args, "--required")
      if (required !== "true" && required !== "false")
        throw new Error("--required must be true or false.")
      body = { action: "set_required", isRequired: required === "true" }
    } else if (command === "target-confirm")
      body = {
        action: "confirm",
        versionId: requireFlag(args, "--version-id"),
        note: readFlag(args, "--note"),
        integrationSuccessId: readFlag(args, "--integration-success-id"),
      }
    else body = { action: "reopen" }
    body.correlationId =
      readFlag(args, "--idempotency-key") ?? crypto.randomUUID()
    init = { method: "POST", headers, body: JSON.stringify(body) }
  } else {
    throw new Error(`Unknown command: ${command}\n${usage()}`)
  }

  const response = await fetchImpl(url, init)
  const payload = (await response.json()) as {
    data?: { kind?: string }
    error?: { code?: string; message?: string }
  }
  io.writeOut(JSON.stringify(payload))
  if (!response.ok) {
    io.writeError(payload.error?.message ?? `HTTP ${response.status}`)
    return 1
  }
  return command === "find" && payload.data?.kind === "candidates" ? 2 : 0
}

if (process.argv[1]?.endsWith("content-requests.ts")) {
  runContentRequestsCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "CLI failed."}\n`
      )
      process.exitCode = 1
    })
}
