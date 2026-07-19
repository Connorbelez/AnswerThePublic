const ASSET_CACHE = "fairlend-assets-v1"
const OWNER_METADATA_CACHE = "fairlend-owner-metadata-v1"
const OWNER_METADATA_URL = "/__fairlend_active_owner__"

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim())
)

async function activeOwner() {
  const cache = await caches.open(OWNER_METADATA_CACHE)
  const response = await cache.match(OWNER_METADATA_URL)
  return response ? response.text() : null
}

async function setActiveOwner(owner) {
  const cache = await caches.open(OWNER_METADATA_CACHE)
  await cache.put(OWNER_METADATA_URL, new Response(owner))
  const expected = `fairlend-pages-${owner}`
  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames
      .filter((name) => name.startsWith("fairlend-pages-") && name !== expected)
      .map((name) => caches.delete(name))
  )
}

async function clearPrivateCaches() {
  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames
      .filter(
        (name) =>
          name.startsWith("fairlend-pages-") || name === OWNER_METADATA_CACHE
      )
      .map((name) => caches.delete(name))
  )
}

function isAuthenticationResponse(response) {
  if (response.status === 401 || response.status === 403) return true
  try {
    const pathname = new URL(response.url).pathname
    return pathname === "/sign-in" || pathname === "/unauthorized"
  } catch {
    return false
  }
}

async function cachePage(url, owner) {
  const response = await fetch(url, { credentials: "include" })
  if (!response.ok || isAuthenticationResponse(response)) {
    if (isAuthenticationResponse(response)) await clearPrivateCaches()
    return
  }
  const cache = await caches.open(`fairlend-pages-${owner}`)
  await cache.put(url, response)
}

self.addEventListener("message", (event) => {
  const data = event.data
  if (!data) return
  if (data.type === "FAIRLEND_CLEAR_PRIVATE") {
    event.waitUntil(
      clearPrivateCaches().then(() => {
        event.source?.postMessage({
          type: "FAIRLEND_PRIVATE_CACHES_CLEARED",
          requestId: data.requestId,
        })
      })
    )
    return
  }
  if (data.type !== "FAIRLEND_SET_OWNER" || !data.owner) return
  event.waitUntil(
    (async () => {
      await setActiveOwner(data.owner)
      if (data.url) await cachePage(data.url, data.owner)
      event.source?.postMessage({
        type: "FAIRLEND_OFFLINE_READY",
        owner: data.owner,
      })
    })()
  )
})

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return
  const request = event.request
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const owner = await activeOwner()
        try {
          const response = await fetch(request)
          if (isAuthenticationResponse(response)) {
            await clearPrivateCaches()
            return response
          }
          if (owner && response.ok) {
            const cache = await caches.open(`fairlend-pages-${owner}`)
            await cache.put(request, response.clone())
          }
          return response
        } catch (error) {
          if (owner) {
            const cache = await caches.open(`fairlend-pages-${owner}`)
            const cached = await cache.match(request)
            if (cached) return cached
          }
          throw error
        }
      })()
    )
    return
  }
  const requestUrl = new URL(request.url)
  if (requestUrl.origin !== self.location.origin) return
  if (
    !requestUrl.pathname.startsWith("/assets/") &&
    !["script", "style", "font", "image", "manifest", "worker"].includes(
      request.destination
    )
  ) {
    return
  }
  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    })
  )
})
