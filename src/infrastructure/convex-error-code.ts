const EXPECTED_ACCESS_DENIALS = new Set([
  "ROLE_ACCESS_DENIED",
  "ORGANIZATION_ACCESS_DENIED",
  "APPLICATION_ACCESS_DENIED",
])

export function convexErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    typeof error.data.code === "string"
  ) {
    return error.data.code
  }

  const message = String(error)
  for (const code of EXPECTED_ACCESS_DENIALS) {
    if (message.includes(code)) return code
  }
  return null
}

export function isExpectedProvisioningAccessDenial(error: unknown): boolean {
  const code = convexErrorCode(error)
  return code !== null && EXPECTED_ACCESS_DENIALS.has(code)
}
