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

export function syncConvexWorkosEnvironment(environment: NodeJS.ProcessEnv) {
  requirePersonalDevDeployment(environment.CONVEX_DEPLOYMENT)
  const values = requiredLocalWorkosEnvironment(environment)

  for (const [name, value] of Object.entries(values)) {
    const result = spawnSync("bunx", ["convex", "env", "set", name, value], {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`Failed to synchronize ${name} to Convex dev.`)
    }
  }
}

if (import.meta.main) {
  syncConvexWorkosEnvironment(process.env)
}
