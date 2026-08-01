import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { readdir, readFile } from "node:fs/promises"

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type BrowserContext, type Page } from "@playwright/test"

const organizationId = "org_fairlend"
const authKey = "local-playwright-only"
const auditLabel = process.env.APPLICATION_AUDIT_LABEL ?? "current"
const enforce = process.env.APPLICATION_AUDIT_ENFORCE === "true"
const auditTheme =
  process.env.APPLICATION_AUDIT_THEME === "dark" ? "dark" : "light"

function pathname(value: string) {
  try {
    return new URL(value).pathname
  } catch (error) {
    throw new Error("Playwright returned an invalid page URL.", {
      cause: error,
    })
  }
}

type RouteMetric = {
  route: string
  finalUrl: string
  visibleMs: number
  lcpMs: number
  cls: number
  longTasks: number
  transferredBytes: number
  encodedBytes: number
  horizontalOverflow: number
  accessibilityViolations: Array<{
    id: string
    impact: string | null
    nodes: number
    targets: Array<Array<string>>
    snippets: Array<string>
  }>
}

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

async function installObservers(context: BrowserContext) {
  await context.addInitScript(() => {
    const quality = {
      cls: 0,
      lcp: 0,
      longTasks: 0,
    }
    Object.defineProperty(window, "__fairlendQuality", {
      configurable: true,
      value: quality,
    })
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            hadRecentInput?: boolean
            value?: number
          }
          if (!shift.hadRecentInput) quality.cls += shift.value ?? 0
        }
      }).observe({ type: "layout-shift", buffered: true })
      new PerformanceObserver((list) => {
        const entries = list.getEntries()
        quality.lcp = entries.at(-1)?.startTime ?? quality.lcp
      }).observe({ type: "largest-contentful-paint", buffered: true })
      new PerformanceObserver((list) => {
        quality.longTasks += list.getEntries().length
      }).observe({ type: "longtask", buffered: true })
    } catch {
      // Unsupported performance entries stay at zero and are reported as such.
    }
  })
}

async function auditRoute({
  page,
  route,
  screenshotPath,
  prepare,
}: {
  page: Page
  route: string
  screenshotPath: string
  prepare?: (page: Page) => Promise<void>
}): Promise<RouteMetric> {
  const startedAt = performance.now()
  await page.goto(route, { waitUntil: "domcontentloaded" })
  await page.locator("body").waitFor({ state: "visible" })
  await page.waitForLoadState("load")
  if (prepare) {
    await prepare(page)
  } else {
    await page.waitForFunction(
      () =>
        document.readyState === "complete" &&
        !document.querySelector('main[aria-busy="true"]'),
      undefined,
      { timeout: 60_000 }
    )
  }
  const visibleMs = performance.now() - startedAt
  await page.waitForTimeout(180)

  const accessibility = await new AxeBuilder({ page }).analyze()
  const runtime = await page.evaluate(() => {
    const quality = (
      window as Window & {
        __fairlendQuality?: {
          cls: number
          lcp: number
          longTasks: number
        }
      }
    ).__fairlendQuality ?? { cls: 0, lcp: 0, longTasks: 0 }
    const resources = performance.getEntriesByType(
      "resource"
    ) as Array<PerformanceResourceTiming>
    return {
      ...quality,
      transferredBytes: resources.reduce(
        (total, resource) => total + resource.transferSize,
        0
      ),
      encodedBytes: resources.reduce(
        (total, resource) => total + resource.encodedBodySize,
        0
      ),
      horizontalOverflow: Math.max(
        0,
        document.documentElement.scrollWidth - window.innerWidth
      ),
    }
  })

  await page.screenshot({ path: screenshotPath, fullPage: false })

  return {
    route,
    finalUrl: pathname(page.url()),
    visibleMs: Math.round(visibleMs * 10) / 10,
    lcpMs: Math.round(runtime.lcp * 10) / 10,
    cls: Math.round(runtime.cls * 10_000) / 10_000,
    longTasks: runtime.longTasks,
    transferredBytes: runtime.transferredBytes,
    encodedBytes: runtime.encodedBytes,
    horizontalOverflow: runtime.horizontalOverflow,
    accessibilityViolations: accessibility.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      nodes: violation.nodes.length,
      targets: violation.nodes.map((node) => node.target.map(String)),
      snippets: violation.nodes.map((node) => node.html),
    })),
  }
}

async function bundleMetrics() {
  const directory = path.join(process.cwd(), "dist", "client", "assets")
  const entries = await readdir(directory)
  const assets = await Promise.all(
    entries
      .filter((entry) => /\.(?:css|js|wasm)$/.test(entry))
      .map(async (entry) => {
        const content = await readFile(path.join(directory, entry))
        return {
          file: entry,
          kind: entry.endsWith(".wasm") ? "wasm" : "executable",
          bytes: content.byteLength,
          gzipBytes: gzipSync(content).byteLength,
        }
      })
  )
  assets.sort((left, right) => right.bytes - left.bytes)
  const executableAssets = assets.filter((asset) => asset.kind === "executable")
  const deferredBinaryAssets = assets.filter((asset) => asset.kind === "wasm")
  return {
    assetCount: assets.length,
    totalBytes: assets.reduce((total, asset) => total + asset.bytes, 0),
    totalGzipBytes: assets.reduce((total, asset) => total + asset.gzipBytes, 0),
    executableBytes: executableAssets.reduce(
      (total, asset) => total + asset.bytes,
      0
    ),
    executableGzipBytes: executableAssets.reduce(
      (total, asset) => total + asset.gzipBytes,
      0
    ),
    deferredBinaryBytes: deferredBinaryAssets.reduce(
      (total, asset) => total + asset.bytes,
      0
    ),
    deferredBinaryGzipBytes: deferredBinaryAssets.reduce(
      (total, asset) => total + asset.gzipBytes,
      0
    ),
    largestAssets: assets.slice(0, 12),
  }
}

test("audits every canonical application surface", async ({
  browser,
}, testInfo) => {
  // The desktop project runs after the complete mobile project against the
  // intentionally shared in-memory workspace, so its canonical route audit
  // can traverse substantially more accumulated requests.
  // WebKit's axe traversal is materially slower than Chromium's across the
  // complete canonical route matrix. Keep one shared audit fixture, but leave
  // enough headroom to inspect rendered application surfaces instead of
  // timing out on a later scenario.
  test.setTimeout(720_000)
  const mobile = testInfo.project.name.includes("mobile")
  const viewport = mobile
    ? { width: 432, height: 910 }
    : { width: 1536, height: 1024 }
  const outputDirectory = path.join(
    process.cwd(),
    "docs",
    "application-audit",
    auditLabel,
    testInfo.project.name
  )
  await mkdir(outputDirectory, { recursive: true })

  const founderSubject = `quality_founder_${testInfo.project.name}`
  const operatorSubject = `quality_operator_${testInfo.project.name}`
  const contexts: Array<BrowserContext> = []
  const createContext = async (
    options?: Parameters<typeof browser.newContext>[0]
  ) => {
    const context = await browser.newContext({ viewport, ...options })
    contexts.push(context)
    await context.addInitScript((theme) => {
      localStorage.setItem("fairlend-theme", theme)
    }, auditTheme)
    await installObservers(context)
    return context
  }

  const publicContext = await createContext()
  const operatorContext = await createContext({
    extraHTTPHeaders: identityHeaders(
      operatorSubject,
      "Connor Beleznay",
      "operator-editor"
    ),
  })
  const founderContext = await createContext({
    extraHTTPHeaders: identityHeaders(founderSubject, "Elie", "founder"),
  })
  const agentContext = await createContext({
    extraHTTPHeaders: identityHeaders(
      `quality_agent_${testInfo.project.name}`,
      "Editorial agent",
      "agent-editor"
    ),
  })
  const adminContext = await createContext({
    extraHTTPHeaders: identityHeaders(
      `quality_admin_${testInfo.project.name}`,
      "QA administrator",
      "administrator"
    ),
  })

  const founderSetupPage = await founderContext.newPage()
  await founderSetupPage.goto("/app")
  await founderSetupPage.close()

  const fixtureTitle = `Application quality fixture ${testInfo.project.name}`
  const fixtureResponse = await operatorContext.request.post(
    "/api/e2e/automated-request",
    {
      data: {
        title: fixtureTitle,
        assigneeSubject: founderSubject,
      },
    }
  )
  expect(fixtureResponse.status()).toBe(201)
  const fixture = (await fixtureResponse.json()) as {
    data: { humanId: string }
  }
  const shareResponse = await operatorContext.request.post(
    "/api/e2e/public-share",
    { data: { action: "create" } }
  )
  expect(shareResponse.status()).toBe(201)
  const share = (await shareResponse.json()) as {
    data: { token: string }
  }

  const scenarios: Array<{
    name: string
    context: BrowserContext
    route: string
    prepare?: (page: Page) => Promise<void>
  }> = [
    {
      name: "sign-in",
      context: publicContext,
      route: "/sign-in",
    },
    {
      name: "unauthorized",
      context: publicContext,
      route: "/unauthorized",
    },
    {
      name: "not-found",
      context: publicContext,
      route: "/route-that-does-not-exist",
    },
    {
      name: "operator-library",
      context: operatorContext,
      route: "/app",
    },
    {
      name: "operator-create",
      context: operatorContext,
      route: "/app/new",
    },
    {
      name: "operator-request",
      context: operatorContext,
      route: `/app/requests/${fixture.data.humanId}`,
      prepare: async (page) => {
        await page
          .getByRole("button", { name: "Promote to Elie", exact: true })
          .waitFor({ state: "visible", timeout: 90_000 })
      },
    },
    {
      name: "founder-library",
      context: founderContext,
      route: "/app",
    },
    {
      name: "founder-request",
      context: founderContext,
      route: `/app/requests/${fixture.data.humanId}`,
      prepare: async (page) => {
        await page
          .getByRole("button", { name: "Record input", exact: true })
          .waitFor({ state: "visible", timeout: 90_000 })
      },
    },
    {
      name: "agent-library",
      context: agentContext,
      route: "/app",
    },
    {
      name: "administrator-library",
      context: adminContext,
      route: "/app",
    },
    {
      name: "public-share",
      context: publicContext,
      route: `/share/${share.data.token}`,
    },
  ]

  const metrics: Array<RouteMetric> = []
  for (const scenario of scenarios) {
    const page = await scenario.context.newPage()
    metrics.push(
      await auditRoute({
        page,
        route: scenario.route,
        screenshotPath: path.join(outputDirectory, `${scenario.name}.png`),
        prepare: scenario.prepare,
      })
    )
    if (scenario.name === "founder-request") {
      await page.getByRole("button", { name: "Record input" }).click()
      await expect(
        page.getByRole("button", { name: "Press to record" })
      ).toBeVisible()
      await page.screenshot({
        path: path.join(outputDirectory, "founder-record.png"),
        fullPage: false,
      })
      if (enforce) {
        const recordingAccessibility = await new AxeBuilder({ page }).analyze()
        expect(recordingAccessibility.violations).toEqual([])
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth
          )
        ).toBe(0)
      }
    }
    await page.close()
  }

  if (!mobile) {
    const tabletPage = await operatorContext.newPage()
    await tabletPage.setViewportSize({ width: 834, height: 1112 })
    metrics.push(
      await auditRoute({
        page: tabletPage,
        route: `/app/requests/${fixture.data.humanId}`,
        screenshotPath: path.join(
          outputDirectory,
          "operator-request-tablet.png"
        ),
      })
    )
    await tabletPage.close()
  }

  const navigationPage = await operatorContext.newPage()
  await navigationPage.goto("/app")
  await expect(navigationPage.locator(".navigation-progress")).toHaveAttribute(
    "data-loading",
    "false"
  )
  await expect(
    navigationPage.getByRole("button", { name: "Notifications" })
  ).toBeEnabled({ timeout: 90_000 })
  const navigationLinks = navigationPage.locator('a[href="/app/new"]')
  const navigationLink = mobile
    ? navigationLinks.last()
    : navigationLinks.first()
  const destinationPath = "/app/new"
  await navigationPage.evaluate(() => {
    sessionStorage.removeItem("fairlend:audit:navigation-clicked-at")
    sessionStorage.removeItem("fairlend:audit:navigation-feedback-at")
    const progress = document.querySelector(".navigation-progress")
    if (progress) {
      new MutationObserver(() => {
        if (progress.getAttribute("data-loading") === "true") {
          sessionStorage.setItem(
            "fairlend:audit:navigation-feedback-at",
            String(Date.now())
          )
        }
      }).observe(progress, {
        attributes: true,
        attributeFilter: ["data-loading"],
      })
    }
    document.addEventListener(
      "click",
      () => {
        sessionStorage.setItem(
          "fairlend:audit:navigation-clicked-at",
          String(Date.now())
        )
      },
      { capture: true, once: true }
    )
  })
  const destinationHeading = navigationPage.getByRole("heading", {
    name: "Create a content request",
    level: 1,
  })
  const navigationStartedAt = Date.now()
  const navigation = navigationLink.click()
  await Promise.race([
    navigationPage
      .locator('.navigation-progress[data-loading="true"]')
      .waitFor({ state: "visible" }),
    destinationHeading.waitFor({ state: "visible" }),
  ])
  await navigation
  await expect(navigationPage).toHaveURL(new RegExp(`${destinationPath}$`))
  await expect(destinationHeading).toBeVisible()
  const warmNavigationCompleteMs = Date.now() - navigationStartedAt
  const warmNavigationFeedbackMs = await navigationPage.evaluate(
    (fallbackMs) => {
      const clickedAt = Number(
        sessionStorage.getItem("fairlend:audit:navigation-clicked-at")
      )
      const feedbackAt = Number(
        sessionStorage.getItem("fairlend:audit:navigation-feedback-at")
      )
      return clickedAt > 0 && feedbackAt >= clickedAt
        ? feedbackAt - clickedAt
        : fallbackMs
    },
    warmNavigationCompleteMs
  )
  const warmNavigationVisibleMs = Math.min(
    warmNavigationFeedbackMs,
    warmNavigationCompleteMs
  )
  await navigationPage.close()

  const report = {
    label: auditLabel,
    project: testInfo.project.name,
    viewport,
    capturedAt: new Date().toISOString(),
    bundle: await bundleMetrics(),
    warmNavigationMs: Math.round(warmNavigationVisibleMs * 10) / 10,
    warmNavigationCompleteMs: Math.round(warmNavigationCompleteMs * 10) / 10,
    routes: metrics,
  }
  await writeFile(
    path.join(outputDirectory, "metrics.json"),
    `${JSON.stringify(report, null, 2)}\n`
  )

  if (enforce) {
    expect(metrics.flatMap((metric) => metric.accessibilityViolations)).toEqual(
      []
    )
    expect(metrics.every((metric) => metric.horizontalOverflow === 0)).toBe(
      true
    )
    expect(warmNavigationVisibleMs).toBeLessThan(100)
  }

  for (const context of contexts) await context.close()
})
