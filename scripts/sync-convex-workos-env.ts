import { spawnSync } from "node:child_process"

export const convexWorkosEnvironmentMappings = [
  ["WORKOS_CLIENT_ID", "WORKOS_CLIENT_ID"],
  ["WORKOS_API_KEY", "WORKOS_API_KEY"],
  ["WORKOS_ENVIRONMENT_ID", "WORKOS_ENVIRONMENT_ID"],
  ["FAIRLEND_WORKOS_ORGANIZATION_ID", "WORKOS_ORGANIZATION_ID"],
] as const

export function requirePersonalDevDeployment(deployment: string | undefined) {
  const normalized = deployment?.split("#", 1)[0]?.trim()
  if (!normalized?.startsWith("dev:")) {
    throw new Error(
      "Refusing to synchronize WorkOS outside a personal Convex dev deployment."
    )
  }
  return normalized
}

export function requiredLocalWorkosEnvironment(environment: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    convexWorkosEnvironmentMappings.map(([convexName, localName]) => {
      const value = environment[localName]?.trim()
      if (!value) {
        throw new Error(`${localName} must be configured in .env.local.`)
      }
      return [convexName, value]
    })
  )
}

function quoteEnvironmentValue(value: string) {
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes("`")) return `\`${value}\``
  throw new Error(
    "WorkOS environment values cannot contain both single quotes and backticks."
  )
}

export function serializeConvexEnvironment(values: Record<string, string>) {
  return `${Object.entries(values)
    .map(([name, value]) => `${name}=${quoteEnvironmentValue(value)}`)
    .join("\n")}\n`
}

export function syncConvexWorkosEnvironment(environment: NodeJS.ProcessEnv) {
  requirePersonalDevDeployment(environment.CONVEX_DEPLOYMENT)
  const values = requiredLocalWorkosEnvironment(environment)
  const result = spawnSync("bunx", ["convex", "env", "set", "--force"], {
    cwd: process.cwd(),
    env: environment,
    input: serializeConvexEnvironment(values),
    stdio: ["pipe", "inherit", "inherit"],
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      "Failed to synchronize the WorkOS environment to Convex dev."
    )
  }
}

if (import.meta.main) {
  syncConvexWorkosEnvironment(process.env)
}
