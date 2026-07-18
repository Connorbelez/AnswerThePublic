import type { ContentRequest } from "@/application/content-requests"

const originLabels = {
  manual: "Manual",
  automated_scout: "Scout",
  chatgpt_app: "ChatGPT App",
  cli: "CLI",
  http_api: "HTTP API",
} satisfies Record<ContentRequest["origin"], string>

const priorityLabels = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
} satisfies Record<ContentRequest["priority"], string>

export function requestOriginLabel(origin: ContentRequest["origin"]) {
  return originLabels[origin]
}

export function requestPriorityLabel(priority: ContentRequest["priority"]) {
  return priorityLabels[priority]
}
