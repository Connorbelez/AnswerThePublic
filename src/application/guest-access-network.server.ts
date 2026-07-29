type HeaderReader = (name: string) => string | undefined

function cleanNetworkSource(value: string | undefined) {
  const cleaned = value?.trim()
  if (!cleaned || cleaned.length > 256) return null
  return cleaned
}

export function resolveGuestAccessNetworkSource(getHeader: HeaderReader) {
  const cloudflareSource = cleanNetworkSource(getHeader("cf-connecting-ip"))
  if (cloudflareSource) return cloudflareSource

  const forwardedSource = cleanNetworkSource(
    getHeader("x-forwarded-for")?.split(",")[0]
  )
  if (forwardedSource) return forwardedSource

  return "unattributed"
}
