import { describe, expect, it } from "vitest"

import {
  classifyRequest,
  platformForUrl,
  REQUEST_CATEGORIES,
  REQUEST_CATEGORY_META,
  SOURCE_PLATFORM_META,
} from "../../shared/request-classification"

describe("classifyRequest", () => {
  it("classifies journalist channels as journalist_story", () => {
    for (const channel of [
      "journalist_request",
      "journalist_story_lead",
      "editorial_outreach",
    ]) {
      const result = classifyRequest({
        origin: "automated_scout",
        channel,
        url: "https://example.com/opportunity",
      })
      expect(result.category).toBe("journalist_story")
      expect(result.sourcePlatform).toBe("press")
    }
  })

  it("classifies reddit channel as a community question from reddit", () => {
    expect(
      classifyRequest({
        origin: "automated_scout",
        channel: "reddit",
        url: "https://www.reddit.com/r/personalfinance/comments/abc",
      })
    ).toEqual({ category: "community_question", sourcePlatform: "reddit" })
  })

  it("classifies community channel with a platform URL by host", () => {
    expect(
      classifyRequest({
        origin: "automated_scout",
        channel: "community",
        url: "https://x.com/someone/status/123",
      })
    ).toEqual({ category: "community_question", sourcePlatform: "x" })
  })

  it("treats twitter.com hosts as x", () => {
    expect(platformForUrl("https://twitter.com/a/status/1")).toBe("x")
    expect(platformForUrl("https://mobile.twitter.com/a")).toBe("x")
  })

  it("classifies scout-sourced requests without a channel as community questions", () => {
    expect(classifyRequest({ origin: "automated_scout" })).toEqual({
      category: "community_question",
      sourcePlatform: "community",
    })
  })

  it("classifies direct origins as content requests", () => {
    expect(classifyRequest({ origin: "manual" })).toEqual({
      category: "content_request",
      sourcePlatform: "manual",
    })
    expect(classifyRequest({ origin: "chatgpt_app" })).toEqual({
      category: "content_request",
      sourcePlatform: "chatgpt_app",
    })
    expect(classifyRequest({ origin: "cli" })).toEqual({
      category: "content_request",
      sourcePlatform: "cli",
    })
    expect(classifyRequest({ origin: "http_api" })).toEqual({
      category: "content_request",
      sourcePlatform: "http_api",
    })
  })

  it("lets a community URL win over a direct origin", () => {
    expect(
      classifyRequest({
        origin: "manual",
        url: "https://www.linkedin.com/posts/abc",
      })
    ).toEqual({ category: "community_question", sourcePlatform: "linkedin" })
  })

  it("never throws on junk input", () => {
    expect(
      classifyRequest({ origin: "unknown", channel: "  ", url: "not a url" })
    ).toEqual({ category: "content_request", sourcePlatform: "other" })
  })

  it("keeps metadata complete for every category and platform", () => {
    for (const category of REQUEST_CATEGORIES) {
      expect(REQUEST_CATEGORY_META[category].label).toBeTruthy()
    }
    for (const platform of Object.keys(SOURCE_PLATFORM_META)) {
      expect(
        SOURCE_PLATFORM_META[platform as keyof typeof SOURCE_PLATFORM_META]
          .label
      ).toBeTruthy()
    }
  })
})
