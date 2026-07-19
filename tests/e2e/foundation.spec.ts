import { expect, test } from "@playwright/test"

test("an unauthenticated visitor is sent to the sign-in boundary", async ({
  page,
}) => {
  await page.goto("/app")

  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fapp$/)
  await expect(
    page.getByRole("heading", { name: "Your content queue is private" })
  ).toBeVisible()
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
  await page.getByRole("link", { name: "New request" }).click()
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
  await context.close()
})

test("an operator assigns Elie and his mobile library switches from stack to grid", async ({
  browser,
  browserName,
}) => {
  const founderSubject = `user_elie_${browserName}`
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
  await expect(founderPage.getByRole("heading", { name: title })).toBeVisible()

  await operatorContext.close()
  await founderContext.close()
})
