/**
 * Cloudflare Worker entry point for the hosted throwaway prototype.
 * Static assets are authoritative; extensionless routes fall back to the SPA.
 */
export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404 || request.method !== "GET") return response

    const url = new URL(request.url)
    if (url.pathname.split("/").at(-1)?.includes(".")) return response

    return env.ASSETS.fetch(new Request(new URL("/index.html", url), request))
  },
}
