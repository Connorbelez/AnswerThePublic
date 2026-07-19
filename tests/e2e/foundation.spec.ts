import { expect, test, type Locator, type Page } from "@playwright/test"

test.setTimeout(60_000)

async function expectMinimumTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible()
  await expect
    .poll(async () => {
      const bounds = await locator.boundingBox()
      return bounds ? Math.min(bounds.width, bounds.height) : 0
    })
    .toBeGreaterThanOrEqual(44)
}

async function expectNoHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))

  expect(width.scroll).toBeLessThanOrEqual(width.client)
}

test("an unauthenticated visitor is sent to the sign-in boundary", async ({
  page,
}) => {
  await page.goto("/app")

  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fapp$/)
  await expect(
    page.getByRole("heading", { name: "Your content queue is private" })
  ).toBeVisible()
})

test("a public share is unauthenticated, read-only, and immediately revocable", async ({
  browser,
}) => {
  const operator = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: "share_operator",
        organizationId: "org_fairlend",
        email: "share@fairlend.ca",
        displayName: "Share operator",
        workosRole: "operator-editor",
      }),
    },
  })
  const response = await operator.request.post("/api/e2e/public-share", {
    data: { action: "create" },
  })
  const payload = (await response.json()) as {
    data: { token: string; share: { shareId: string } }
  }
  const viewer = await browser.newContext()
  const page = await viewer.newPage()
  await page.goto(`/share/${payload.data.token}`)
  await expect(
    page.getByRole("heading", { name: "Public FairLend response" })
  ).toBeVisible()
  await expect(
    page.getByText("This is the explicitly approved public response.")
  ).toBeVisible()
  await expect(page.getByText("Read only", { exact: false })).toBeVisible()
  const publicHtml = await page.content()
  expect(publicHtml).not.toContain("PRIVATE_CANDIDATE_SECRET")
  expect(publicHtml).not.toContain("PRIVATE_FOUNDER_BROWSER_SECRET")
  expect(publicHtml).not.toMatch(
    /founderInput|agentJobs|auditEvents|credentialId/
  )
  await operator.request.post("/api/e2e/public-share", {
    data: { action: "revoke", shareId: payload.data.share.shareId },
  })
  const revokedResponse = await page.reload()
  expect(revokedResponse?.status()).toBe(404)
  await viewer.close()
  await operator.close()
})

test("an authenticated founder sees their identity and role", async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: "user_elie",
        organizationId: "org_fairlend",
        email: "elie@fairlend.ca",
        displayName: "Elie",
        workosRole: "founder",
      }),
    },
  })
  const page = await context.newPage()

  await page.goto("/app")

  await expect(
    page.getByRole("heading", { name: "Content requests" })
  ).toBeVisible()
  await expect(page.getByText("Founder library", { exact: true })).toBeVisible()
  await expect(page.getByText("Elie", { exact: true })).toBeVisible()
  await expect(page.getByText("Founder", { exact: true })).toBeVisible()

  for (const name of ["Open navigation", "Notifications", "Sign out"]) {
    await expectMinimumTouchTarget(page.getByRole("button", { name }))
  }

  await page.getByRole("button", { name: "Open navigation" }).click()
  const primaryNavigation = page.getByRole("navigation", {
    name: "Primary navigation",
  })
  await expect(primaryNavigation).toBeVisible()
  await expect(
    primaryNavigation.getByRole("link", { name: "Content requests" })
  ).toBeVisible()
  await expect(
    primaryNavigation.getByRole("link", { name: "New request" })
  ).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(primaryNavigation).toBeHidden()

  await expectNoHorizontalOverflow(page)
  await context.close()
})

test("an administrator switches into and out of Elie's QA workspace", async ({
  browser,
}) => {
  const founderContext = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: "user_elie",
        organizationId: "org_fairlend",
        email: "elie@fairlend.ca",
        displayName: "Elie",
        workosRole: "founder",
      }),
    },
  })
  await (await founderContext.newPage()).goto("/app")
  await founderContext.close()

  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: "user_administrator",
        organizationId: "org_fairlend",
        email: "administrator@fairlend.ca",
        displayName: "Administrator",
        workosRole: "administrator",
      }),
    },
  })
  const page = await context.newPage()

  await page.goto("/app")

  const viewElie = page.getByRole("button", {
    name: "View Elie’s workspace",
  })
  await expect(viewElie).toBeVisible()
  await expect(
    page.getByText("Operator workspace", { exact: true })
  ).toBeVisible()

  await viewElie.click()
  await expect(
    page.getByText("QA view: you are seeing Elie’s workspace.", {
      exact: false,
    })
  ).toBeVisible()
  await expect(page.getByText("Founder library", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Return to admin workspace" }).click()
  await expect(
    page.getByText("Operator workspace", { exact: true })
  ).toBeVisible()
  await context.close()
})

test("a signed-in identity without an application role is denied", async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: "user_unprovisioned",
        organizationId: "org_fairlend",
        email: "unprovisioned@fairlend.ca",
        displayName: "Unprovisioned",
        workosRole: "member",
      }),
    },
  })
  const page = await context.newPage()

  await page.goto("/app")

  await expect(page).toHaveURL(/\/unauthorized$/)
  await expect(
    page.getByRole("heading", { name: "Your account is not provisioned" })
  ).toBeVisible()
  await context.close()
})

test("an operator creates a minimal manual request and opens its stable route", async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: "user_operator",
        organizationId: "org_fairlend",
        email: "operator@fairlend.ca",
        displayName: "FairLend operator",
        workosRole: "operator-editor",
      }),
    },
  })
  const page = await context.newPage()

  await page.goto("/app")
  await expect(page.getByRole("main")).toHaveAttribute("data-hydrated", "true")
  await page.getByRole("button", { name: "Open navigation" }).click()
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "New request" })
    .click()
  await expect(page).toHaveURL(/\/app\/new$/)
  await page.getByLabel("Title").fill("Explain mortgage portability")
  await page
    .getByLabel("Original question")
    .fill("Can I take my mortgage with me when I move?")
  await page.getByRole("button", { name: "Create Critical request" }).click()

  await expect(page).toHaveURL(/\/app\/requests\/CR-[A-Z0-9]+$/)
  await expect(
    page.getByRole("heading", { name: "Explain mortgage portability" })
  ).toBeVisible()
  await expect(
    page.getByText("Can I take my mortgage with me when I move?")
  ).toBeVisible()
  await expect(page.getByText(/CR-[A-Z0-9]+/)).toBeVisible()
  await page.getByRole("button", { name: "Archive request" }).click()
  await expect(page.getByText("Read-only request")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Update assignment" })
  ).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Add channel" })).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Restore request" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Restore request" }).click()
  await expect(
    page.getByRole("button", { name: "Archive request" })
  ).toBeVisible()

  await page
    .getByLabel("Title", { exact: true })
    .fill("Clarify portability qualification")
  await page
    .getByLabel("Why this is a new obligation")
    .fill("The borrower asked a materially new follow-up")
  await page.getByRole("button", { name: "Create follow-up" }).click()
  await expect(page).toHaveURL(/\/app\/requests\/CR-[A-Z0-9]+$/)
  await expect(
    page.getByRole("heading", { name: "Clarify portability qualification" })
  ).toBeVisible()
  await expect(page.getByText(/Follow-up to CR-/)).toBeVisible()
  await context.close()
})

test("the operator workspace is a mobile-first list with actionable filters and grid switching", async ({
  browser,
  browserName,
}) => {
  const desktop = browserName === "chromium"
  const context = await browser.newContext({
    viewport: desktop
      ? { width: 1280, height: 900 }
      : { width: 390, height: 844 },
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: `operator_workspace_${browserName}`,
        organizationId: "org_fairlend",
        email: "operator@fairlend.ca",
        displayName: "FairLend operator",
        workosRole: "operator-editor",
      }),
    },
  })
  const page = await context.newPage()
  const title = `Operator queue request ${browserName}`
  await page.goto("/app/new")
  await page.getByLabel("Title").fill(title)
  await page.getByRole("button", { name: "Create Critical request" }).click()
  await page.goto("/app")

  await expect(
    page.getByText("Operator workspace", { exact: true })
  ).toBeVisible()
  const list = page.getByRole("region", { name: "Content requests" })
  await expect(list).toHaveAttribute("data-view", "list")
  await expect(list).toHaveCSS("display", "grid")
  await expect(
    list.getByText("Critical", { exact: true }).first()
  ).toBeVisible()
  await expect(list.getByText("Pending", { exact: true }).first()).toBeVisible()
  await expect(list.getByText("Job: not started").first()).toBeVisible()
  await expect(list.getByText(/Delivery 0\/\d+/).first()).toBeVisible()
  await page
    .getByRole("searchbox", { name: "Search content requests" })
    .fill(title)
  await page.getByRole("button", { name: "Apply filters" }).click()
  await expect(page.getByText(title, { exact: true })).toBeVisible()

  const needsElie = page.getByRole("button", { name: "Needs Elie" })
  await expectMinimumTouchTarget(needsElie)
  await needsElie.click()
  await expect(
    page.getByRole("heading", { name: "No matching requests" })
  ).toBeVisible({ timeout: 15_000 })
  await page.getByRole("button", { name: "Clear filters" }).click()
  await expect(page.getByText(title, { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Grid view" }).click()
  await expect(list).toHaveAttribute("data-view", "grid")
  const gridColumns = await list.evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length
  )
  expect(gridColumns).toBeGreaterThanOrEqual(desktop ? 3 : 2)
  await page.getByRole("button", { name: "List view" }).click()
  await expect(list).toHaveAttribute("data-view", "list")
  await page.getByText(title, { exact: true }).click()
  await expect(page).toHaveURL(/\/app\/requests\/CR-[A-Z0-9]+$/)
  await expect(page.getByRole("heading", { name: title })).toBeVisible()
  await context.close()
})

test("the canonical founder, agent, and operator journey reaches responded", async ({
  browser,
  browserName,
}) => {
  test.setTimeout(90_000)
  const founderSubject = `journey_founder_${browserName}`
  const founderContext = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: founderSubject,
        organizationId: "org_fairlend",
        email: "elie@fairlend.ca",
        displayName: "Elie",
        workosRole: "founder",
      }),
    },
  })
  const operatorContext = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: `journey_operator_${browserName}`,
        organizationId: "org_fairlend",
        email: "operator@fairlend.ca",
        displayName: "FairLend operator",
        workosRole: "operator-editor",
      }),
    },
  })
  const agentContext = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: `journey_agent_${browserName}`,
        organizationId: "org_fairlend",
        email: "agent@fairlend.ca",
        displayName: "FairLend drafting agent",
        workosRole: "agent-editor",
      }),
    },
  })
  const founderPage = await founderContext.newPage()
  const operatorPage = await operatorContext.newPage()
  await founderPage.goto("/app")
  const title = `Canonical response journey ${browserName}`
  await operatorPage.goto("/app/new")
  await operatorPage.getByLabel("Title").fill(title)
  await operatorPage
    .getByLabel("Original question")
    .fill("How should a borrower evaluate a mortgage renewal offer?")
  await operatorPage
    .getByRole("button", { name: "Create Critical request" })
    .click()
  await expect(operatorPage).toHaveURL(/\/app\/requests\/CR-[A-Z0-9]+$/)
  const requestPath = new URL(operatorPage.url()).pathname
  await operatorPage
    .getByRole("combobox", { name: "Accountable assignee" })
    .selectOption({ label: `${founderSubject} · founder` })
  await operatorPage.getByRole("button", { name: "Update assignment" }).click()

  await founderPage.reload()
  await founderPage.getByText(title, { exact: true }).click()
  await founderPage.getByRole("button", { name: "Type input" }).click()
  await founderPage
    .getByRole("textbox", { name: "Founder input" })
    .fill(
      "Compare the full borrowing cost, prepayment flexibility, and how the renewal fits the borrower's next five years."
    )
  await expect(founderPage.getByText("Saved", { exact: true })).toBeVisible()
  const submitFounder = founderPage.getByRole("button", {
    name: "Submit to drafting",
  })
  await expect(submitFounder).toBeEnabled()
  await submitFounder.click()
  await expect(founderPage).toHaveURL(/\/app$/)

  const claimKey = `canonical-claim-${browserName}`
  const claimResponse = await agentContext.request.post("/api/v1/control", {
    data: {
      command: {
        operation: "job.claim",
        arguments: { leaseMs: 30_000 },
        idempotencyKey: claimKey,
      },
    },
  })
  expect(claimResponse.status()).toBe(200)
  const claim = (await claimResponse.json()) as {
    data: { jobId: string; leaseGeneration: number }
  }
  const responseBody =
    "Compare the total borrowing cost, not just the headline rate. Review prepayment privileges, portability, penalties, and whether the term supports the borrower's expected plans."
  const completionResponse = await agentContext.request.post(
    "/api/v1/control",
    {
      data: {
        command: {
          operation: "job.complete",
          arguments: {
            jobId: claim.data.jobId,
            leaseToken: claimKey,
            leaseGeneration: claim.data.leaseGeneration,
            body: responseBody,
          },
          idempotencyKey: `canonical-complete-${browserName}`,
        },
      },
    }
  )
  expect(completionResponse.status()).toBe(200)

  await operatorPage.goto(requestPath)
  await expect(operatorPage.getByText("Ready to respond")).toBeVisible()
  await expect(operatorPage.getByText(responseBody)).toBeVisible()
  await expect(
    operatorPage.getByText("Promoted", { exact: true })
  ).toBeVisible()
  const confirmationNote = "Copied and posted to the original opportunity."
  const confirmationNoteInput = operatorPage.getByLabel(
    /Confirmation note for .* \(optional\)/
  )
  await confirmationNoteInput.pressSequentially(confirmationNote)
  await expect(confirmationNoteInput).toHaveValue(confirmationNote)
  const markResponded = operatorPage.getByRole("button", {
    name: /^Mark .* responded$/,
  })
  await expectMinimumTouchTarget(markResponded)
  await markResponded.click()
  const reopenDelivery = operatorPage.getByRole("button", {
    name: /^Reopen delivery to /,
  })
  await expect(reopenDelivery).toBeVisible({ timeout: 15_000 })
  await expectMinimumTouchTarget(reopenDelivery)
  await expect(
    operatorPage.getByText(`Note: ${confirmationNote}`, { exact: true })
  ).toBeVisible()
  await operatorPage.goto("/app")
  await operatorPage
    .getByRole("searchbox", { name: "Search content requests" })
    .fill(title)
  await operatorPage.getByRole("button", { name: "Apply filters" }).click()
  const card = operatorPage
    .getByRole("region", { name: "Content requests" })
    .getByRole("link", { name: new RegExp(title) })
  await expect(card).toContainText("Responded")
  await expect(card).toContainText("Delivery 1/1")

  await agentContext.close()
  await operatorContext.close()
  await founderContext.close()
})

test("an operator assigns Elie and his mobile library switches from stack to grid", async ({
  browser,
  browserName,
}) => {
  const founderSubject = `user_elie_${browserName}`
  const founderContext = await browser.newContext({
    reducedMotion: "reduce",
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: founderSubject,
        organizationId: "org_fairlend",
        email: "elie@fairlend.ca",
        displayName: "Elie",
        workosRole: "founder",
      }),
    },
  })
  const founderPage = await founderContext.newPage()
  await founderPage.goto("/app")

  const operatorContext = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: `user_operator_${browserName}`,
        organizationId: "org_fairlend",
        email: "operator@fairlend.ca",
        displayName: "FairLend operator",
        workosRole: "operator-editor",
      }),
    },
  })
  const operatorPage = await operatorContext.newPage()
  const title = `Assigned founder request ${browserName}`
  await operatorPage.goto("/app/new")
  await operatorPage.getByLabel("Title").fill(title)
  await operatorPage
    .getByLabel("Original question")
    .fill("Can I preserve my mortgage while financing a laneway suite?")
  const completeSource =
    "The complete source explains the existing low-rate first mortgage, construction budget, permits, staged draw requirements, lender consent, and the cash-flow gap before inspection-based releases."
  await operatorPage.getByLabel("Original source material").fill(completeSource)
  await operatorPage
    .getByRole("button", { name: "Create Critical request" })
    .click()
  await operatorPage
    .getByRole("combobox", { name: "Accountable assignee" })
    .selectOption({ label: `${founderSubject} · founder` })
  await operatorPage.getByLabel("Reason (optional)").fill("Founder expertise")
  await operatorPage.getByRole("button", { name: "Update assignment" }).click()
  await expect(
    operatorPage.getByText(`Assigned to ${founderSubject}`)
  ).toBeVisible()

  await operatorPage.goto("/app/new")
  await operatorPage.getByLabel("Title").fill(`${title} follow-up`)
  await operatorPage
    .getByRole("button", { name: "Create Critical request" })
    .click()
  await operatorPage
    .getByRole("combobox", { name: "Accountable assignee" })
    .selectOption({ label: `${founderSubject} · founder` })
  await operatorPage.getByRole("button", { name: "Update assignment" }).click()
  await expect(
    operatorPage.getByText(`Assigned to ${founderSubject}`)
  ).toBeVisible()
  const automatedTitle = `Automated scout request ${browserName}`
  const fixtureResponse = await operatorPage.request.post(
    "/api/e2e/automated-request",
    {
      data: { title: automatedTitle, assigneeSubject: founderSubject },
    }
  )
  expect(fixtureResponse.status()).toBe(201)

  await founderPage.reload()
  await expect(founderPage.getByText(title, { exact: true })).toBeVisible()
  await expect(
    founderPage.getByText(`${title} follow-up`, { exact: true })
  ).toHaveCount(1)
  await expect(
    founderPage.getByRole("button", { name: "Notifications" })
  ).toBeVisible()
  const notificationButton = founderPage.getByRole("button", {
    name: "Notifications",
  })
  await expect(notificationButton.locator(".notification-count")).toBeVisible()
  await expectMinimumTouchTarget(notificationButton)
  await expectNoHorizontalOverflow(founderPage)
  const stack = founderPage.getByRole("region", { name: "Content requests" })
  await expect(stack).toHaveAttribute("data-view", "stack")
  const stackTitles = await stack
    .locator('[data-slot="card-title"]')
    .allTextContents()
  expect(stackTitles.indexOf(title)).toBeLessThan(
    stackTitles.indexOf(automatedTitle)
  )
  const stackMetrics = await stack.evaluate((element) => {
    const start = element.scrollLeft
    element.scrollTo({ left: element.clientWidth, behavior: "instant" })
    return {
      scrollSnapType: getComputedStyle(element).scrollSnapType,
      start,
      end: element.scrollLeft,
      overflow: element.scrollWidth - element.clientWidth,
    }
  })
  expect(stackMetrics.scrollSnapType).toContain("x")
  if (browserName === "webkit") {
    expect(stackMetrics.overflow).toBeGreaterThan(0)
    expect(stackMetrics.end).toBeGreaterThan(stackMetrics.start)
  }
  await founderPage.getByRole("button", { name: "Grid view" }).click()
  await expect(
    founderPage.getByRole("region", { name: "Content requests" })
  ).toHaveAttribute("data-view", "grid")
  const gridTitles = await founderPage
    .getByRole("region", { name: "Content requests" })
    .locator('[data-slot="card-title"]')
    .allTextContents()
  expect(gridTitles.indexOf(title)).toBeLessThan(
    gridTitles.indexOf(automatedTitle)
  )
  await founderPage.getByText(title, { exact: true }).click()
  await expect(
    founderPage.getByRole("heading", { name: title, exact: true })
  ).toBeVisible()
  await expect(
    founderPage.getByRole("region", { name: "Context deck" })
  ).toBeVisible()
  await expect(founderPage.getByText(completeSource)).toBeVisible()
  await expect(
    founderPage.getByRole("button", { name: "Archive request" })
  ).toHaveCount(0)
  const cards = founderPage.locator(".unified-context-deck__cards")
  const collapsedDisplay = await cards.evaluate(
    (element) => getComputedStyle(element).display
  )
  expect(collapsedDisplay).toBe(browserName === "webkit" ? "block" : "grid")
  await founderPage
    .getByRole("button", { name: "Hide Original source" })
    .click()
  await expect(
    founderPage.getByRole("article", { name: "Original source" })
  ).toHaveCount(0)
  const filterPin = founderPage.getByRole("button", {
    name: "Pin Original source",
  })
  await expectMinimumTouchTarget(filterPin)
  await filterPin.click()
  await expect(
    founderPage.getByRole("article", { name: "Original source" })
  ).toHaveAttribute("data-pinned", "true")
  await expect(founderPage.getByText(completeSource)).toBeVisible()
  const backAction = founderPage.getByRole("button", {
    name: "Back to content requests",
  })
  await expectMinimumTouchTarget(backAction)
  const cardPin = founderPage.getByRole("button", {
    name: "Unpin Original source card",
  })
  await expectMinimumTouchTarget(cardPin)
  const editor = founderPage.getByTestId("founder-editor")
  await expect(editor).toHaveAttribute("data-expanded", "false")
  const transitionDuration = await editor.evaluate(
    (element) => getComputedStyle(element).transitionDuration
  )
  expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001)
  const recordMode = founderPage.getByRole("button", { name: "Record input" })
  await expectMinimumTouchTarget(recordMode)
  await recordMode.focus()
  await founderPage.keyboard.press("Enter")
  await expect(
    founderPage.getByText("Voice input", { exact: true })
  ).toBeVisible()
  if (browserName === "chromium") {
    await founderPage.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: () =>
          Promise.reject(
            new DOMException("Permission denied", "NotAllowedError")
          ),
      })
    })
    await founderPage.getByRole("button", { name: "Start recording" }).click()
    await expect(
      founderPage.getByText(
        "Microphone permission was denied. Typed input was not changed."
      )
    ).toBeVisible()
  }
  const typeMode = founderPage.getByRole("button", { name: "Type input" })
  await expectMinimumTouchTarget(typeMode)
  await typeMode.focus()
  await expect(typeMode).toBeFocused()
  await founderPage.keyboard.press("Enter")
  await expect(
    founderPage.getByRole("textbox", { name: "Founder input" })
  ).toBeVisible()
  await founderPage.addInitScript(() => {
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: undefined,
    })
  })
  await founderPage.reload()
  await founderPage.getByRole("button", { name: "Record input" }).click()
  await expect(
    founderPage.getByText("Voice recording unavailable", { exact: true })
  ).toBeVisible()
  await founderPage.getByRole("button", { name: "Type input" }).click()
  await expect(
    founderPage.getByRole("textbox", { name: "Founder input" })
  ).toBeVisible()
  await founderPage.getByRole("button", { name: "Expand editor" }).click()
  await expect(editor).toHaveAttribute("data-expanded", "true")
  await expect(
    founderPage.getByRole("textbox", { name: "Founder input" })
  ).toBeFocused()
  const expandedDeck = await cards.evaluate((element) => ({
    display: getComputedStyle(element).display,
    scrollSnapType: getComputedStyle(element).scrollSnapType,
    overflow: element.scrollWidth - element.clientWidth,
  }))
  expect(expandedDeck.display).toBe("flex")
  expect(expandedDeck.scrollSnapType).toContain("x")
  if (browserName === "webkit") {
    expect(expandedDeck.overflow).toBeGreaterThan(0)
  }

  const founderText =
    "Preserve the existing mortgage, confirm lender consent, and explain the staged-draw cash-flow gap."
  const founderInput = founderPage.getByRole("textbox", {
    name: "Founder input",
  })
  await founderInput.fill(founderText)
  await expect(founderPage.getByText("Saving", { exact: true })).toBeVisible()
  await expect(founderPage.getByText("Saved", { exact: true })).toBeVisible()
  await expect(
    founderPage.getByRole("button", { name: /History \([1-9]\d*\)/ })
  ).toBeVisible()
  await founderPage
    .getByRole("button", { name: /History \([1-9]\d*\)/ })
    .click()
  await expect(
    founderPage.getByRole("list", { name: "Founder input version history" })
  ).toContainText("user_elie")
  const requestPath = new URL(founderPage.url()).pathname
  await founderPage.reload()
  await expect(
    founderPage.getByRole("textbox", { name: "Founder input" })
  ).toHaveValue(founderText)

  await founderPage.evaluate(() => navigator.serviceWorker.ready)
  await expect
    .poll(() =>
      founderPage.evaluate(() => Boolean(navigator.serviceWorker.controller))
    )
    .toBe(true)
  await expect(founderPage.locator("html")).toHaveAttribute(
    "data-offline-ready",
    "true"
  )
  const offlineText = `${founderText} Added without connectivity.`
  await founderContext.setOffline(true)
  await founderInput.fill(offlineText)
  await expect(founderPage.getByText("Offline", { exact: true })).toBeVisible()
  await founderPage.waitForTimeout(150)
  if (browserName === "webkit") {
    await founderPage.evaluate(() => {
      window.setTimeout(() => window.location.reload(), 0)
    })
    await founderPage.waitForLoadState("domcontentloaded")
  } else {
    await founderPage.reload()
  }
  await expect(
    founderPage.getByRole("textbox", { name: "Founder input" })
  ).toHaveValue(offlineText)
  await expect(founderPage.getByText("Offline", { exact: true })).toBeVisible()
  await founderContext.setOffline(false)
  await expect(founderPage.getByText("Saved", { exact: true })).toBeVisible()

  await operatorPage.goto(requestPath)
  await expect(operatorPage.getByText("Founder draft saved")).toBeVisible()
  await expect(operatorPage.getByText("In progress")).toBeVisible()
  await expect(operatorPage.getByText(founderText)).toHaveCount(0)

  await operatorPage.getByRole("button", { name: "Archive request" }).click()
  await founderPage.reload()
  await expect(founderPage.getByText(/inactive.*read-only/i)).toBeVisible()
  await expect(
    founderPage.getByRole("textbox", { name: "Founder input" })
  ).toHaveAttribute("readonly", "")
  await expect(
    founderPage.getByRole("button", { name: "Show Original source" })
  ).toBeDisabled()
  await expect(
    founderPage.getByRole("button", { name: "Submit to drafting" })
  ).toHaveCount(0)

  await founderContext.setOffline(true)
  const offlineSignOut = await founderPage.evaluate(async () => {
    const stagedDraftKey = "fairlend:founder-offline-draft:privacy-test"
    localStorage.setItem(stagedDraftKey, "private founder draft")
    const cache = await caches.open("fairlend-pages-privacy-test")
    await cache.put("/private-test", new Response("private"))
    return new Promise<{
      pageCachePresent: boolean
      stagedDraft: string | null
    }>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Offline sign-out purge timed out")),
        5_000
      )
      window.addEventListener(
        "fairlend:private-offline-cleared",
        () => {
          void (async () => {
            window.clearTimeout(timeout)
            resolve({
              pageCachePresent: (await caches.keys()).some((name) =>
                name.startsWith("fairlend-pages-")
              ),
              stagedDraft: localStorage.getItem(stagedDraftKey),
            })
          })()
        },
        { once: true }
      )
      const signOut = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Sign out"]'
      )
      if (!signOut) reject(new Error("Sign-out control is missing"))
      else signOut.click()
    })
  })
  expect(offlineSignOut).toEqual({
    pageCachePresent: false,
    stagedDraft: null,
  })

  await operatorContext.close()
  await founderContext.close()
})
