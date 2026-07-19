const PRIVATE_CACHE_PREFIXES = ["fairlend-pages-", "fairlend-owner-metadata-"]

function offlineOwnerNamespace(value: string) {
  let binary = ""
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

function deleteDatabase(name: string) {
  return new Promise<void>((resolve) => {
    const operation = indexedDB.deleteDatabase(name)
    operation.onsuccess = () => resolve()
    operation.onerror = () => resolve()
    operation.onblocked = () => resolve()
  })
}

export async function clearPrivateOfflineAccess(ownerKey?: string) {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith("fairlend:founder-offline-draft:")) {
        window.localStorage.removeItem(key)
      }
      if (key?.startsWith("fairlend:voice-transcript-appended:")) {
        window.localStorage.removeItem(key)
      }
    }
  } catch {
    // Cache and service-worker purging still protects rendered private pages.
  }
  if ("indexedDB" in window) {
    if (ownerKey) {
      await deleteDatabase(
        `fairlend-founder-voice-${offlineOwnerNamespace(ownerKey)}`
      )
    } else if (typeof window.indexedDB.databases === "function") {
      const databases = await window.indexedDB.databases()
      await Promise.all(
        databases
          .map((database) => database.name)
          .filter(
            (name): name is string =>
              typeof name === "string" &&
              name.startsWith("fairlend-founder-voice-")
          )
          .map(deleteDatabase)
      )
    }
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
