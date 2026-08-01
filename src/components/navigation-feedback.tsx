import { useEffect, useRef, useState } from "react"
import { useRouterState } from "@tanstack/react-router"

function isInternalNavigation(event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false
  }
  const target = event.target
  const anchor =
    target instanceof Element
      ? target.closest<HTMLAnchorElement>("a[href]")
      : null
  if (!anchor || anchor.target || anchor.hasAttribute("download")) return false
  const destination = new URL(anchor.href, window.location.href)
  if (
    destination.origin !== window.location.origin ||
    `${destination.pathname}${destination.search}` ===
      `${window.location.pathname}${window.location.search}`
  ) {
    return false
  }
  return true
}

function showImmediateNavigationFeedback(event: MouseEvent) {
  if (!isInternalNavigation(event)) return
  document
    .querySelector(".navigation-progress")
    ?.setAttribute("data-loading", "true")
}

if (typeof document !== "undefined") {
  const navigationWindow = window as Window & {
    __fairlendNavigationFeedbackInstalled?: boolean
  }
  if (!navigationWindow.__fairlendNavigationFeedbackInstalled) {
    navigationWindow.__fairlendNavigationFeedbackInstalled = true
    document.addEventListener("click", showImmediateNavigationFeedback, true)
  }
}

export function NavigationFeedback() {
  const isLoading = useRouterState({ select: (state) => state.isLoading })
  const [interactionPending, setInteractionPending] = useState(false)
  const progressRef = useRef<HTMLDivElement>(null)
  const loading = isLoading || interactionPending

  useEffect(() => {
    if (!isLoading) {
      progressRef.current?.setAttribute("data-loading", "false")
    }
  }, [isLoading])

  useEffect(() => {
    let clearTimer: number | undefined
    const retainImmediateFeedback = (event: MouseEvent) => {
      if (!isInternalNavigation(event)) return
      setInteractionPending(true)
      window.clearTimeout(clearTimer)
      clearTimer = window.setTimeout(() => setInteractionPending(false), 400)
    }
    document.addEventListener("click", retainImmediateFeedback, true)
    return () => {
      document.removeEventListener("click", retainImmediateFeedback, true)
      window.clearTimeout(clearTimer)
    }
  }, [])

  return (
    <>
      <div
        ref={progressRef}
        className="navigation-progress"
        data-loading={String(loading)}
        aria-hidden="true"
      >
        <span />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {loading ? "Loading page" : "Page loaded"}
      </span>
    </>
  )
}
