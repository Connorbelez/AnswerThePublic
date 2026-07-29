export type QueuedVoiceCapture = {
  requestHumanId: string
  clientCaptureId: string
  blob: Blob
  mimeType: string
  durationMs: number
  createdAt: number
  storageId?: string
  metadata?: Record<string, string>
}

export type VoiceCaptureQueue = {
  put(capture: QueuedVoiceCapture): Promise<void>
  list(requestHumanId: string): Promise<Array<QueuedVoiceCapture>>
  remove(clientCaptureId: string): Promise<void>
}

type StoredVoiceCapture = Omit<QueuedVoiceCapture, "blob"> & {
  blob?: Blob
  blobBytes?: ArrayBuffer | Uint8Array<ArrayBuffer>
}

function namespace(value: string) {
  let binary = ""
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

function request<T>(operation: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result)
    operation.onerror = () => reject(operation.error)
  })
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export function createVoiceCaptureQueue(ownerKey: string): VoiceCaptureQueue {
  const databaseName = `fairlend-founder-voice-${namespace(ownerKey)}`
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const operation = indexedDB.open(databaseName, 1)
      operation.onupgradeneeded = () => {
        if (!operation.result.objectStoreNames.contains("captures")) {
          operation.result.createObjectStore("captures", {
            keyPath: "clientCaptureId",
          })
        }
      }
      operation.onsuccess = () => resolve(operation.result)
      operation.onerror = () => reject(operation.error)
    })

  return {
    async put(capture) {
      const { blob, ...metadata } = capture
      const stored: StoredVoiceCapture = {
        ...metadata,
        // WebKit's IndexedDB structured clone is more reliable for typed
        // arrays than for Blob or bare ArrayBuffer values while offline.
        blobBytes: new Uint8Array(await blob.arrayBuffer()),
      }
      const database = await open()
      try {
        const transaction = database.transaction("captures", "readwrite")
        const completed = transactionComplete(transaction)
        transaction.objectStore("captures").put(stored)
        await completed
      } finally {
        database.close()
      }
    },
    async list(requestHumanId) {
      const database = await open()
      try {
        const transaction = database.transaction("captures", "readonly")
        const completed = transactionComplete(transaction)
        const [captures] = await Promise.all([
          request<StoredVoiceCapture[]>(
            transaction.objectStore("captures").getAll()
          ),
          completed,
        ])
        return captures
          .filter(
            (capture) =>
              capture.requestHumanId === requestHumanId.trim().toUpperCase()
          )
          .map((capture) => ({
            ...capture,
            blob:
              capture.blob ??
              new Blob([capture.blobBytes ?? new ArrayBuffer(0)], {
                type: capture.mimeType,
              }),
          }))
          .sort((left, right) => left.createdAt - right.createdAt)
      } finally {
        database.close()
      }
    },
    async remove(clientCaptureId) {
      const database = await open()
      try {
        const transaction = database.transaction("captures", "readwrite")
        const completed = transactionComplete(transaction)
        transaction.objectStore("captures").delete(clientCaptureId)
        await completed
      } finally {
        database.close()
      }
    },
  }
}
