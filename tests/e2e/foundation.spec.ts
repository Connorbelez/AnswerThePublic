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
