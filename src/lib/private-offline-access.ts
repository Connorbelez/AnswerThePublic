const PRIVATE_CACHE_PREFIXES = ["fairlend-pages-", "fairlend-owner-metadata-"]

export async function clearPrivateOfflineAccess() {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith("fairlend:founder-offline-draft:")) {
        window.localStorage.removeItem(key)
      }
    }
  } catch {
    // Cache and service-worker purging still protects rendered private pages.
  }
  if ("caches" in window) {
    const cacheNames = await window.caches.keys()
    await Promise.all(
      cacheNames
        .filter((name) =>
          PRIVATE_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix))
        )
        .map((name) => window.caches.delete(name))
    )
  }

  const worker = window.navigator.serviceWorker?.controller
  if (!worker) return
  const requestId = crypto.randomUUID()
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 2_000)
    const receive = (event: MessageEvent) => {
      if (
        event.data?.type !== "FAIRLEND_PRIVATE_CACHES_CLEARED" ||
        event.data.requestId !== requestId
      ) {
        return
      }
      window.clearTimeout(timeout)
      window.navigator.serviceWorker.removeEventListener("message", receive)
      resolve()
    }
    window.navigator.serviceWorker.addEventListener("message", receive)
    worker.postMessage({ type: "FAIRLEND_CLEAR_PRIVATE", requestId })
  })
}
