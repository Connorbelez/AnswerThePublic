import { expect, test } from "@playwright/test"

const identityHeaders = {
  "x-fairlend-e2e-key": "local-playwright-only",
  "x-fairlend-e2e-user": JSON.stringify({
    subject: "react_runtime_founder",
    organizationId: "org_fairlend",
    email: "react-runtime-founder@fairlend.ca",
    displayName: "Elie",
    workosRole: "founder",
  }),
}

test("the request library uses one React runtime", async ({ browser }) => {
  const context = await browser.newContext({
    extraHTTPHeaders: identityHeaders,
  })
  const page = await context.newPage()
  const runtimeErrors: Array<string> = []

  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Invalid hook call|Cannot read properties of null.*useContext/.test(
        message.text()
      )
    ) {
      runtimeErrors.push(message.text())
    }
  })
  page.on("pageerror", (error) => {
    if (
      /Invalid hook call|Cannot read properties of null.*useContext/.test(
        error.message
      )
    ) {
      runtimeErrors.push(error.message)
    }
  })

  await page.goto("/app")
  await expect(
    page.getByRole("heading", { name: "Content requests" })
  ).toBeVisible()
  await expect(page.getByText("Founder library", { exact: true })).toBeVisible()
  expect(runtimeErrors).toEqual([])

  await context.close()
})
