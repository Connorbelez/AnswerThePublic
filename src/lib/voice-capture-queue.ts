export type QueuedVoiceCapture = {
  requestHumanId: string
  clientCaptureId: string
  blob: Blob
  mimeType: string
  durationMs: number
  createdAt: number
  storageId?: string
}

export type VoiceCaptureQueue = {
  put(capture: QueuedVoiceCapture): Promise<void>
  list(requestHumanId: string): Promise<Array<QueuedVoiceCapture>>
  remove(clientCaptureId: string): Promise<void>
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
      const database = await open()
      try {
        const transaction = database.transaction("captures", "readwrite")
        transaction.objectStore("captures").put(capture)
        await transactionComplete(transaction)
      } finally {
        database.close()
      }
    },
    async list(requestHumanId) {
      const database = await open()
      try {
        const transaction = database.transaction("captures", "readonly")
        const captures = await request<QueuedVoiceCapture[]>(
          transaction.objectStore("captures").getAll()
        )
        await transactionComplete(transaction)
        return captures
          .filter(
            (capture) =>
              capture.requestHumanId === requestHumanId.trim().toUpperCase()
          )
          .sort((left, right) => left.createdAt - right.createdAt)
      } finally {
        database.close()
      }
    },
    async remove(clientCaptureId) {
      const database = await open()
      try {
        const transaction = database.transaction("captures", "readwrite")
        transaction.objectStore("captures").delete(clientCaptureId)
        await transactionComplete(transaction)
      } finally {
        database.close()
      }
    },
  }
}
