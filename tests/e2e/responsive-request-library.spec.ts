import { expect, test } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

const organizationId = "org_fairlend"
const authKey = "local-playwright-only"

function identityHeaders(
  subject: string,
  displayName: string,
  workosRole: string
) {
  return {
    "x-fairlend-e2e-key": authKey,
    "x-fairlend-e2e-user": JSON.stringify({
      subject,
      organizationId,
      email: `${subject}@fairlend.ca`,
      displayName,
      workosRole,
    }),
  }
}

test("the request library has no horizontal overflow at responsive widths", async ({
  browser,
}, testInfo) => {
  const founderSubject = `responsive_founder_${testInfo.project.name}`
  const founderContext = await browser.newContext({
    extraHTTPHeaders: identityHeaders(founderSubject, "Elie", "founder"),
  })
  const page = await founderContext.newPage()
  await page.goto("/app")

  const operatorContext = await browser.newContext({
    extraHTTPHeaders: identityHeaders(
      `responsive_operator_${testInfo.project.name}`,
      "Responsive Operator",
      "operator-editor"
    ),
  })
  const operatorPage = await operatorContext.newPage()
  const titles = [
    `Paying off an Ontario mortgage: zero balance versus registered discharge — ${"with-an-unbroken-segment-".repeat(3)}`,
  ]

  for (const title of titles) {
    const response = await operatorPage.request.post(
      "/api/e2e/automated-request",
      {
        data: { title, assigneeSubject: founderSubject },
      }
    )
    expect(response.status()).toBe(201)
  }

  for (const width of [320, 390, 432, 466, 768]) {
    await operatorPage.setViewportSize({ width, height: 900 })
    await operatorPage.goto("/app")

    const actionQueues = operatorPage.getByRole("form", {
      name: "Operator action queues",
    })
    await expect(actionQueues).toBeVisible()
    const actionQueueMetrics = await actionQueues.evaluate((element) => {
      const containerBounds = element.getBoundingClientRect()
      return {
        documentOverflow:
          document.documentElement.scrollWidth - window.innerWidth,
        formOverflow: element.scrollWidth - element.clientWidth,
        childrenOutsideForm: Array.from(
          element.querySelectorAll<HTMLElement>("*")
        )
          .filter((child) => {
            if (child.getClientRects().length === 0) return false
            const bounds = child.getBoundingClientRect()
            return (
              bounds.left < containerBounds.left - 0.5 ||
              bounds.right > containerBounds.right + 0.5
            )
          })
          .map((child) => child.getAttribute("aria-label") ?? child.className)
          .slice(0, 10),
      }
    })
    expect(actionQueueMetrics, `operator filters at width: ${width}`).toEqual({
      documentOverflow: 0,
      formOverflow: 0,
      childrenOutsideForm: [],
    })

    await page.setViewportSize({ width, height: 900 })
    await page.goto("/app")

    const requestList = page.getByRole("region", {
      name: "Content requests",
    })
    await expect(requestList).toHaveAttribute("data-view", "stack")
    await expect(requestList.getByRole("link")).toHaveCount(titles.length)

    const metrics = await requestList.evaluate((element) => {
      const containerBounds = element.getBoundingClientRect()
      const cards = Array.from(element.children)
      return {
        documentOverflow:
          document.documentElement.scrollWidth - window.innerWidth,
        listOverflow: element.scrollWidth - element.clientWidth,
        hasHorizontalScrollSnap:
          getComputedStyle(element).scrollSnapType.includes("x"),
        cardsInsideContainer: cards.every((card) => {
          const bounds = card.getBoundingClientRect()
          return (
            bounds.left >= containerBounds.left - 0.5 &&
            bounds.right <= containerBounds.right + 0.5
          )
        }),
        contentFitsCards: cards.every(
          (card) => card.scrollWidth <= card.clientWidth
        ),
      }
    })

    expect(metrics, `viewport width: ${width}`).toEqual({
      documentOverflow: 0,
      listOverflow: 0,
      hasHorizontalScrollSnap: false,
      cardsInsideContainer: true,
      contentFitsCards: true,
    })

    await page.getByRole("button", { name: "Grid view" }).click()
    await expect(requestList).toHaveAttribute("data-view", "grid")
    const gridMetrics = await requestList.evaluate((element) => ({
      documentOverflow:
        document.documentElement.scrollWidth - window.innerWidth,
      listOverflow: element.scrollWidth - element.clientWidth,
      columns:
        getComputedStyle(element).gridTemplateColumns.split(/\s+/).length,
      clippedHorizontally: Array.from(
        element.querySelectorAll<HTMLElement>(".request-card *")
      )
        .filter(
          (child) =>
            !child.classList.contains("sr-only") &&
            getComputedStyle(child).display !== "none" &&
            child.scrollWidth > child.clientWidth + 1
        )
        .map((child) => child.className)
        .slice(0, 10),
    }))
    expect(gridMetrics, `grid viewport width: ${width}`).toEqual({
      documentOverflow: 0,
      listOverflow: 0,
      columns: width >= 640 ? 2 : 1,
      clippedHorizontally: [],
    })
  }

  await founderContext.close()
  await operatorContext.close()
})

test("the administrator shell reflows and remains accessible in dark mode", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 720 },
    extraHTTPHeaders: identityHeaders(
      `responsive_admin_${testInfo.project.name}`,
      "Administrator With A Long Name",
      "admin"
    ),
  })
  await context.addInitScript(() => {
    localStorage.setItem("fairlend-theme", "dark")
  })
  const page = await context.newPage()

  await page.goto("/app")
  await expect(
    page.getByRole("heading", { name: "Content requests" })
  ).toBeVisible()
  await expect(page.locator("html")).toHaveClass(/dark/)

  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(documentOverflow).toBe(0)

  await page.getByRole("button", { name: "Open navigation" }).click()
  await expect(page.getByRole("heading", { name: "Navigation" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "View Elie’s workspace" })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible()
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Notifications" }).click()
  const popoverBounds = await page
    .locator('[data-slot="popover-content"]')
    .evaluate((element) => element.getBoundingClientRect().toJSON())
  expect(popoverBounds.x).toBeGreaterThanOrEqual(0)
  expect(popoverBounds.x + popoverBounds.width).toBeLessThanOrEqual(320)
  await page.keyboard.press("Escape")
  await expect(page.locator('[data-slot="popover-content"]')).toBeHidden()
  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(accessibility.violations).toEqual([])

  await page.locator("html").evaluate((element) => {
    element.style.fontSize = "200%"
  })
  const zoomedLayout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    offenders: Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        if (
          element.classList.contains("sr-only") ||
          element.hasAttribute("data-base-ui-focus-guard")
        ) {
          return false
        }
        const bounds = element.getBoundingClientRect()
        return bounds.left < -0.5 || bounds.right > window.innerWidth + 0.5
      })
      .slice(0, 8)
      .map((element) => ({
        selector:
          element instanceof HTMLElement
            ? `${element.tagName.toLowerCase()}.${element.className}`
            : element.tagName.toLowerCase(),
        bounds: element.getBoundingClientRect().toJSON(),
      })),
  }))
  expect(zoomedLayout).toEqual({ overflow: 0, offenders: [] })

  await context.close()
})
