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
    "  expert-research-prompt --topic <topic> [--audience text] [--geography text] [--framing educational|how_to|insider_knowledge|fairlend_sales] [--instructions text]",
    "  expert-create --file expert-interview.json --idempotency-key <stable-key>",
    "  expert-submissions <CR-ID>",
    "  expert-selection <CR-ID> --submission-id <id> --include|--exclude --idempotency-key <stable-key>",
    "  expert-processing-input <CR-ID> --submissions <id,id> --idempotency-key <stable-key> [--instructions text]",
    "  expert-processing-complete <CR-ID> --submissions <id,id> --processing-token <signed-snapshot> --payload-digest <sha256> --file draft.md --idempotency-key <stable-key> [--job-id <job-id> --lease-token <active-token> --lease-generation <number>] [--deliverable-id id] [--name text] [--summary text]",
    "  people-search <query> [--limit 20]",
    "  person-create <CR-ID> --name <name> --email <email> --idempotency-key <stable-key>",
    "  guest-list <CR-ID>",
    "  guest-create <CR-ID> --person-id <person-id> --idempotency-key <stable-key>",
    "  guest-renew <grant-id> --idempotency-key <stable-key>",
    "  guest-revoke <grant-id> --idempotency-key <stable-key>",
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
    "  targets <CR-ID> [--retention active|archived] [--cursor cursor]",
    "  target-create <CR-ID> --deliverable-id <id> --channel <channel> --destination <label> [--url url] [--required] [--idempotency-key key]",
    "  target-required <target-id> --required <true|false> [--idempotency-key key]",
    "  target-retention <target-id> --retention <active|archived> [--idempotency-key key]",
    "  target-confirm <target-id> --version-id <id> [--note text] [--integration-success-id id] [--idempotency-key key]",
    "  target-reopen <target-id> [--idempotency-key key]",
    "  control <operation> [--json '{...}' | --file input.json] [--fields a,b] [--idempotency-key key]",
    "  bulk --file commands.json [--idempotency-key stable-batch-key]",
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
  if (
    command === "control" ||
    command === "bulk" ||
    command.startsWith("expert-") ||
    command.startsWith("guest-") ||
    command.startsWith("guest-access-") ||
    command.startsWith("person-") ||
    command.startsWith("people-")
  ) {
    const readFile =
      options.readFile ??
      (async (path: string) =>
        (await import("node:fs/promises")).readFile(path, "utf8"))
    url = `${baseUrl}/api/v1/cli/control`
    let body: unknown
    if (command === "bulk") {
      const parsed = JSON.parse(await readFile(requireFlag(args, "--file"))) as
        Array<unknown> | { commands?: Array<unknown> }
      const envelope = Array.isArray(parsed) ? { commands: parsed } : parsed
      const baseKey = readFlag(args, "--idempotency-key")
      body = baseKey
        ? {
            commands: envelope.commands?.map((item, index) =>
              typeof item === "object" && item !== null
                ? { ...item, idempotencyKey: `${baseKey}:${index}` }
                : item
            ),
          }
        : envelope
    } else if (command === "expert-research-prompt") {
      body = {
        command: {
          operation: "expert_interview.research_prompt",
          arguments: {
            topic: requireFlag(args, "--topic"),
            audience: readFlag(args, "--audience"),
            geography: readFlag(args, "--geography"),
            framing: readFlag(args, "--framing"),
            operatorInstructions: readFlag(args, "--instructions"),
          },
        },
      }
    } else if (command === "expert-create") {
      const expertInput = JSON.parse(
        await readFile(requireFlag(args, "--file"))
      ) as Record<string, unknown>
      body = {
        command: {
          operation: "expert_interview.create",
          arguments: expertInput,
          idempotencyKey: requireFlag(args, "--idempotency-key"),
        },
      }
    } else if (command === "expert-submissions") {
      const humanId = args[0]
      if (!humanId)
        throw new Error("expert-submissions requires a Content Request ID.")
      body = {
        command: {
          operation: "expert_interview.submissions",
          arguments: { humanId },
        },
      }
    } else if (command === "expert-selection") {
      const humanId = args[0]
      if (!humanId)
        throw new Error("expert-selection requires a Content Request ID.")
      const included = args.includes("--include")
        ? true
        : args.includes("--exclude")
          ? false
          : null
      if (
        included === null ||
        (args.includes("--include") && args.includes("--exclude"))
      )
        throw new Error("Use exactly one of --include or --exclude.")
      body = {
        command: {
          operation: "expert_interview.submission_selection",
          arguments: {
            humanId,
            submissionId: requireFlag(args, "--submission-id"),
            included,
          },
          idempotencyKey: requireFlag(args, "--idempotency-key"),
        },
      }
    } else if (command === "expert-processing-input") {
      const humanId = args[0]
      if (!humanId)
        throw new Error(
          "expert-processing-input requires a Content Request ID."
        )
      body = {
        command: {
          operation: "expert_interview.processing_input",
          arguments: {
            humanId,
            submissionIds: requireFlag(args, "--submissions")
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean),
            synthesisInstructions: readFlag(args, "--instructions"),
          },
          idempotencyKey: requireFlag(args, "--idempotency-key"),
        },
      }
    } else if (command === "expert-processing-complete") {
      const humanId = args[0]
      if (!humanId)
        throw new Error(
          "expert-processing-complete requires a Content Request ID."
        )
      const jobId = readFlag(args, "--job-id")
      const leaseToken = readFlag(args, "--lease-token")
      const leaseGenerationInput = readFlag(args, "--lease-generation")
      const leaseTuple = [jobId, leaseToken, leaseGenerationInput]
      if (
        leaseTuple.some((value) => value !== undefined) &&
        !leaseTuple.every((value) => value !== undefined)
      )
        throw new Error(
          "expert-processing-complete requires --job-id, --lease-token, and --lease-generation together."
        )
      body = {
        command: {
          operation: "expert_interview.complete_processing",
          arguments: {
            humanId,
            processingToken: requireFlag(args, "--processing-token"),
            payloadDigest: requireFlag(args, "--payload-digest"),
            submissionIds: requireFlag(args, "--submissions")
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean),
            body: await readFile(requireFlag(args, "--file")),
            jobId,
            leaseToken,
            leaseGeneration:
              leaseGenerationInput === undefined
                ? undefined
                : Number(leaseGenerationInput),
            deliverableId: readFlag(args, "--deliverable-id"),
            name: readFlag(args, "--name"),
            changeSummary: readFlag(args, "--summary"),
          },
          idempotencyKey: requireFlag(args, "--idempotency-key"),
        },
      }
    } else if (command === "people-search") {
      const query = args[0]
      if (!query) throw new Error("people-search requires a query.")
      body = {
        command: {
          operation: "person.search",
          arguments: {
            query,
            limit: readFlag(args, "--limit")
              ? Number(readFlag(args, "--limit"))
              : undefined,
          },
        },
      }
    } else if (command === "person-create") {
      const humanId = args[0]
      if (!humanId)
        throw new Error("person-create requires a Content Request ID.")
      body = {
        command: {
          operation: "person.create",
          arguments: {
            humanId,
            displayName: requireFlag(args, "--name"),
            email: requireFlag(args, "--email"),
          },
          idempotencyKey: requireFlag(args, "--idempotency-key"),
        },
      }
    } else if (command === "guest-list" || command === "guest-access-list") {
      const humanId = args[0]
      if (!humanId) throw new Error("guest-list requires a Content Request ID.")
      body = {
        command: {
          operation: "guest_access.list",
          arguments: { humanId },
        },
      }
    } else if (
      command === "guest-create" ||
      command === "guest-access-create"
    ) {
      const humanId = args[0]
      if (!humanId)
        throw new Error("guest-create requires a Content Request ID.")
      body = {
        command: {
          operation: "guest_access.create",
          arguments: {
            humanId,
            personId: requireFlag(args, "--person-id"),
          },
          idempotencyKey: requireFlag(args, "--idempotency-key"),
        },
      }
    } else if (
      command === "guest-renew" ||
      command === "guest-access-renew" ||
      command === "guest-revoke" ||
      command === "guest-access-revoke"
    ) {
      const grantId = args[0]
      if (!grantId) throw new Error(`${command} requires a grant ID.`)
      const renew = command.endsWith("renew")
      body = {
        command: {
          operation: renew ? "guest_access.renew" : "guest_access.revoke",
          arguments: { grantId },
          idempotencyKey: requireFlag(args, "--idempotency-key"),
        },
      }
    } else {
      const operation = args[0]
      if (!operation) throw new Error("control requires an operation.")
      const inline = readFlag(args, "--json")
      const file = readFlag(args, "--file")
      if (inline && file)
        throw new Error("Use either --json or --file, not both.")
      const argumentsValue = JSON.parse(
        inline ?? (file ? await readFile(file) : "{}")
      ) as unknown
      if (
        typeof argumentsValue !== "object" ||
        argumentsValue === null ||
        Array.isArray(argumentsValue)
      )
        throw new Error("Control arguments must be a JSON object.")
      body = {
        command: {
          operation,
          arguments: argumentsValue,
          fields: readFlag(args, "--fields")
            ?.split(",")
            .map((field) => field.trim())
            .filter(Boolean),
          idempotencyKey: readFlag(args, "--idempotency-key"),
        },
      }
    }
    init = { method: "POST", headers, body: JSON.stringify(body) }
  } else if (command === "list") {
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
    if (command === "targets") {
      const retention = readFlag(args, "--retention")
      if (retention && retention !== "active" && retention !== "archived")
        throw new Error("--retention must be active or archived.")
      const query = new URLSearchParams()
      if (retention) query.set("retention", retention)
      const cursor = readFlag(args, "--cursor")
      if (cursor) query.set("cursor", cursor)
      if (query.size) url += `?${query}`
    }
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
    [
      "target-required",
      "target-retention",
      "target-confirm",
      "target-reopen",
    ].includes(command)
  ) {
    if (!args[0]) throw new Error(`${command} requires a target ID.`)
    url = `${baseUrl}/api/v1/delivery-targets/${encodeURIComponent(args[0])}`
    let body: Record<string, unknown>
    if (command === "target-required") {
      const required = requireFlag(args, "--required")
      if (required !== "true" && required !== "false")
        throw new Error("--required must be true or false.")
      body = { action: "set_required", isRequired: required === "true" }
    } else if (command === "target-retention") {
      const retention = requireFlag(args, "--retention")
      if (retention !== "active" && retention !== "archived")
        throw new Error("--retention must be active or archived.")
      body = { action: "set_retention", retention }
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
    data?: { kind?: string } | Array<{ ok?: boolean }>
    error?: { code?: string; message?: string }
  }
  io.writeOut(JSON.stringify(payload))
  if (!response.ok) {
    io.writeError(payload.error?.message ?? `HTTP ${response.status}`)
    return 1
  }
  if (
    command === "bulk" &&
    Array.isArray(payload.data) &&
    payload.data.some((item) => item.ok === false)
  ) {
    io.writeError("One or more bulk commands failed.")
    return 3
  }
  return (command === "find" || command === "control") &&
    !Array.isArray(payload.data) &&
    payload.data?.kind === "candidates"
    ? 2
    : 0
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
