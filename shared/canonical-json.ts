/**
 * Serializes JSON-compatible values with recursively sorted object keys.
 *
 * This is the shared digest boundary for application and Convex runtimes.
 * Undefined object properties are omitted to match JSON.stringify semantics.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`
}
