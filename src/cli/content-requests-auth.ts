import { spawn } from "node:child_process"

const WORKOS_AUTHENTICATE_URL =
  "https://api.workos.com/user_management/authenticate"
const WORKOS_DEVICE_AUTHORIZATION_URL =
  "https://api.workos.com/user_management/authorize/device"
const KEYCHAIN_SERVICE = "ca.fairlend.content-requests.cli"
const EDITOR_ROLES = new Set([
  "operator-editor",
  "agent-editor",
  "admin",
  "administrator",
])

export type CliAuthStore = {
  read(account: string): Promise<string | null>
  write(account: string, refreshToken: string): Promise<void>
  delete(account: string): Promise<void>
}

type AuthIo = {
  writeOut(value: string): void
  writeError(value: string): void
}

type WorkOsClaims = {
  sub?: string
  org_id?: string
  role?: string
  exp?: number
}

type AuthSession = {
  accessToken: string
  organizationId: string
  role: string
  expiresAt?: string
}

type AuthDependencies = {
  fetchImpl: typeof fetch
  env: Record<string, string | undefined>
  io: AuthIo
  authStore?: CliAuthStore
  openUrl?: (url: string) => Promise<void> | void
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
}

function keychainAccount(clientId: string, organizationId: string) {
  return `${clientId}:${organizationId}`
}

function requiredConfig(env: Record<string, string | undefined>) {
  const clientId = env.WORKOS_CLIENT_ID
  const organizationId = env.WORKOS_ORGANIZATION_ID
  if (!clientId) throw new Error("WORKOS_CLIENT_ID is required.")
  if (!organizationId) throw new Error("WORKOS_ORGANIZATION_ID is required.")
  return { clientId, organizationId }
}

function decodeJwtClaims(accessToken: string): WorkOsClaims {
  const parts = accessToken.split(".")
  if (parts.length !== 3) {
    throw new Error("WorkOS returned an invalid access token.")
  }
  try {
    return JSON.parse(
      Buffer.from(parts[1] ?? "", "base64url").toString("utf8")
    ) as WorkOsClaims
  } catch {
    throw new Error("WorkOS returned an invalid access token.")
  }
}

function validateSession(
  accessToken: string,
  expectedOrganizationId: string
): AuthSession {
  const claims = decodeJwtClaims(accessToken)
  if (claims.org_id !== expectedOrganizationId) {
    throw new Error(
      "WorkOS authenticated a user in a different organization."
    )
  }
  if (!claims.role || !EDITOR_ROLES.has(claims.role)) {
    throw new Error(
      "The authenticated WorkOS user does not have an editor role."
    )
  }
  return {
    accessToken,
    organizationId: claims.org_id,
    role: claims.role,
    expiresAt:
      typeof claims.exp === "number"
        ? new Date(claims.exp * 1_000).toISOString()
        : undefined,
  }
}

async function jsonResponse(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    throw new Error(`WorkOS authentication failed with HTTP ${response.status}.`)
  }
}

async function runSecurity(
  args: Array<string>,
  stdin?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, {
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout, stderr })
    )
    child.stdin.end(stdin)
  })
}

type SecurityRunner = (
  args: Array<string>,
  stdin?: string
) => Promise<{ code: number; stdout: string; stderr: string }>

function quoteSecurityArgument(value: string) {
  if (/[\r\n\0]/u.test(value)) {
    throw new Error("Keychain values cannot contain control characters.")
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

export function createMacOsKeychainAuthStore(
  securityRunner: SecurityRunner = runSecurity
): CliAuthStore {
  return {
    async read(account) {
      const result = await securityRunner([
        "find-generic-password",
        "-a",
        account,
        "-s",
        KEYCHAIN_SERVICE,
        "-w",
      ])
      if (result.code === 44) return null
      if (result.code !== 0) {
        throw new Error(
          result.stderr.trim() || "Unable to read the macOS Keychain."
        )
      }
      return result.stdout.trim() || null
    },
    async write(account, refreshToken) {
      const command = [
        "add-generic-password",
        "-a",
        quoteSecurityArgument(account),
        "-s",
        quoteSecurityArgument(KEYCHAIN_SERVICE),
        "-U",
        "-w",
        quoteSecurityArgument(refreshToken),
      ].join(" ")
      const result = await securityRunner(
        ["-i"],
        `${command}\n`
      )
      if (result.code !== 0) {
        throw new Error(
          result.stderr.trim() || "Unable to update the macOS Keychain."
        )
      }
    },
    async delete(account) {
      const result = await securityRunner([
        "delete-generic-password",
        "-a",
        account,
        "-s",
        KEYCHAIN_SERVICE,
      ])
      if (result.code !== 0 && result.code !== 44) {
        throw new Error(
          result.stderr.trim() || "Unable to update the macOS Keychain."
        )
      }
    },
  }
}

async function defaultOpenUrl(url: string) {
  const result = await new Promise<number>((resolve, reject) => {
    const child = spawn("/usr/bin/open", [url], {
      stdio: "ignore",
    })
    child.on("error", reject)
    child.on("close", (code) => resolve(code ?? 1))
  })
  if (result !== 0) {
    throw new Error("Unable to open the WorkOS verification URL.")
  }
}

export async function loginWithWorkOsDeviceAuth(
  dependencies: AuthDependencies
) {
  const { clientId, organizationId } = requiredConfig(dependencies.env)
  const authStore =
    dependencies.authStore ?? createMacOsKeychainAuthStore()
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const now = dependencies.now ?? Date.now
  const authorizationResponse = await dependencies.fetchImpl(
    WORKOS_DEVICE_AUTHORIZATION_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId }),
    }
  )
  const authorization = await jsonResponse(authorizationResponse)
  if (!authorizationResponse.ok) {
    throw new Error(
      String(
        authorization.error_description ??
          authorization.error ??
          "WorkOS device authorization failed."
      )
    )
  }

  const deviceCode = authorization.device_code
  const userCode = authorization.user_code
  const verificationUri = authorization.verification_uri
  const verificationUriComplete = authorization.verification_uri_complete
  const expiresIn = authorization.expires_in
  let intervalSeconds =
    typeof authorization.interval === "number" ? authorization.interval : 5
  if (
    typeof deviceCode !== "string" ||
    typeof userCode !== "string" ||
    typeof verificationUri !== "string" ||
    typeof expiresIn !== "number"
  ) {
    throw new Error("WorkOS returned an invalid device authorization response.")
  }
  dependencies.io.writeOut(
    JSON.stringify({
      status: "authorization_required",
      userCode,
      verificationUri:
        typeof verificationUriComplete === "string"
          ? verificationUriComplete
          : verificationUri,
    })
  )
  await (dependencies.openUrl ?? defaultOpenUrl)(
    typeof verificationUriComplete === "string"
      ? verificationUriComplete
      : verificationUri
  )

  const deadline = now() + expiresIn * 1_000
  while (now() < deadline) {
    await sleep(intervalSeconds * 1_000)
    const tokenResponse = await dependencies.fetchImpl(
      WORKOS_AUTHENTICATE_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: clientId,
        }),
      }
    )
    const tokenPayload = await jsonResponse(tokenResponse)
    if (!tokenResponse.ok) {
      if (tokenPayload.error === "authorization_pending") continue
      if (tokenPayload.error === "slow_down") {
        intervalSeconds += 5
        continue
      }
      throw new Error(
        String(
          tokenPayload.error_description ??
            tokenPayload.error ??
            "WorkOS authentication failed."
        )
      )
    }

    const accessToken = tokenPayload.access_token
    const refreshToken = tokenPayload.refresh_token
    if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
      throw new Error("WorkOS returned an invalid authentication response.")
    }
    const session = validateSession(accessToken, organizationId)
    await authStore.write(
      keychainAccount(clientId, organizationId),
      refreshToken
    )
    return session
  }
  throw new Error("WorkOS device authorization expired.")
}

async function getWorkOsCliSession(
  dependencies: Pick<
    AuthDependencies,
    "fetchImpl" | "env" | "authStore"
  >
) {
  const { clientId, organizationId } = requiredConfig(dependencies.env)
  const authStore =
    dependencies.authStore ?? createMacOsKeychainAuthStore()
  const account = keychainAccount(clientId, organizationId)
  const refreshToken = await authStore.read(account)
  if (!refreshToken) {
    throw new Error(
      "No WorkOS CLI session found. Run `content-requests auth login`."
    )
  }

  const response = await dependencies.fetchImpl(WORKOS_AUTHENTICATE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      organization_id: organizationId,
    }),
  })
  const payload = await jsonResponse(response)
  if (!response.ok) {
    throw new Error(
      String(
        payload.error_description ??
          payload.error ??
          "WorkOS session refresh failed. Run `content-requests auth login`."
      )
    )
  }
  const accessToken = payload.access_token
  const rotatedRefreshToken = payload.refresh_token
  if (
    typeof accessToken !== "string" ||
    typeof rotatedRefreshToken !== "string"
  ) {
    throw new Error("WorkOS returned an invalid authentication response.")
  }
  const session = validateSession(accessToken, organizationId)
  await authStore.write(account, rotatedRefreshToken)
  return session
}

export async function getWorkOsCliAccessToken(
  dependencies: Pick<
    AuthDependencies,
    "fetchImpl" | "env" | "authStore"
  >
) {
  return (await getWorkOsCliSession(dependencies)).accessToken
}

export async function runWorkOsAuthCommand(
  args: Array<string>,
  dependencies: AuthDependencies
) {
  const [command] = args
  if (command === "logout") {
    const { clientId, organizationId } = requiredConfig(dependencies.env)
    const authStore =
      dependencies.authStore ?? createMacOsKeychainAuthStore()
    await authStore.delete(keychainAccount(clientId, organizationId))
    dependencies.io.writeOut(
      JSON.stringify({
        authenticated: false,
        method: "workos_cli_auth",
      })
    )
    return 0
  }
  const session =
    command === "login"
      ? await loginWithWorkOsDeviceAuth(dependencies)
      : command === "status"
        ? await getWorkOsCliSession(dependencies)
        : undefined
  if (!session) throw new Error(`Unknown auth command: ${command ?? ""}`)
  dependencies.io.writeOut(
    JSON.stringify({
      authenticated: true,
      method: "workos_cli_auth",
      organizationId: session.organizationId,
      role: session.role,
      expiresAt: session.expiresAt,
    })
  )
  return 0
}
