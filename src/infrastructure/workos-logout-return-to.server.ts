import { getRequestUrl } from "@tanstack/react-start/server"

/**
 * WorkOS logout `return_to` must be an absolute URL on the allowlist.
 * Relative paths like "/" resolve to the WorkOS App Homepage (often production).
 */
export function resolveWorkosLogoutReturnTo(pathname = "/"): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`

  try {
    return new URL(normalizedPath, getRequestUrl().origin).toString()
  } catch {
    // Loader/server-fn context without a request should still avoid relative paths.
  }

  const configuredAppUrl = process.env.FAIRLEND_APP_URL?.trim()
  if (configuredAppUrl) {
    return new URL(normalizedPath, configuredAppUrl).toString()
  }

  const redirectUri = process.env.WORKOS_REDIRECT_URI?.trim()
  if (redirectUri) {
    return new URL(normalizedPath, redirectUri).toString()
  }

  throw new Error(
    "Unable to resolve an absolute WorkOS logout return URL. Set FAIRLEND_APP_URL or WORKOS_REDIRECT_URI."
  )
}
