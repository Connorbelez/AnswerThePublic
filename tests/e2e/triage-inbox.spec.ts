import { mkdir } from "node:fs/promises"
import path from "node:path"

import { expect, test } from "@playwright/test"

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

function contrastRatio(foreground: string, background: string) {
  const channels = (value: string) =>
    (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
  const luminance = (value: string) => {
    const rgb = channels(value).map((channel) => channel / 255)
    const linear = rgb.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    )
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

test("operator triages a scout opportunity on desktop and mobile", async ({
  browser,
}, testInfo) => {
  const founderSubject = `triage_founder_${testInfo.project.name}`
  const founderContext = await browser.newContext({
    extraHTTPHeaders: identityHeaders(founderSubject, "Elie", "founder"),
  })
  const founderPage = await founderContext.newPage()
  await founderPage.goto("/app")
  await expect(founderPage.getByText("FairLend")).toBeVisible()

  const operatorContext = await browser.newContext({
    extraHTTPHeaders: identityHeaders(
      `triage_operator_${testInfo.project.name}`,
      "Connor Beleznay",
      "operator-editor"
    ),
  })
  const page = await operatorContext.newPage()
  const browserErrors: Array<string> = []
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text())
  })
  page.on("pageerror", (error) => browserErrors.push(error.message))
  const title =
    "Paying off an Ontario mortgage: zero balance versus registered discharge"
  const fixtureResponse = await page.request.post(
    "/api/e2e/automated-request",
    {
      data: {
        title,
        assigneeSubject: founderSubject,
        includeDraft: false,
      },
    }
  )
  expect(fixtureResponse.status()).toBe(201)
  const fixture = (await fixtureResponse.json()) as {
    data: { humanId: string }
  }

  const mobile = testInfo.project.name.includes("mobile")
  await page.setViewportSize(
    mobile ? { width: 432, height: 910 } : { width: 1536, height: 1024 }
  )
  await page.goto(`/app/requests/${fixture.data.humanId}`)

  await expect(
    page.getByRole("heading", {
      name: title,
    })
  ).toBeVisible()
  const navigationTrigger = page.getByRole("button", {
    name: "Open navigation",
  })
  if (mobile) {
    await expect(navigationTrigger).toBeVisible()
    const actionBar = page.getByLabel("Opportunity actions")
    await expect(actionBar.getByText("Elie", { exact: true })).toBeVisible()
    await expect(
      actionBar.getByRole("button", { name: "Promote to Elie" })
    ).toBeVisible()
    await expect(
      actionBar.getByRole("button", { name: "Pass on opportunity" })
    ).toBeVisible()
    await page
      .getByRole("button", { name: "Review 3 selected outputs" })
      .click()
    const mobileDecision = page
      .getByLabel("Route opportunity")
      .filter({ visible: true })
    await expect(
      mobileDecision.getByText("Blog article", { exact: true })
    ).toBeVisible()
    await expect(
      mobileDecision.getByText("LinkedIn post", { exact: true })
    ).toBeVisible()
    await page.keyboard.press("Escape")
  } else {
    await expect(navigationTrigger).toBeHidden()
    const desktopDecision = page
      .getByLabel("Route opportunity")
      .filter({ visible: true })
    await expect(
      desktopDecision.getByText("Elie", { exact: true })
    ).toBeVisible()
    await expect(
      desktopDecision.getByText("Blog article", { exact: true })
    ).toBeVisible()
    await expect(
      desktopDecision.getByText("LinkedIn post", { exact: true })
    ).toBeVisible()
    const collapse = page.getByRole("button", {
      name: "Collapse opportunity queue",
    })
    await collapse.click()
    await expect(
      page.getByRole("button", { name: "Expand opportunity queue" })
    ).toBeVisible()
    await page.getByRole("button", { name: "Expand opportunity queue" }).click()
    await expect(
      page.getByRole("button", { name: "Collapse opportunity queue" })
    ).toBeVisible()
    await page.waitForTimeout(220)
  }

  const screenshotDirectory = path.join(process.cwd(), "docs", "mockups")
  await mkdir(screenshotDirectory, { recursive: true })
  await page.screenshot({
    path: path.join(
      screenshotDirectory,
      mobile
        ? "triage-mobile-implementation.png"
        : "triage-desktop-implementation.png"
    ),
    fullPage: false,
  })
  expect(browserErrors).toEqual([])

  const promotionButton = mobile
    ? page
        .getByLabel("Opportunity actions")
        .getByRole("button", { name: "Promote to Elie" })
    : page
        .getByLabel("Route opportunity")
        .filter({ visible: true })
        .getByRole("button", { name: "Promote to Elie" })
  await promotionButton.click()
  await expect(
    page
      .getByText(/Delivered to Elie/, { exact: false })
      .filter({ visible: true })
      .first()
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Promote to Elie" })
  ).toHaveCount(0)

  await page.reload()
  await expect(
    page
      .getByText(/Delivered to Elie/, { exact: false })
      .filter({ visible: true })
      .first()
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Promote to Elie" })
  ).toHaveCount(0)

  if (mobile) {
    await navigationTrigger.click()
    const galleryLink = page.getByRole("link", {
      name: "Content request gallery",
    })
    await expect(galleryLink).toBeVisible()
    await galleryLink.click()
    await expect(
      page.getByRole("heading", { name: "Content requests" })
    ).toBeVisible()
  } else {
    await page.goto("/app")
  }
  const promotedCard = page.locator(
    `a.request-card-link[href="/app/requests/${fixture.data.humanId}"]`
  )
  await expect(promotedCard).toBeVisible()
  await expect(
    promotedCard.getByText("To Elie: Delivered to Elie", { exact: true })
  ).toBeVisible()
  await expect(promotedCard.getByText(/Job:/)).toBeVisible()
  await expect(promotedCard.getByText(/Delivery \d+\/\d+/)).toBeVisible()

  await founderPage.setViewportSize(
    mobile ? { width: 432, height: 910 } : { width: 1536, height: 1024 }
  )
  await founderPage.goto(`/app/requests/${fixture.data.humanId}`)
  const skipLink = founderPage.getByRole("link", {
    name: "Skip to main content",
  })
  await expect(skipLink).toHaveAttribute("href", "#main-content")
  if (mobile) await skipLink.focus()
  else await founderPage.keyboard.press("Tab")
  await expect(skipLink).toBeFocused()
  await expect(skipLink).toBeVisible()

  const showSource = founderPage.getByRole("button", {
    name: "Show Original source",
  })
  if (await showSource.isVisible()) {
    await showSource.click()
  }

  const sourceCard = founderPage.getByRole("article", {
    name: "Original source",
  })
  await expect(
    sourceCard.getByRole("heading", {
      level: 3,
      name: /A1\. Ontario mortgage discharge/,
    })
  ).toBeVisible()
  await expect(sourceCard.getByText(/\*\*Source:\*\*/)).toHaveCount(0)

  const sourceToggle = founderPage.getByRole("button", {
    name: "Hide Original source",
  })
  const sourcePin = founderPage.getByRole("button", {
    name: "Pin Original source",
    exact: true,
  })
  const colors = await sourceToggle.evaluate((element) => ({
    foreground: getComputedStyle(element).color,
    background: getComputedStyle(element.parentElement!).backgroundColor,
  }))
  expect(
    contrastRatio(colors.foreground, colors.background)
  ).toBeGreaterThanOrEqual(4.5)
  const pinBox = await sourcePin.boundingBox()
  expect(pinBox?.width).toBeGreaterThanOrEqual(44)
  expect(pinBox?.height).toBeGreaterThanOrEqual(44)

  const editor = founderPage.getByTestId("founder-editor")
  await founderPage.getByRole("button", { name: "Record input" }).click()
  const recordSurface = founderPage.getByRole("button", {
    name: "Press to record",
  })
  await expect(recordSurface).toBeVisible()
  const recordLayout = await editor.evaluate((element) => {
    const input = element.querySelector(".unified-editor__input")
    const trigger = element.querySelector(".unified-editor__record-trigger")
    const submit = element.querySelector(".unified-editor__submit-row")
    if (!input || !trigger || !submit) return null
    const editorRect = element.getBoundingClientRect()
    const inputRect = input.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    const submitRect = submit.getBoundingClientRect()
    return {
      editorBottom: editorRect.bottom,
      inputTop: inputRect.top,
      inputBottom: inputRect.bottom,
      triggerTop: triggerRect.top,
      triggerBottom: triggerRect.bottom,
      submitTop: submitRect.top,
      submitBottom: submitRect.bottom,
    }
  })
  expect(recordLayout).not.toBeNull()
  expect(
    Math.abs(recordLayout!.triggerTop - recordLayout!.inputTop)
  ).toBeLessThanOrEqual(1)
  expect(
    Math.abs(recordLayout!.triggerBottom - recordLayout!.inputBottom)
  ).toBeLessThanOrEqual(1)
  expect(recordLayout!.inputBottom).toBeLessThanOrEqual(
    recordLayout!.submitTop + 1
  )
  expect(
    recordLayout!.submitBottom,
    `record layout: ${JSON.stringify(recordLayout)}`
  ).toBeLessThanOrEqual(recordLayout!.editorBottom + 1)

  await founderPage.screenshot({
    path: path.join(
      screenshotDirectory,
      mobile
        ? "founder-record-accessible-mobile.png"
        : "founder-record-accessible-desktop.png"
    ),
    fullPage: false,
  })

  await founderPage.getByRole("button", { name: "Type input" }).click()
  const typeInput = founderPage.getByRole("textbox", {
    name: "Founder input",
  })
  await expect(typeInput).toBeVisible()
  const typeLayout = await editor.evaluate((element) => {
    const input = element.querySelector(".unified-editor__input")
    const submit = element.querySelector(".unified-editor__submit-row")
    if (!input || !submit) return null
    const inputRect = input.getBoundingClientRect()
    const submitRect = submit.getBoundingClientRect()
    return {
      inputBottom: inputRect.bottom,
      submitTop: submitRect.top,
    }
  })
  expect(typeLayout).not.toBeNull()
  expect(typeLayout!.inputBottom).toBeLessThanOrEqual(typeLayout!.submitTop + 1)

  await founderPage.screenshot({
    path: path.join(
      screenshotDirectory,
      mobile
        ? "founder-context-accessible-mobile.png"
        : "founder-context-accessible-desktop.png"
    ),
    fullPage: false,
  })

  await page.goto(`/app/requests/${fixture.data.humanId}`)
  await expect(
    page
      .getByText(/Opened by Elie/, { exact: false })
      .filter({ visible: true })
      .first()
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Promote to Elie" })
  ).toHaveCount(0)
  await page.goto("/app")
  await expect(
    page
      .locator(
        `a.request-card-link[href="/app/requests/${fixture.data.humanId}"]`
      )
      .getByText("To Elie: Opened by Elie", { exact: true })
  ).toBeVisible()

  await operatorContext.close()
  await founderContext.close()
})
