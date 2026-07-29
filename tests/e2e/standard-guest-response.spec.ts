import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

test.setTimeout(60_000)

function pathname(value: string) {
  return new URL(value).pathname
}

async function settleGuestDraft(page: Page) {
  const saved = page.getByText("Saved", { exact: true }).first()
  const recover = page.getByRole("button", { name: "Save recovered draft" })
  await expect
    .poll(async () => (await saved.isVisible()) || (await recover.isVisible()))
    .toBe(true)
  if (await recover.isVisible()) await recover.click()
  await expect(saved).toBeVisible()
}

test("a Standard Request grant supports answer, autosave, administrator review, and immutable submission", async ({
  browser,
}, testInfo) => {
  const fixtureId = `standard-response-${testInfo.project.name}`.replaceAll(
    /[^a-z0-9]+/gi,
    "-"
  )
  const subject = `standard_response_operator_${fixtureId}`
  const operator = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject,
        organizationId: "org_fairlend",
        email: `${fixtureId}@fairlend.ca`,
        displayName: "Standard response operator",
        workosRole: "operator-editor",
      }),
    },
  })

  // The Expert Interview fixture establishes the shared founder/person directory
  // used by every Content Request. The acceptance subject below remains Standard.
  const directoryFixture = await operator.request.post(
    "/api/e2e/automated-request",
    {
      data: {
        title: `Directory seed ${fixtureId}`,
        assigneeSubject: subject,
        expertInterview: true,
      },
    }
  )
  expect(directoryFixture.status()).toBe(201)

  const requestFixture = await operator.request.post(
    "/api/e2e/automated-request",
    {
      data: {
        title: `Standard mortgage response ${fixtureId}`,
        assigneeSubject: subject,
      },
    }
  )
  expect(requestFixture.status()).toBe(201)
  const fixture = (await requestFixture.json()) as {
    data: { humanId: string }
  }

  const operatorPage = await operator.newPage()
  await operatorPage.goto(`/app/requests/${fixture.data.humanId}`)
  await expect(
    operatorPage.getByRole("heading", { name: "Guest Access Grants" })
  ).toBeVisible()
  await expect(
    operatorPage.getByRole("combobox", { name: "Response recipient" })
  ).toHaveValue("Elie Tchitava elie@fairlend.ca")
  await operatorPage
    .getByRole("button", { name: "Generate & copy link" })
    .click()
  const generatedLink = operatorPage.getByRole("textbox", {
    name: "Generated access link",
  })
  await expect(generatedLink).toBeVisible()
  const accessLink = await generatedLink.inputValue()
  expect(pathname(accessLink)).toMatch(/^\/respond\/[A-Za-z0-9_-]{43}$/)

  const guest = await browser.newContext({
    viewport: testInfo.project.name.includes("mobile")
      ? { width: 390, height: 844 }
      : { width: 1280, height: 900 },
  })
  const guestPage = await guest.newPage()
  const guestResponse = await guestPage.goto(pathname(accessLink))
  expect(guestResponse?.status()).toBe(200)
  await expect(
    guestPage.getByText("No sign-in required", { exact: true })
  ).toBeVisible()
  await expect(
    guestPage.getByText("Content response", { exact: true })
  ).toBeVisible()
  await expect(
    guestPage.getByRole("heading", {
      level: 1,
      name: `Standard mortgage response ${fixtureId}`,
    })
  ).toBeVisible()
  await expect(
    guestPage
      .getByText(
        "I’m about to pay off my mortgage in Ontario. My lender says they can report a ‘zero balance’ to the registry instead of doing a full discharge. Is that the same, and what are the downsides?",
        { exact: true }
      )
      .first()
  ).toBeVisible()
  await expect(
    guestPage.getByText("Source context", { exact: true })
  ).toBeVisible()
  await expect(
    guestPage.getByText("Editing on this device", { exact: true })
  ).toBeVisible()

  await guestPage.getByRole("button", { name: "Answer all at once" }).click()
  const answer =
    "A zero balance leaves the charge on title; a registered discharge removes it. Confirm timing, lender process, and legal advice before choosing."
  const responseBox = guestPage.getByRole("textbox", {
    name: "Your complete response",
  })
  await responseBox.fill(answer)
  await settleGuestDraft(guestPage)
  await guestPage.reload()
  await expect(
    guestPage.getByRole("textbox", { name: "Your complete response" })
  ).toHaveValue(answer)
  await settleGuestDraft(guestPage)
  await expect(
    guestPage.getByText("Editing on this device", { exact: true })
  ).toBeVisible()
  await guestPage
    .getByRole("combobox", { name: "Attach to" })
    .selectOption({ index: 1 })
  await guestPage
    .locator('input[type="file"][accept*="application/pdf"]')
    .setInputFiles({
      name: "portable-mortgage-checklist.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Confirm the lender's portability terms before listing the home."
      ),
    })
  await expect(
    guestPage.getByText("portable-mortgage-checklist.txt", { exact: true })
  ).toBeVisible()
  await expect(guestPage.getByText(/uploaded/i)).toBeVisible()
  const submitResponse = guestPage.getByRole("button", {
    name: "Submit response",
  })
  await expect(submitResponse).toBeEnabled({ timeout: 15_000 })

  await operatorPage.reload()
  await expect(
    operatorPage.getByRole("heading", { name: "Guest responses" })
  ).toBeVisible()
  await expect(
    operatorPage.getByText(answer, { exact: true }).first()
  ).toBeVisible()
  await expect(
    operatorPage.getByText("1 of 1 answered", { exact: true })
  ).toBeVisible()
  await expect(
    operatorPage.getByRole("article", {
      name: "Evidence: portable-mortgage-checklist.txt",
    })
  ).toContainText(
    "I’m about to pay off my mortgage in Ontario. My lender says they can report a ‘zero balance’ to the registry instead of doing a full discharge. Is that the same, and what are the downsides?"
  )

  await expect(submitResponse).toBeEnabled()
  await submitResponse.click()
  await guestPage
    .getByRole("radio", { name: /^Answer one question at a time/ })
    .click()
  await guestPage.getByRole("button", { name: "Yes, submit response" }).click()
  await expect(
    guestPage.getByRole("button", { name: /Response submitted/ })
  ).toBeDisabled()
  await expect(
    guestPage.getByText("Submitted · read-only", { exact: true })
  ).toBeVisible()
  await expect(
    guestPage.getByRole("textbox", { name: "Your complete response" })
  ).toBeDisabled()
  await guestPage.reload()
  await expect(
    guestPage.getByRole("textbox", { name: "Your complete response" })
  ).toHaveValue(answer)
  await expect(
    guestPage.getByText("Submitted · read-only", { exact: true })
  ).toBeVisible()

  const accessibility = await new AxeBuilder({ page: guestPage })
    .include("main")
    .analyze()
  expect(accessibility.violations).toEqual([])

  await operatorPage.reload()
  await expect(
    operatorPage.getByText("Submitted", { exact: true }).first()
  ).toBeVisible()
  await expect(
    operatorPage.getByRole("region", {
      name: "Immutable submission history",
    })
  ).toContainText("portable-mortgage-checklist.txt")
  await expect(
    operatorPage
      .getByText(
        "I’m about to pay off my mortgage in Ontario. My lender says they can report a ‘zero balance’ to the registry instead of doing a full discharge. Is that the same, and what are the downsides?",
        { exact: true }
      )
      .first()
  ).toBeVisible()

  await guest.close()
  await operator.close()
})
