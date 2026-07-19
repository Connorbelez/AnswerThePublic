export function contentRequestCreationDefaults(now: number) {
  return {
    humanId: "pending",
    lifecycle: "pending" as const,
    disposition: "active" as const,
    retention: "active" as const,
    activeVoiceCaptureCount: 0,
    voiceCaptureCountGeneration: 0,
    aggregateVersion: 1,
    watcherPrincipalIds: [],
    createdAt: now,
    updatedAt: now,
  }
}
