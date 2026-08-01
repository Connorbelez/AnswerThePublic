import { spawn } from "node:child_process"

import type { ScoutIngestionResult } from "@/application/scout-ingestions"

export type ConvexDevScoutRunInput = {
  env: Record<string, string | undefined>
  idempotencyKey: string
  markdown: string
}

const AUTOMATION_IDENTITY = {
  subject: "workos-agent:codex-dev-opportunity-automation",
  issuer: "https://api.workos.com/agents",
  role: "agent-editor",
  jti: "codex-dev-opportunity-automation",
  tokenIdentifier: "codex-dev-opportunity-automation",
} as const

function runConvexFunction(
  functionName: string,
  args: Record<string, unknown>,
  identity: Record<string, string>,
  env: Record<string, string | undefined>
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "bunx",
      [
        "convex",
        "run",
        functionName,
        JSON.stringify(args),
        "--deployment",
        "dev",
        "--identity",
        JSON.stringify(identity),
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
      ],
      {
        cwd: process.cwd(),
        env: env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (value: string) => {
      stdout += value
    })
    child.stderr.on("data", (value: string) => {
      stderr += value
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim())
      else {
        const message =
          stderr.trim() ||
          `Convex dev function ${functionName} exited with code ${code}.`
        const remoteCode =
          /["']?code["']?\s*[:=]\s*["']([A-Z][A-Z0-9_]+)["']/.exec(message)?.[1]
        reject(
          Object.assign(new Error(message), {
            ...(remoteCode ? { code: remoteCode } : {}),
          })
        )
      }
    })
  })
}

export async function runConvexDevScoutIngestion({
  env,
  idempotencyKey,
  markdown,
}: ConvexDevScoutRunInput): Promise<ScoutIngestionResult> {
  const organizationId = env.FAIRLEND_WORKOS_ORGANIZATION_ID!
  const identity = { ...AUTOMATION_IDENTITY, org_id: organizationId }

  await runConvexFunction("principals:syncCurrent", {}, identity, env)
  const output = await runConvexFunction(
    "scoutIngestions:apply",
    { markdown, idempotencyKey },
    identity,
    env
  )
  try {
    return JSON.parse(output) as ScoutIngestionResult
  } catch {
    throw new Error("Convex dev ingestion returned an invalid JSON result.")
  }
}
