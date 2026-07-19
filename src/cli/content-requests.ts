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
