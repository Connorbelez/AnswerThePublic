import { getRequestUrl } from "@tanstack/react-start/server"

/**
 * WorkOS logout `return_to` must be an absolute URL on the allowlist.
 * Relative paths like "/" resolve to the WorkOS App Homepage (often production).
 */
export function resolveWorkosLogoutReturnTo(pathname = "/"): string {
  if (/^[\\/]{2}/.test(pathname)) {
    throw new Error(
      "WorkOS logout return path cannot be a network-path reference."
    )
  }
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`

  try {
    return resolveSameOrigin(normalizedPath, getRequestUrl())
  } catch {
    // Loader/server-fn context without a request should still avoid relative paths.
  }

  const configuredAppUrl = process.env.FAIRLEND_APP_URL?.trim()
  if (configuredAppUrl) {
    try {
      return resolveSameOrigin(normalizedPath, new URL(configuredAppUrl))
    } catch {
      // Continue to the configured redirect URI when the app URL is invalid.
    }
  }

  const redirectUri = process.env.WORKOS_REDIRECT_URI?.trim()
  if (redirectUri) {
    try {
      return resolveSameOrigin(normalizedPath, new URL(redirectUri))
    } catch {
      // Fall through to the explicit configuration error.
    }
  }

  throw new Error(
    "Unable to resolve an absolute WorkOS logout return URL. Set FAIRLEND_APP_URL or WORKOS_REDIRECT_URI."
  )
}

function resolveSameOrigin(pathname: string, baseUrl: URL) {
  const baseOrigin = baseUrl.origin
  const resolved = new URL(pathname, baseOrigin)
  if (resolved.origin !== baseOrigin) {
    throw new Error("WorkOS logout return URL must remain on the app origin.")
  }
  return resolved.toString()
}
