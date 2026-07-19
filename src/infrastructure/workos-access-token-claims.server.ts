export type WorkosAccessTokenClaims = {
  issuer: string | null
  audience: string | string[] | null
  clientId: string | null
}

export function readWorkosAccessTokenClaims(
  accessToken: string
): WorkosAccessTokenClaims {
  try {
    const payloadSegment = accessToken.split(".")[1]
    if (!payloadSegment) throw new Error("JWT payload is missing")
    const payload = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8")
    ) as Record<string, unknown>
    return {
      issuer: typeof payload.iss === "string" ? payload.iss : null,
      audience:
        typeof payload.aud === "string" ||
        (Array.isArray(payload.aud) &&
          payload.aud.every((value) => typeof value === "string"))
          ? (payload.aud as string | string[])
          : null,
      clientId:
        typeof payload.client_id === "string" ? payload.client_id : null,
    }
  } catch {
    return { issuer: null, audience: null, clientId: null }
  }
}
