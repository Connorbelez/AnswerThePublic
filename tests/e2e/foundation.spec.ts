import {
  expect,
  test,
  type APIResponse,
  type Browser,
  type Page,
} from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

test.setTimeout(60_000)

function pathname(value: string) {
  try {
    return new URL(value).pathname
  } catch (error) {
    throw new Error("Playwright returned an invalid page URL.", {
      cause: error,
    })
  }
}

async function expectApiStatus(response: APIResponse, expected: number) {
  expect(response.status(), await response.text()).toBe(expected)
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

test("the sign-in boundary rejects an external return path", async ({
  page,
}) => {
  await page.goto("/sign-in?returnTo=//example.invalid/phishing")

  await expect(
    page.getByRole("link", { name: "Continue with WorkOS" })
  ).toHaveAttribute("href", "/api/auth/sign-in?returnPathname=%2Fapp")
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
  await context.close()
})

test("an administrator switches into and out of Elie's QA workspace", async ({
  browser,
}, testInfo) => {
  const mobile = testInfo.project.name.includes("mobile")
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

  if (mobile) {
    await page.getByRole("button", { name: "Open navigation" }).click()
  }

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
  ).toHaveCount(0)
  await expect(page.getByText("Founder library", { exact: true })).toBeVisible()

  if (mobile) {
    await page.getByRole("button", { name: "Open navigation" }).click()
  }
  await page.getByRole("button", { name: "Return to admin workspace" }).click()
  await expect(
    page.getByText("Operator workspace", { exact: true })
  ).toBeVisible()
  await context.close()
})

test("an administrator can switch to the founder workspace without a founder sign-in", async ({
  browser,
}, testInfo) => {
  const mobile = testInfo.project.name.includes("mobile")
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: "user_administrator_without_founder_sign_in",
        organizationId: "org_fairlend",
        email: "administrator-without-founder-sign-in@fairlend.ca",
        displayName: "Administrator",
        workosRole: "admin",
      }),
    },
  })
  const page = await context.newPage()

  await page.goto("/app")
  if (mobile) {
    await page.getByRole("button", { name: "Open navigation" }).click()
  }
  await page.getByRole("button", { name: "View Elie’s workspace" }).click()

  await expect(page.getByText("Founder library", { exact: true })).toBeVisible()
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
  await expect(page.getByRole("link", { name: "Sign out" })).toHaveAttribute(
    "href",
    "/logout"
  )
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
  await expect(page.getByRole("link", { name: "New request" })).toHaveAttribute(
    "href",
    "/app/new"
  )
  await page.goto("/app/new")
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
  await page.getByText("Record options & delivery", { exact: true }).click()
  await page.getByRole("button", { name: "Archive request" }).click()
  await expect(page.getByText("Read-only opportunity")).toBeVisible()
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

test("an operator creates an expert interview from the content request interface", async ({
  browser,
}, testInfo) => {
  const projectKey = testInfo.project.name.replaceAll(/[^a-z0-9]+/gi, "-")
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: `expert_interview_creator_${projectKey}`,
        organizationId: "org_fairlend",
        email: "expert-interview-creator@fairlend.ca",
        displayName: "Expert interview creator",
        workosRole: "operator-editor",
      }),
    },
  })
  const page = await context.newPage()
  const title = `Garden suite draw interview ${projectKey}`

  await page.goto("/app/new")
  await expect(
    page.getByRole("button", { name: "Create Critical request" })
  ).toBeEnabled()
  await page.getByText("Expert interview", { exact: true }).click()
  await page.getByLabel("Request title").fill(title)
  await page.getByLabel("Topic").fill("Garden suite construction financing")
  await page.getByLabel("Audience").fill("Toronto homeowners")
  await page
    .getByLabel("Article summary")
    .fill("Explain how borrowers can plan cash flow across construction draws.")
  await page
    .getByLabel("FairLend posture")
    .fill("Give practical guidance and be explicit about financing tradeoffs.")
  await page
    .getByLabel("Founder contribution")
    .fill("Add firsthand underwriting patterns from real construction files.")
  await page.getByLabel("Gap title").fill("First-draw timing is unclear")
  await page
    .getByLabel("Existing coverage")
    .fill("Most guides describe total loan size but not draw timing.")
  await page
    .getByLabel("Why it falls short")
    .fill("Borrowers cannot translate the guidance into a cash-flow plan.")
  await page
    .getByLabel("Expert opportunity")
    .fill("Explain the real inspection and advance sequence.")
  await page.getByLabel("Source label").fill("CMHC construction guidance")
  await page
    .getByLabel("Source URL", { exact: true })
    .fill("https://example.test/cmhc-construction-guidance")
  await page
    .getByLabel("What it supports")
    .fill("Construction financing is advanced against project progress.")
  await page
    .getByLabel("Question", { exact: true })
    .fill("How should a borrower prepare for the first construction draw?")
  await page
    .getByLabel("Why ask this?")
    .fill("It converts abstract lending terms into an actionable plan.")
  await page.getByRole("button", { name: "Create expert interview" }).click()

  await expect(page).toHaveURL(/\/app\/requests\/CR-[A-Z0-9]+$/)
  await expect(page.getByRole("heading", { name: title })).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Expert interview brief" })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "First-draw timing is unclear" })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", {
      name: "How should a borrower prepare for the first construction draw?",
    })
  ).toBeVisible()
  await expect(page.getByTestId("expert-interview-question")).toHaveCount(1)
  await context.close()
})

test("an operator opens a first-class Expert Interview in stable package order", async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: "expert_interview_operator",
        organizationId: "org_fairlend",
        email: "expert-interview@fairlend.ca",
        displayName: "Expert interview operator",
        workosRole: "operator-editor",
      }),
    },
  })
  const response = await context.request.post("/api/e2e/automated-request", {
    data: {
      title: "How Ontario bridge files recover",
      assigneeSubject: "unused-for-expert-interview",
      expertInterview: true,
    },
  })
  expect(response.status()).toBe(201)
  const payload = (await response.json()) as {
    data: { request: { humanId: string } }
  }
  const page = await context.newPage()

  await page.goto(`/app/requests/${payload.data.request.humanId}`)

  await expect(
    page.getByRole("heading", { name: "How Ontario bridge files recover" })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Expert interview brief" })
  ).toBeVisible()
  await expect(
    page.getByText(
      "Lead with Ontario-specific recovery decisions before general bridge-loan guidance."
    )
  ).toBeVisible()
  await expect(page.getByTestId("expert-interview-question")).toHaveCount(2)
  await expect(
    page
      .getByTestId("expert-interview-question")
      .locator("h3")
      .allTextContents()
  ).resolves.toEqual([
    "What is the first call you make when a borrower misses the bank’s bridge timeline?",
    "Which warning sign would a less experienced practitioner miss?",
  ])
  await context.close()
})

async function setupGuestAccessBrowserFixture(
  browser: Browser,
  projectName: string,
  fixtureScope: string
) {
  const fixtureId = `${fixtureScope}-${projectName}`.replaceAll(
    /[^a-z0-9]+/gi,
    "-"
  )
  const operator = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: `guest_access_operator_${fixtureId}`,
        organizationId: "org_fairlend",
        email: `guest-access-${fixtureId}@fairlend.ca`,
        displayName: "Guest access operator",
        workosRole: "operator-editor",
      }),
    },
  })
  const fixtureResponse = await operator.request.post(
    "/api/e2e/automated-request",
    {
      data: {
        title: `Guest access bridge interview ${fixtureId}`,
        assigneeSubject: "unused-for-expert-interview",
        expertInterview: true,
      },
    }
  )
  expect(fixtureResponse.status()).toBe(201)
  const fixture = (await fixtureResponse.json()) as {
    data: { request: { humanId: string } }
  }
  const operatorPage = await operator.newPage()
  await operatorPage.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "clipboard", {
      configurable: true,
      get: () => ({
        writeText: () =>
          Promise.reject(
            new DOMException("Clipboard denied", "NotAllowedError")
          ),
      }),
    })
  })
  await operatorPage.goto(`/app/requests/${fixture.data.request.humanId}`)

  await expect(
    operatorPage.getByRole("heading", { name: "Guest Access Grants" })
  ).toBeVisible()
  const recipient = operatorPage.getByRole("combobox", {
    name: "Response recipient",
  })
  await expect(recipient).toHaveValue("Elie Tchitava elie@fairlend.ca")

  await recipient.fill("Morgan Registered")
  await operatorPage.getByText("Morgan Registered", { exact: true }).click()
  await expect(recipient).toHaveValue(
    "Morgan Registered morgan.registered@example.ca"
  )

  await recipient.fill("morgan.registered@example.ca")
  await operatorPage.getByText("Morgan Registered", { exact: true }).click()
  await expect(recipient).toHaveValue(
    "Morgan Registered morgan.registered@example.ca"
  )

  await operatorPage.getByRole("button", { name: "Add a person" }).click()
  await operatorPage
    .getByRole("textbox", { name: "Display name" })
    .fill("Priya Guest")
  await operatorPage
    .getByRole("textbox", { name: "Email address" })
    .fill(`priya-guest-${fixtureId}@example.ca`)
  await operatorPage.getByRole("button", { name: "Create person" }).click()

  await expect(
    operatorPage.getByRole("combobox", { name: "Response recipient" })
  ).toHaveValue(`Priya Guest priya-guest-${fixtureId}@example.ca`)
  await operatorPage
    .getByRole("button", { name: "Generate & copy link" })
    .click()

  const generatedLink = operatorPage.getByRole("textbox", {
    name: "Generated access link",
  })
  await expect(generatedLink).toBeVisible()
  const accessLink = await generatedLink.inputValue()
  expect(pathname(accessLink)).toMatch(/^\/respond\/[A-Za-z0-9_-]{43}$/)
  await expect(
    operatorPage.getByRole("button", { name: "Copy access link" })
  ).toBeVisible()
  await expect(
    operatorPage.getByText(
      "Automatic copy was blocked. Use the Copy button or select the link.",
      { exact: true }
    )
  ).toBeVisible()
  await expect(generatedLink).toHaveAttribute("readonly", "")
  await expect(
    operatorPage.getByText("Response link generated", { exact: true })
  ).toBeVisible()

  const anonymous = await browser.newContext({
    viewport: projectName.includes("mobile")
      ? { width: 390, height: 844 }
      : { width: 1280, height: 900 },
  })
  await anonymous.addInitScript(() => {
    const fakeStream = {
      getTracks: () => [{ stop: () => undefined }],
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => fakeStream,
      },
    })
    class TestMediaRecorder {
      static isTypeSupported() {
        return true
      }
      mimeType = "audio/webm"
      state: RecordingState = "inactive"
      private listeners = new Map<
        string,
        Array<{ listener: EventListener; once: boolean }>
      >()
      constructor(_stream: unknown, options?: { mimeType?: string }) {
        this.mimeType = options?.mimeType ?? "audio/webm"
      }
      addEventListener(
        type: string,
        listener: EventListener,
        options?: boolean | AddEventListenerOptions
      ) {
        const once =
          typeof options === "object" && options !== null && !!options.once
        this.listeners.set(type, [
          ...(this.listeners.get(type) ?? []),
          { listener, once },
        ])
      }
      private emit(type: string, event: Event) {
        const registered = this.listeners.get(type) ?? []
        for (const { listener } of registered) {
          listener.call(this as unknown as EventTarget, event)
        }
        this.listeners.set(
          type,
          registered.filter(({ once }) => !once)
        )
      }
      start() {
        this.state = "recording"
      }
      pause() {
        this.state = "paused"
      }
      resume() {
        this.state = "recording"
      }
      stop() {
        if (this.state === "inactive") return
        this.state = "inactive"
        queueMicrotask(() => {
          const event = {
            data: new Blob(["browser-recording"], {
              type: this.mimeType,
            }),
          } as BlobEvent
          this.emit("dataavailable", event)
          this.emit("stop", {} as Event)
        })
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: TestMediaRecorder,
    })
  })
  const guestPage = await anonymous.newPage()
  const guestResponse = await guestPage.goto(pathname(accessLink))
  expect(guestResponse?.status()).toBe(200)

  return {
    accessLink,
    anonymous,
    fixtureId,
    generatedLink,
    guestPage,
    humanId: fixture.data.request.humanId,
    operator,
    operatorPage,
    recipient,
  }
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

test("Ticket 05 keeps one active editor across two browser contexts", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const { accessLink, anonymous, guestPage, operator, operatorPage } =
    await setupGuestAccessBrowserFixture(
      browser,
      testInfo.project.name,
      "editor-lease"
    )
  const batchAnswer = "Call the lawyer before the lender cutoff moves."
  const secondDeviceAnswer =
    "Device B verified the payout statement before escalation."

  await expect(
    guestPage.getByText("Editing on this device", { exact: true })
  ).toBeVisible()
  await guestPage.getByRole("button", { name: "Answer all at once" }).click()
  await guestPage
    .getByRole("textbox", { name: "Your complete response" })
    .fill(batchAnswer)
  await guestPage.waitForTimeout(900)
  await settleGuestDraft(guestPage)

  const grantRow = operatorPage
    .locator('li[id^="guest-access-"]')
    .filter({ hasText: "Priya Guest" })
    .first()
  const grantDomId = await grantRow.getAttribute("id")
  expect(grantDomId).toMatch(/^guest-access-/)
  const grantId = grantDomId!.slice("guest-access-".length)
  const leaseState = async (action: string) => {
    const response = await operatorPage.request.post(
      "/api/e2e/guest-grant-state",
      { data: { action, grantId } }
    )
    expect(response.status()).toBe(200)
    return (await response.json()) as {
      data: {
        active: boolean
        generation: number
        expiresAt: number | null
      }
    }
  }
  const initialLease = await leaseState("inspect_editor_lease")
  expect(initialLease.data).toMatchObject({ active: true, generation: 1 })

  const secondAnonymous = await browser.newContext({
    viewport: guestPage.viewportSize() ?? { width: 1280, height: 900 },
  })
  const secondDevice = await secondAnonymous.newPage()
  await secondDevice.goto(pathname(accessLink))
  await expect(
    secondDevice.getByText("This response is active on another device")
  ).toBeVisible()
  await expect(
    secondDevice.getByRole("button", { name: "Answer all at once" })
  ).toBeDisabled()

  await expect
    .poll(
      async () =>
        (await leaseState("inspect_editor_lease")).data.expiresAt ?? 0,
      { timeout: 25_000 }
    )
    .toBeGreaterThan(initialLease.data.expiresAt ?? 0)

  const expiredLease = await leaseState("expire_editor_lease")
  expect(expiredLease.data).toMatchObject({ active: false, generation: 1 })
  await secondDevice.reload()
  await expect(
    secondDevice.getByText("Editing on this device", { exact: true })
  ).toBeVisible()
  await expect
    .poll(
      async () => (await leaseState("inspect_editor_lease")).data.generation
    )
    .toBe(2)

  await secondDevice
    .getByRole("textbox", { name: "Your complete response" })
    .fill(secondDeviceAnswer)
  await secondDevice.waitForTimeout(900)
  await settleGuestDraft(secondDevice)

  await guestPage
    .getByRole("textbox", { name: "Your complete response" })
    .fill("Device A must not overwrite Device B after expiry acquisition.")
  await expect(
    guestPage.getByText("This response is active on another device")
  ).toBeVisible()

  await operatorPage.reload()
  await expect(
    operatorPage.getByText(secondDeviceAnswer, { exact: true })
  ).toBeVisible()
  await expect(
    operatorPage.getByText(
      "Device A must not overwrite Device B after expiry acquisition.",
      { exact: true }
    )
  ).toHaveCount(0)

  await guestPage.getByRole("button", { name: "Take over editing" }).click()
  await expect(
    guestPage.getByText("Editing on this device", { exact: true })
  ).toBeVisible()
  await expect
    .poll(
      async () => (await leaseState("inspect_editor_lease")).data.generation
    )
    .toBe(3)

  await secondDevice
    .getByRole("textbox", { name: "Your complete response" })
    .fill("Device B is stale after Device A explicitly takes over.")
  await expect(
    secondDevice.getByText("This response is active on another device")
  ).toBeVisible()

  await secondAnonymous.close()
  await anonymous.close()
  await operator.close()
})

test("Ticket 03 response text persists across modes, reloads, admin projection, and isolated grants", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  const {
    accessLink,
    anonymous,
    fixtureId,
    generatedLink,
    guestPage,
    operator,
    operatorPage,
    recipient,
  } = await setupGuestAccessBrowserFixture(
    browser,
    testInfo.project.name,
    "response-text"
  )

  await expect(
    guestPage.getByText("No sign-in required", { exact: true })
  ).toBeVisible()
  await expect(
    guestPage.getByText("Private response link", { exact: true })
  ).toBeVisible()
  await expect(
    guestPage.getByRole("heading", {
      name: `Guest access bridge interview ${fixtureId}`,
    })
  ).toBeVisible()
  await expect(
    guestPage.getByText(
      "Bridge financing when purchase and sale dates stop lining up",
      { exact: true }
    )
  ).toBeVisible()
  await expect(
    guestPage.getByText(
      "Ontario homeowners and mortgage professionals handling a time-sensitive purchase.",
      { exact: true }
    )
  ).toBeVisible()
  const firstQuestionDisclosure = guestPage.getByRole("button", {
    name: "Question 1: What is the first call you make when a borrower misses the bank’s bridge timeline?",
    exact: true,
  })
  const secondQuestionDisclosure = guestPage.getByRole("button", {
    name: "Question 2: Which warning sign would a less experienced practitioner miss?",
    exact: true,
  })
  await expect(firstQuestionDisclosure).toHaveAttribute(
    "aria-expanded",
    "false"
  )
  await expect(secondQuestionDisclosure).toHaveAttribute(
    "aria-expanded",
    "false"
  )
  await firstQuestionDisclosure.click()
  await expect(firstQuestionDisclosure).toHaveAttribute("aria-expanded", "true")
  await expect(
    guestPage
      .getByRole("heading", {
        name: "What is the first call you make when a borrower misses the bank’s bridge timeline?",
        exact: true,
      })
      .first()
  ).toBeVisible()
  const firstQuestionMotivation = guestPage.getByText(
    "Readers need a usable recovery sequence, not another eligibility checklist.",
    { exact: true }
  )
  await expect(firstQuestionMotivation.first()).toBeVisible()
  await secondQuestionDisclosure.click()
  await expect(secondQuestionDisclosure).toHaveAttribute(
    "aria-expanded",
    "true"
  )
  const secondQuestionMotivation = guestPage.getByText(
    "This turns lived experience into a transferable decision rule.",
    { exact: true }
  )
  await expect(secondQuestionMotivation.first()).toBeVisible()
  await expect(
    guestPage.getByRole("combobox", {
      name: /person|identity|recipient/i,
    })
  ).toHaveCount(0)
  const guestHtml = await guestPage.content()
  expect(guestHtml).not.toMatch(
    /Priya Guest|priya-guest|gap-recovery|gapIds|operatorInstructions|auditEvents|credentialId|Guest Access Grants/
  )

  const answerMode = guestPage.getByRole("group", { name: "Answer mode" })
  await expect(answerMode).toBeVisible()
  await expect(answerMode.locator("..")).toHaveCSS("position", "fixed")
  const answerModeLayout = await answerMode.evaluate((element) => {
    const rect = element.parentElement?.getBoundingClientRect()
    return rect
      ? {
          bottom: rect.bottom,
          viewportHeight: window.innerHeight,
          firstWidth: element.children[0]?.getBoundingClientRect().width ?? 0,
          secondWidth: element.children[1]?.getBoundingClientRect().width ?? 0,
        }
      : null
  })
  expect(answerModeLayout).not.toBeNull()
  expect(
    Math.abs(answerModeLayout!.bottom - answerModeLayout!.viewportHeight)
  ).toBeLessThanOrEqual(1)
  expect(
    Math.abs(answerModeLayout!.firstWidth - answerModeLayout!.secondWidth)
  ).toBeLessThanOrEqual(1)
  await expect(
    guestPage.getByRole("button", { name: "Answer one at a time" })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(
    guestPage.getByRole("progressbar", { name: "Response progress" })
  ).toContainText("0 of 2 answered")

  const mobileQuestionDisclosure = guestPage.getByRole("button", {
    name: "2. Which warning sign would a less experienced practitioner miss?",
    exact: true,
  })
  const desktopQuestionRailItem = guestPage.getByRole("button", {
    name: "2 Which warning sign would a less experienced practitioner miss?",
    exact: true,
  })
  const secondQuestion =
    (guestPage.viewportSize()?.width ?? 0) < 1024
      ? mobileQuestionDisclosure
      : desktopQuestionRailItem
  if ((guestPage.viewportSize()?.width ?? 0) < 1024) {
    await expect(secondQuestion).toHaveAttribute("aria-expanded", "false")
  }
  await secondQuestion.press("Enter")
  if ((guestPage.viewportSize()?.width ?? 0) < 1024) {
    await expect(secondQuestion).toHaveAttribute("aria-expanded", "true")
  }
  const questionAnswer = guestPage.getByRole("textbox", {
    name: "Your answer",
  })
  await questionAnswer.fill(
    "An unconfirmed payout statement is the warning sign I check first."
  )
  await expect(
    guestPage.getByRole("progressbar", { name: "Response progress" })
  ).toContainText("1 of 2 answered")
  await settleGuestDraft(guestPage)

  await guestPage.getByRole("button", { name: "Answer all at once" }).click()
  const batchResponse = guestPage.getByRole("textbox", {
    name: "Your complete response",
  })
  await expect(batchResponse).toHaveValue("")
  await batchResponse.fill(
    "Call the closing lawyer first, then verify the payout statement before changing the financing path."
  )
  await expect(
    guestPage.getByRole("progressbar", { name: "Response progress" })
  ).toContainText("2 of 2 answered")
  await guestPage.reload()
  await expect(
    guestPage.getByRole("textbox", { name: "Your complete response" })
  ).toHaveValue(
    "Call the closing lawyer first, then verify the payout statement before changing the financing path."
  )
  await settleGuestDraft(guestPage)

  const answerOneAtATime = guestPage.getByRole("button", {
    name: "Answer one at a time",
  })
  await answerOneAtATime.click()
  await expect(answerOneAtATime).toHaveAttribute("aria-pressed", "true")
  await expect(secondQuestion).toBeVisible()
  await secondQuestion.click()
  await expect(
    guestPage.getByRole("textbox", { name: "Your answer" })
  ).toHaveValue(
    "An unconfirmed payout statement is the warning sign I check first."
  )
  await guestPage.getByRole("button", { name: "Answer all at once" }).click()
  await guestPage.waitForTimeout(900)
  await guestPage.reload()
  await expect(
    guestPage.getByRole("button", { name: "Answer all at once" })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(
    guestPage.getByRole("textbox", { name: "Your complete response" })
  ).toHaveValue(
    "Call the closing lawyer first, then verify the payout statement before changing the financing path."
  )
  await settleGuestDraft(guestPage)

  await guestPage
    .getByRole("textbox", { name: "Your complete response" })
    .scrollIntoViewIfNeeded()
  await guestPage.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight })
  })
  const unobscuredLayout = await guestPage.evaluate(() => {
    const mode = document.querySelector(
      '[role="group"][aria-label="Answer mode"]'
    )
    const response = document.querySelector<HTMLTextAreaElement>(
      "#guest-batch-response"
    )
    if (!mode?.parentElement || !response) return null
    return {
      footerTop: mode.parentElement.getBoundingClientRect().top,
      responseBottom: response.getBoundingClientRect().bottom,
    }
  })
  expect(unobscuredLayout).not.toBeNull()
  expect(unobscuredLayout!.responseBottom).toBeLessThanOrEqual(
    unobscuredLayout!.footerTop + 1
  )

  await operatorPage.reload()
  await expect(
    operatorPage.getByRole("heading", { name: "Guest responses" })
  ).toBeVisible()
  await expect(
    operatorPage.getByText(
      "Call the closing lawyer first, then verify the payout statement before changing the financing path.",
      { exact: true }
    )
  ).toBeVisible()
  await expect(
    operatorPage.getByText("2 of 2 answered", { exact: true })
  ).toBeVisible()
  const adminTextareas = await operatorPage
    .locator("textarea")
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLTextAreaElement).value)
    )
  expect(adminTextareas).not.toContain(
    "Call the closing lawyer first, then verify the payout statement before changing the financing path."
  )

  await recipient.fill("Morgan Registered")
  await operatorPage.getByText("Morgan Registered", { exact: true }).click()
  await operatorPage
    .getByRole("button", { name: "Generate & copy link" })
    .click()
  const secondAccessLink = await generatedLink.inputValue()
  expect(secondAccessLink).not.toBe(accessLink)
  const isolatedGuestPage = await anonymous.newPage()
  await isolatedGuestPage.goto(pathname(secondAccessLink))
  await expect(
    isolatedGuestPage.getByRole("progressbar", { name: "Response progress" })
  ).toContainText("0 of 2 answered")
  await expect(
    isolatedGuestPage.getByText(
      "Call the closing lawyer first, then verify the payout statement before changing the financing path.",
      { exact: true }
    )
  ).toHaveCount(0)

  await anonymous.close()
  await operator.close()
})

test("downstream guest evidence, recording, and submission capabilities compose with response text", async ({
  browser,
}, testInfo) => {
  const { accessLink, anonymous, fixtureId, guestPage, operator } =
    await setupGuestAccessBrowserFixture(
      browser,
      testInfo.project.name,
      "response-capabilities"
    )

  await guestPage.getByRole("button", { name: "Answer all at once" }).click()
  const batchResponse = guestPage.getByRole("textbox", {
    name: "Your complete response",
  })
  await batchResponse.fill(
    "Call the closing lawyer first, then verify the payout statement."
  )
  await guestPage.waitForTimeout(900)
  await expect(
    guestPage.getByText("Saved", { exact: true }).first()
  ).toBeVisible()

  await expect(
    guestPage.getByRole("heading", {
      name: "Voice and supporting evidence",
    })
  ).toBeVisible()
  const attachmentInput = guestPage.locator(
    'input[type="file"][accept*="application/pdf"]'
  )
  await attachmentInput.setInputFiles({
    name: "permit-sequence.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Call the permit desk before filing."),
  })
  await expect(
    guestPage.getByText("permit-sequence.txt", { exact: true })
  ).toBeVisible()
  await expect(guestPage.getByText(/uploaded/i)).toBeVisible()

  await guestPage.getByRole("button", { name: "Press to record" }).click()
  await guestPage.getByRole("button", { name: "Stop and save" }).click()
  await expect(guestPage.getByText(/expert-response-.*\.webm/)).toBeVisible()

  const accessibility = await new AxeBuilder({ page: guestPage })
    .include("main")
    .analyze()
  expect(accessibility.violations).toEqual([])

  const submitResponse = guestPage.getByRole("button", {
    name: "Submit response",
  })
  await submitResponse.scrollIntoViewIfNeeded()
  await guestPage.evaluate(() => window.scrollBy(0, window.innerHeight))
  const unobscuredLayout = await guestPage.evaluate(() => {
    const mode = document.querySelector(
      '[role="group"][aria-label="Answer mode"]'
    )
    const submit = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Submit response")
    )
    if (!mode?.parentElement || !submit) return null
    return {
      footerTop: mode.parentElement.getBoundingClientRect().top,
      submitBottom: submit.getBoundingClientRect().bottom,
    }
  })
  expect(unobscuredLayout).not.toBeNull()
  expect(unobscuredLayout!.submitBottom).toBeLessThanOrEqual(
    unobscuredLayout!.footerTop + 1
  )

  const invalidPage = await anonymous.newPage()
  const invalidResponse = await invalidPage.goto(`/respond/${"A".repeat(43)}`)
  expect(invalidResponse?.status()).toBe(404)
  const invalidHtml = await invalidPage.content()
  expect(invalidHtml).not.toContain(
    `Guest access bridge interview ${fixtureId}`
  )
  expect(invalidHtml).not.toContain(
    "Bridge financing when purchase and sale dates stop lining up"
  )
  expect(invalidHtml).not.toContain("Priya Guest")

  const legacySharePage = await anonymous.newPage()
  const legacyShareResponse = await legacySharePage.goto(
    pathname(accessLink).replace("/respond/", "/share/")
  )
  expect(legacyShareResponse?.status()).toBe(404)
  expect(await legacySharePage.content()).not.toContain(
    `Guest access bridge interview ${fixtureId}`
  )

  await anonymous.close()
  await operator.close()
})

test("Ticket 06 recovers a failed recording upload from IndexedDB after page loss", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const { accessLink, anonymous, guestPage, operator, operatorPage } =
    await setupGuestAccessBrowserFixture(
      browser,
      testInfo.project.name,
      "offline-recording-recovery"
    )

  await expect(
    guestPage.getByText("Editing on this device", { exact: true })
  ).toBeVisible()
  await guestPage.route("**/api/e2e/storage-upload", (route) => route.abort())
  await guestPage.getByRole("button", { name: "Press to record" }).click()
  await guestPage.getByRole("button", { name: "Stop and save" }).click()
  await expect(
    guestPage.getByRole("button", { name: "Discard pending recordings" })
  ).toBeVisible()

  const grantRow = operatorPage
    .locator('li[id^="guest-access-"]')
    .filter({ hasText: "Priya Guest" })
    .first()
  const grantDomId = await grantRow.getAttribute("id")
  expect(grantDomId).toMatch(/^guest-access-/)
  const grantId = grantDomId!.slice("guest-access-".length)
  await guestPage.close()
  const expiredLease = await operatorPage.request.post(
    "/api/e2e/guest-grant-state",
    { data: { action: "expire_editor_lease", grantId } }
  )
  expect(expiredLease.status()).toBe(200)
  const recoveredPage = await anonymous.newPage()
  await recoveredPage.goto(pathname(accessLink))

  await expect(
    recoveredPage.getByText("Editing on this device", { exact: true })
  ).toBeVisible()
  await expect(recoveredPage.getByText(/expert-response-.*\.webm/)).toBeVisible(
    { timeout: 15_000 }
  )
  await expect(
    recoveredPage.getByText(
      /Complete response · (Transcribing|Transcript ready)/
    )
  ).toBeVisible()
  await expect(
    recoveredPage.getByRole("button", { name: "Discard pending recordings" })
  ).toHaveCount(0)

  const accessibility = await new AxeBuilder({ page: recoveredPage })
    .include("main")
    .analyze()
  expect(accessibility.violations).toEqual([])

  await anonymous.close()
  await operator.close()
})

test("expert synthesis selection is keyboard operable, responsive, and persists after reload", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  const {
    accessLink,
    anonymous,
    fixtureId,
    generatedLink,
    guestPage,
    humanId,
    operator,
    operatorPage,
    recipient,
  } = await setupGuestAccessBrowserFixture(
    browser,
    testInfo.project.name,
    "synthesis-selection"
  )

  await operatorPage
    .getByText("Record options & delivery", { exact: true })
    .click()
  await operatorPage
    .getByRole("combobox", { name: "Accountable assignee" })
    .selectOption({ label: "user_elie · founder" })
  await operatorPage.getByRole("button", { name: "Update assignment" }).click()
  await expect(operatorPage.getByText("Assigned to user_elie")).toBeVisible()

  const founder = await browser.newContext({
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
  const founderPage = await founder.newPage()
  await founderPage.goto(`/app/requests/${humanId}`)
  await founderPage.getByRole("button", { name: "Type input" }).click()
  await founderPage
    .getByRole("textbox", { name: "Founder input" })
    .fill(
      "Founder evidence: call the lawyer first, then ask the lender closing desk to confirm the payout cutoff."
    )
  await expect(founderPage.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 15_000,
  })
  await founderPage.getByRole("button", { name: "Submit to drafting" }).click()
  await expect(founderPage).toHaveURL(/\/app$/)

  const secondQuestion =
    (guestPage.viewportSize()?.width ?? 0) < 1024
      ? guestPage.getByRole("button", {
          name: "2. Which warning sign would a less experienced practitioner miss?",
          exact: true,
        })
      : guestPage.getByRole("button", {
          name: "2 Which warning sign would a less experienced practitioner miss?",
          exact: true,
        })
  await secondQuestion.press("Enter")
  await guestPage
    .getByRole("textbox", { name: "Your answer" })
    .fill("An unconfirmed payout statement is the warning sign.")
  await settleGuestDraft(guestPage)

  await guestPage.getByRole("button", { name: "Answer all at once" }).click()
  await guestPage
    .getByRole("textbox", { name: "Your complete response" })
    .fill("Call the closing lawyer first and verify the payout statement.")
  await settleGuestDraft(guestPage)
  await guestPage
    .locator('input[type="file"][accept*="application/pdf"]')
    .setInputFiles({
      name: "synthesis-support.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Escalate once the payout statement misses cutoff."),
    })
  await expect(
    guestPage.getByText("synthesis-support.txt", { exact: true })
  ).toBeVisible()
  await expect(guestPage.getByText(/uploaded/i)).toBeVisible()
  await guestPage.getByRole("button", { name: "Press to record" }).click()
  await guestPage.getByRole("button", { name: "Stop and save" }).click()
  const audioTitle = guestPage.getByText(/expert-response-.*\.webm/)
  await expect(audioTitle).toBeVisible()
  await expect(
    guestPage.getByText(/Complete response · (Transcribing|Transcript ready)/)
  ).toBeVisible({ timeout: 15_000 })
  const fileName = await audioTitle.textContent()
  expect(fileName).toBeTruthy()
  const transcription = await operatorPage.request.post(
    "/api/e2e/settle-transcription",
    { data: { fileName } }
  )
  expect(transcription.status()).toBe(200)
  await expect(guestPage.getByText("Transcript ready")).toBeVisible({
    timeout: 10_000,
  })
  await guestPage.getByRole("button", { name: "Submit response" }).click()
  await expect(
    guestPage.getByRole("radiogroup", {
      name: "Choose which response to submit",
    })
  ).toBeVisible()
  const firstSubmissionConfirmation = guestPage.getByRole("button", {
    name: "Yes, submit response",
  })
  await expect(firstSubmissionConfirmation).toBeDisabled()
  await guestPage
    .getByRole("radio", { name: /^Answer one question at a time/ })
    .click()
  await expect(firstSubmissionConfirmation).toBeEnabled()
  const submissionDialogAccessibility = await new AxeBuilder({
    page: guestPage,
  })
    .include('[role="alertdialog"]')
    .analyze()
  expect(submissionDialogAccessibility.violations).toEqual([])
  await firstSubmissionConfirmation.click()
  await expect(
    guestPage.getByRole("button", { name: /Response submitted/ })
  ).toBeDisabled()

  await operatorPage.reload()
  await expect(
    operatorPage.getByRole("heading", { name: "Guest responses" })
  ).toBeVisible()
  await expect(
    operatorPage
      .getByText("An unconfirmed payout statement is the warning sign.", {
        exact: true,
      })
      .first()
  ).toBeVisible()
  const firstImmutableSubmission = operatorPage
    .getByRole("region", { name: "Immutable submission history" })
    .last()
    .locator(":scope > ol > li")
    .first()
  await expect(firstImmutableSubmission).toContainText(
    "An unconfirmed payout statement is the warning sign."
  )
  await expect(firstImmutableSubmission).not.toContainText(
    "Call the closing lawyer first and verify the payout statement."
  )
  await operatorPage
    .getByRole("textbox", { name: "Feedback" })
    .fill("Please add the exact escalation point before final synthesis.")
  await operatorPage.getByRole("button", { name: "Add feedback" }).click()
  await expect(
    operatorPage.getByText(
      "Please add the exact escalation point before final synthesis.",
      { exact: true }
    )
  ).toBeVisible()
  const reopenResponse = operatorPage.getByRole("button", {
    name: "Reopen response",
  })
  await reopenResponse.click()
  await expect(
    operatorPage.getByText("In progress", { exact: true }).first()
  ).toBeVisible()
  await operatorPage.reload()
  await expect(
    operatorPage.getByText("In progress", { exact: true }).first()
  ).toBeVisible()
  await guestPage.reload()
  await expect(
    guestPage.getByText(
      "Please add the exact escalation point before final synthesis.",
      { exact: true }
    )
  ).toBeVisible()
  await expect(
    guestPage.getByText("Editing on this device", { exact: true })
  ).toBeVisible({ timeout: 15_000 })
  const reopenedBatchResponse = guestPage.getByRole("textbox", {
    name: "Your complete response",
  })
  await expect(reopenedBatchResponse).toBeEnabled()
  await reopenedBatchResponse.fill(
    "Call the closing lawyer first and verify the payout statement. Escalate to the lender's closing desk when the payout remains unconfirmed."
  )
  await settleGuestDraft(guestPage)
  const resubmitResponse = guestPage.getByRole("button", {
    name: "Submit response",
  })
  await expect(resubmitResponse).toBeEnabled({ timeout: 15_000 })
  await resubmitResponse.click()
  await guestPage.getByRole("radio", { name: /^Answer all at once/ }).click()
  await guestPage.getByRole("button", { name: "Yes, submit response" }).click()
  await expect(
    guestPage.getByRole("button", { name: /Response submitted/ })
  ).toBeDisabled()

  await operatorPage.reload()
  await operatorPage.getByRole("button", { name: "Add a person" }).click()
  await operatorPage
    .getByRole("textbox", { name: "Display name" })
    .fill("Noah Guest")
  await operatorPage
    .getByRole("textbox", { name: "Email address" })
    .fill(`noah-guest-${fixtureId}@example.ca`)
  await operatorPage.getByRole("button", { name: "Create person" }).click()
  await expect(recipient).toHaveValue(
    `Noah Guest noah-guest-${fixtureId}@example.ca`
  )
  await operatorPage
    .getByRole("button", { name: "Generate & copy link" })
    .click()
  await expect(generatedLink).toBeVisible()
  const secondAccessLink = await generatedLink.inputValue()
  expect(secondAccessLink).not.toBe(accessLink)

  const secondGuestPage = await anonymous.newPage()
  await secondGuestPage.goto(pathname(secondAccessLink))
  await secondGuestPage
    .getByRole("button", { name: "Answer all at once" })
    .click()
  await secondGuestPage
    .getByRole("textbox", { name: "Your complete response" })
    .fill(
      "Call the lender closing desk first; the lawyer should follow once the funding cutoff and missing payout statement are confirmed."
    )
  await settleGuestDraft(secondGuestPage)
  await secondGuestPage.getByRole("button", { name: "Submit response" }).click()
  await secondGuestPage
    .getByRole("button", { name: "Yes, submit response" })
    .click()
  await expect(
    secondGuestPage.getByRole("button", { name: /Response submitted/ })
  ).toBeDisabled()
  for (const respondentPage of [guestPage, secondGuestPage]) {
    const guestAccessibility = await new AxeBuilder({
      page: respondentPage,
    })
      .include("main")
      .analyze()
    expect(guestAccessibility.violations).toEqual([])
  }

  await operatorPage.reload()
  const submissionHistory = operatorPage
    .getByRole("region", {
      name: "Immutable submission history",
    })
    .last()
  const submissionSnapshots = submissionHistory.locator(":scope > ol > li")
  await expect(submissionSnapshots).toHaveCount(2)
  await expect(submissionSnapshots.nth(0)).toContainText(
    "An unconfirmed payout statement is the warning sign."
  )
  await expect(submissionSnapshots.nth(0)).not.toContainText(
    "Call the closing lawyer first and verify the payout statement."
  )
  await expect(submissionSnapshots.nth(1)).toContainText(
    "Escalate to the lender's closing desk when the payout remains unconfirmed."
  )
  await expect(
    operatorPage.getByRole("heading", {
      name: "Expert synthesis selection",
    })
  ).toBeVisible()
  const excludeHistoricalPriya = operatorPage
    .getByRole("button", {
      name: /Exclude Priya Guest, revision \d+, submission .+ from synthesis/,
    })
    .first()
  await excludeHistoricalPriya.focus()
  await excludeHistoricalPriya.press("Enter")
  await expect(excludeHistoricalPriya).toHaveAttribute("aria-pressed", "true")

  const includePriya = operatorPage
    .getByRole("button", {
      name: /Include Priya Guest, revision \d+, submission .+ in synthesis/,
    })
    .last()
  await includePriya.focus()
  await includePriya.press("Enter")
  await expect(includePriya).toHaveAttribute("aria-pressed", "true")

  const includeNoah = operatorPage.getByRole("button", {
    name: /Include Noah Guest, revision \d+, submission .+ in synthesis/,
  })
  await includeNoah.focus()
  await includeNoah.press("Enter")
  await expect(includeNoah).toHaveAttribute("aria-pressed", "true")

  const includeFounder = operatorPage.getByRole("button", {
    name: /Include Elie(?: Tchitava)?, revision \d+, submission .+ in synthesis/,
  })
  await includeFounder.focus()
  await includeFounder.press("Enter")
  await expect(includeFounder).toHaveAttribute("aria-pressed", "true")

  await operatorPage.reload()
  const persistedInclude = operatorPage
    .getByRole("button", {
      name: /Include Priya Guest, revision \d+, submission .+ in synthesis/,
    })
    .last()
  await expect(persistedInclude).toHaveAttribute("aria-pressed", "true")
  await expect(
    operatorPage.getByRole("button", {
      name: /Include Noah Guest, revision \d+, submission .+ in synthesis/,
    })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(
    operatorPage.getByRole("button", {
      name: /Include Elie(?: Tchitava)?, revision \d+, submission .+ in synthesis/,
    })
  ).toHaveAttribute("aria-pressed", "true")

  await operatorPage
    .getByLabel("Priority synthesis instructions")
    .fill(
      "Preserve the disagreement between the two guests and distinguish the founder's operational evidence."
    )
  await operatorPage
    .getByRole("button", { name: "Prepare attributed bundle" })
    .click()
  await expect(operatorPage.getByText(/Payload SHA-256:/)).toBeVisible()
  await operatorPage
    .getByText("Inspect shared prompt and bundle", { exact: true })
    .click()
  await expect(operatorPage.getByText(/Priya Guest/).last()).toBeVisible()
  await expect(operatorPage.getByText(/Noah Guest/).last()).toBeVisible()

  const agent = await browser.newContext({
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: `synthesis_agent_${fixtureId}`,
        organizationId: "org_fairlend",
        email: `synthesis-agent-${fixtureId}@fairlend.ca`,
        displayName: "Synthesis agent",
        workosRole: "agent-editor",
      }),
    },
  })
  const claimKey = `synthesis-claim-${humanId}`
  const claimResponse = await agent.request.post("/api/v1/control", {
    data: {
      command: {
        operation: "job.claim",
        arguments: { humanId, leaseMs: 30_000 },
        idempotencyKey: claimKey,
      },
    },
  })
  await expectApiStatus(claimResponse, 200)
  const claim = (await claimResponse.json()) as {
    data: {
      jobId: string
      leaseGeneration: number
      requestHumanId: string
    }
  }
  expect(claim.data.requestHumanId).toBe(humanId)
  const submissionsResponse = await agent.request.post("/api/v1/control", {
    data: {
      command: {
        operation: "expert_interview.submissions",
        arguments: { humanId },
      },
    },
  })
  expect(submissionsResponse.status()).toBe(200)
  const submissionsPayload = (await submissionsResponse.json()) as {
    data: Array<{
      submissionId: string
      source: "guest" | "founder"
      respondent: { displayName: string }
      inclusion: { state: "included" | "excluded" | "undecided" }
    }>
  }
  const includedSubmissions = submissionsPayload.data.filter(
    ({ inclusion }) => inclusion.state === "included"
  )
  expect(includedSubmissions).toHaveLength(3)
  expect(
    includedSubmissions.filter(({ source }) => source === "guest")
  ).toHaveLength(2)
  expect(
    includedSubmissions.filter(({ source }) => source === "founder")
  ).toHaveLength(1)
  const submissionIds = includedSubmissions.map(
    ({ submissionId }) => submissionId
  )
  const processingResponse = await agent.request.post("/api/v1/control", {
    data: {
      command: {
        operation: "expert_interview.processing_input",
        arguments: {
          humanId,
          submissionIds,
          synthesisInstructions:
            "Preserve disagreement and keep every practitioner claim attributable.",
        },
        idempotencyKey: `synthesis-prepare-${humanId}`,
      },
    },
  })
  await expectApiStatus(processingResponse, 200)
  const processingPayload = (await processingResponse.json()) as {
    data: {
      contextVersionIds: Array<string>
      payloadDigest: string
      processingSnapshot: {
        processingToken: string
        submissionIds: Array<string>
        contextVersionIds: Array<string>
      }
    }
  }
  expect(processingPayload.data.processingSnapshot.contextVersionIds).toEqual(
    processingPayload.data.contextVersionIds
  )
  const synthesisBody = `# Attributed bridge-recovery synthesis

Priya starts with the closing lawyer, while Noah starts with the lender closing desk. Elie's founder evidence supports confirming the payout cutoff before the recovery path is finalized.`
  const completionResponse = await agent.request.post("/api/v1/control", {
    data: {
      command: {
        operation: "expert_interview.complete_processing",
        arguments: {
          humanId,
          submissionIds:
            processingPayload.data.processingSnapshot.submissionIds,
          processingToken:
            processingPayload.data.processingSnapshot.processingToken,
          payloadDigest: processingPayload.data.payloadDigest,
          body: synthesisBody,
          jobId: claim.data.jobId,
          leaseToken: claimKey,
          leaseGeneration: claim.data.leaseGeneration,
          name: "Attributed bridge-recovery synthesis",
        },
        idempotencyKey: `synthesis-complete-${humanId}`,
      },
    },
  })
  await expectApiStatus(completionResponse, 200)
  const completionPayload = (await completionResponse.json()) as {
    data: {
      deliverable: { versions: Array<{ body: string }> }
      attribution: {
        submissionIds: Array<string>
        contextVersionIds: Array<string>
        payloadDigest: string
        provenanceId: string
      }
    }
  }
  expect(completionPayload.data.attribution.submissionIds).toEqual(
    submissionIds
  )
  expect(completionPayload.data.attribution.contextVersionIds).toEqual(
    processingPayload.data.contextVersionIds
  )
  expect(completionPayload.data.attribution.payloadDigest).toBe(
    processingPayload.data.payloadDigest
  )
  expect(completionPayload.data.attribution.provenanceId).toMatch(/\S+/)
  expect(
    completionPayload.data.deliverable.versions.some(
      ({ body }) => body === synthesisBody
    )
  ).toBe(true)

  await operatorPage.reload()
  await expect(
    operatorPage.getByText("Ready to respond", { exact: true })
  ).toBeVisible()
  await operatorPage
    .getByText("Record options & delivery", { exact: true })
    .click()
  await expect(
    operatorPage
      .getByRole("heading", {
        name: "Attributed bridge-recovery synthesis",
      })
      .first()
  ).toBeVisible()
  await expect(
    operatorPage
      .getByText(
        "Priya starts with the closing lawyer, while Noah starts with the lender closing desk. Elie's founder evidence supports confirming the payout cutoff before the recovery path is finalized.",
        { exact: true }
      )
      .first()
  ).toBeVisible()
  await operatorPage.setViewportSize({ width: 390, height: 844 })
  await expect(persistedInclude).toBeVisible()
  const bounds = await persistedInclude.boundingBox()
  expect(bounds?.height).toBeGreaterThanOrEqual(44)
  expect(bounds?.x).toBeGreaterThanOrEqual(0)
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390)
  const accessibility = await new AxeBuilder({ page: operatorPage })
    .include('[aria-labelledby="expert-synthesis-heading"]')
    .analyze()
  expect(accessibility.violations).toEqual([])

  const grantRow = operatorPage
    .locator('li[id^="guest-access-"]')
    .filter({ hasText: "Priya Guest" })
    .first()
  const grantDomId = await grantRow.getAttribute("id")
  expect(grantDomId).toMatch(/^guest-access-/)
  const grantId = grantDomId!.slice("guest-access-".length)
  const expired = await operatorPage.request.post(
    "/api/e2e/guest-grant-state",
    {
      data: { action: "expire", grantId },
    }
  )
  expect(expired.status()).toBe(200)
  await expect(
    guestPage.getByRole("heading", {
      name: "This response link has expired",
    })
  ).toBeVisible({ timeout: 10_000 })
  expect(await guestPage.content()).not.toContain(
    "Call the closing lawyer first and verify the payout statement."
  )

  await operatorPage.reload()
  await expect(grantRow.getByText("expired", { exact: true })).toBeVisible()
  await grantRow.getByRole("button", { name: "Renew link" }).click()
  await expect(generatedLink).toBeVisible()
  const renewedLink = await generatedLink.inputValue()
  expect(renewedLink).not.toBe(accessLink)
  const staleResponse = await guestPage.reload()
  expect(staleResponse?.status()).toBe(404)

  const renewedPage = await anonymous.newPage()
  await renewedPage.goto(pathname(renewedLink))
  await expect(
    renewedPage.getByRole("heading", {
      name: `Guest access bridge interview synthesis-selection-${testInfo.project.name}`,
    })
  ).toBeVisible()
  await expect(
    renewedPage.getByRole("textbox", { name: "Your complete response" })
  ).toHaveValue(
    "Call the closing lawyer first and verify the payout statement. Escalate to the lender's closing desk when the payout remains unconfirmed."
  )
  await expect(
    renewedPage.getByRole("button", { name: /Response submitted/ })
  ).toBeDisabled()
  await grantRow.getByRole("button", { name: "Revoke" }).click()
  await grantRow.getByRole("button", { name: "Confirm revoke" }).click()
  await expect(grantRow.getByText("revoked", { exact: true })).toBeVisible()
  await expect(
    renewedPage.getByRole("heading", { name: "Page not found" })
  ).toBeVisible({ timeout: 10_000 })
  expect(await renewedPage.content()).not.toContain(
    "Call the closing lawyer first and verify the payout statement."
  )

  await agent.close()
  await founder.close()
  await anonymous.close()
  await operator.close()
})

test("administrators receive all populated guest notification signals with valid deep links", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: {
      "x-fairlend-e2e-key": "local-playwright-only",
      "x-fairlend-e2e-user": JSON.stringify({
        subject: `guest_notification_admin_${testInfo.project.name}`,
        organizationId: "org_fairlend",
        email: `guest-notification-admin-${testInfo.project.name}@fairlend.ca`,
        displayName: "Guest notification administrator",
        workosRole: "admin",
      }),
    },
  })
  const page = await context.newPage()
  const fixture = await page.request.post("/api/e2e/automated-request", {
    data: {
      title: `Guest notification signals ${testInfo.project.name}`,
      assigneeSubject: "unused-for-expert-interview",
      expertInterview: true,
      seedGuestNotifications: true,
    },
  })
  expect(fixture.status()).toBe(201)
  const payload = (await fixture.json()) as {
    data: {
      request: { humanId: string }
      notificationSignals: {
        submission: { grantId: string; submissionId: string }
        expiry: { grantId: string }
        upload: { grantId: string; assetId: string }
        evidence: {
          notificationTypes: Array<string>
          deliveryTemplates: Array<string>
          auditOperations: Array<string>
          allNotificationsQueuedEmail: boolean
        }
      }
    }
  }
  expect(payload.data.notificationSignals.evidence).toEqual({
    notificationTypes: [
      "guest_expiry_approaching",
      "guest_submission",
      "guest_upload_failed",
    ],
    deliveryTemplates: [
      "guest_expiry_approaching",
      "guest_submission",
      "guest_upload_failed",
    ],
    auditOperations: [
      "guest_evidence.upload_failed",
      "guest_response.submitted",
      "notification.guest_expiry_approaching",
    ],
    allNotificationsQueuedEmail: true,
  })

  await page.goto("/app")
  const notifications = page.getByRole("button", { name: "Notifications" })
  await expect(notifications).toBeEnabled()
  await expect
    .poll(async () =>
      Number(await notifications.locator(".notification-count").textContent())
    )
    .toBeGreaterThanOrEqual(3)
  await notifications.click()
  await expect(notifications).toHaveAttribute("aria-expanded", "true")
  const submissionHref = `/app/requests/${payload.data.request.humanId}#guest-access-${payload.data.notificationSignals.submission.grantId}`
  const expiryHref = `/app/requests/${payload.data.request.humanId}#guest-access-${payload.data.notificationSignals.expiry.grantId}`
  const uploadHref = `/app/requests/${payload.data.request.humanId}#guest-access-${payload.data.notificationSignals.upload.grantId}-asset-${payload.data.notificationSignals.upload.assetId}`
  const submission = page.locator(`a[href="${submissionHref}"]`)
  const expiry = page.locator(`a[href="${expiryHref}"]`)
  const upload = page.locator(`a[href="${uploadHref}"]`)
  await expect(submission).toContainText("An expert response was submitted")
  await expect(expiry).toContainText("An expert response link expires soon")
  await expect(upload).toContainText("An expert upload needs attention")
  await expect(submission).toHaveAttribute("href", submissionHref)
  await expect(expiry).toHaveAttribute("href", expiryHref)
  await expect(upload).toHaveAttribute("href", uploadHref)
  await upload.click()
  await expect(page).toHaveURL(
    new RegExp(
      `#guest-access-${payload.data.notificationSignals.upload.grantId}-asset-${payload.data.notificationSignals.upload.assetId}$`
    )
  )
  await expect(
    page.getByRole("article", {
      name: "Evidence: failed-notification-evidence.pdf",
    })
  ).toBeVisible()
  const accessibility = await new AxeBuilder({ page }).include("main").analyze()
  expect(accessibility.violations).toEqual([])

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
  const archiveCollection = page.getByRole("button", {
    name: "View archived requests",
  })
  await expect(archiveCollection).toBeVisible()
  await archiveCollection.click()
  await expect(archiveCollection).toHaveAttribute("aria-pressed", "true")
  await expect(
    page.getByRole("heading", { name: "No archived requests" })
  ).toBeVisible()
  const activeCollection = page.getByRole("button", {
    name: "View active requests",
  })
  await activeCollection.click()
  await expect(activeCollection).toHaveAttribute("aria-pressed", "true")
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
  const queueBounds = await needsElie.boundingBox()
  expect(queueBounds?.height).toBeGreaterThanOrEqual(44)
  await needsElie.click()
  await expect(needsElie).toHaveAttribute("aria-pressed", "true")
  await page
    .getByRole("searchbox", { name: "Search content requests" })
    .fill(title)
  await page.getByRole("button", { name: "Apply filters" }).click()
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
  expect(gridColumns).toBe(desktop ? 3 : 1)
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
  const requestPath = pathname(operatorPage.url())
  const humanId = requestPath.split("/").at(-1)
  if (!humanId)
    throw new Error("Created request URL did not contain a human ID.")
  expect(humanId).toMatch(/^CR-[A-Z0-9]+$/)
  await operatorPage
    .getByText("Record options & delivery", { exact: true })
    .click()
  await operatorPage
    .getByRole("combobox", { name: "Accountable assignee" })
    .selectOption({ label: `${founderSubject} · founder` })
  await operatorPage.getByRole("button", { name: "Update assignment" }).click()
  await expect(
    operatorPage.getByText(`Assigned to ${founderSubject}`)
  ).toBeVisible()

  await founderPage.reload()
  await founderPage.getByText(title, { exact: true }).click()
  await founderPage.getByRole("button", { name: "Type input" }).click()
  await founderPage
    .getByRole("textbox", { name: "Founder input" })
    .fill(
      "Compare the full borrowing cost, prepayment flexibility, and how the renewal fits the borrower's next five years."
    )
  await expect(founderPage.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 15_000,
  })
  const submitFounder = founderPage.getByRole("button", {
    name: "Submit to drafting",
  })
  await expect(submitFounder).toBeEnabled()
  await submitFounder.click()
  await expect(founderPage).toHaveURL(/\/app$/)

  const claimKey = `canonical-claim-${humanId}`
  const claimResponse = await agentContext.request.post("/api/v1/control", {
    data: {
      command: {
        operation: "job.claim",
        arguments: { humanId, leaseMs: 30_000 },
        idempotencyKey: claimKey,
      },
    },
  })
  await expectApiStatus(claimResponse, 200)
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
          idempotencyKey: `canonical-complete-${humanId}`,
        },
      },
    }
  )
  await expectApiStatus(completionResponse, 200)

  await operatorPage.goto(requestPath)
  await operatorPage
    .getByText("Record options & delivery", { exact: true })
    .click()
  await expect(
    operatorPage.getByRole("heading", { name: "Ready to respond" })
  ).toBeVisible()
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
  await operatorPage
    .getByRole("button", { name: /^Mark .* responded$/ })
    .click()
  await expect(
    operatorPage.getByRole("button", { name: /^Reopen delivery to / })
  ).toBeVisible({ timeout: 15_000 })
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
    .getByRole("link", { name: new RegExp(humanId) })
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
    .getByText("Record options & delivery", { exact: true })
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
    .getByText("Record options & delivery", { exact: true })
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
  expect(stackMetrics.scrollSnapType).not.toContain("x")
  expect(stackMetrics).toMatchObject({ start: 0, end: 0, overflow: 0 })
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
  const pinBounds = await filterPin.boundingBox()
  expect(pinBounds?.width).toBeGreaterThanOrEqual(44)
  expect(pinBounds?.height).toBeGreaterThanOrEqual(44)
  await filterPin.click()
  await expect(
    founderPage.getByRole("article", { name: "Original source" })
  ).toHaveAttribute("data-pinned", "true")
  await expect(founderPage.getByText(completeSource)).toBeVisible()
  const backAction = founderPage.getByRole("link", {
    name: "Back to content requests",
  })
  const backBounds = await backAction.boundingBox()
  expect(backBounds?.width).toBeGreaterThanOrEqual(44)
  expect(backBounds?.height).toBeGreaterThanOrEqual(44)
  const cardPin = founderPage.getByRole("button", {
    name: "Unpin Original source card",
  })
  const cardPinBounds = await cardPin.boundingBox()
  expect(cardPinBounds?.width).toBeGreaterThanOrEqual(44)
  expect(cardPinBounds?.height).toBeGreaterThanOrEqual(44)
  const editor = founderPage.getByTestId("founder-editor")
  await expect(editor).toHaveAttribute("data-expanded", "false")
  await expect(editor).toHaveAttribute("data-detent", "peek")
  await expect(founderPage.locator('[data-slot="drawer-overlay"]')).toHaveCount(
    0
  )
  await expect(
    founderPage.getByRole("main", { name: "Content Request workspace" })
  ).not.toHaveAttribute("aria-hidden", "true")
  const drawer = founderPage.getByTestId("founder-editor-drawer")
  const drawerBounds = await drawer.boundingBox()
  const viewport = founderPage.viewportSize()
  expect(drawerBounds).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(viewport!.height - drawerBounds!.y).toBeGreaterThanOrEqual(68)
  expect(viewport!.height - drawerBounds!.y).toBeLessThanOrEqual(96)
  const flowPositions = await founderPage.evaluate(() => ({
    app: getComputedStyle(document.querySelector(".app-header")!).position,
    request: getComputedStyle(
      document.querySelector(".unified-canvas__topbar")!
    ).position,
    context: getComputedStyle(
      document.querySelector(".unified-context-deck__controls")!
    ).position,
  }))
  expect(flowPositions.app).not.toBe("sticky")
  expect(flowPositions.request).not.toBe("sticky")
  expect(flowPositions.context).not.toBe("sticky")
  const transitionDuration = await editor.evaluate(
    (element) => getComputedStyle(element).transitionDuration
  )
  expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001)
  const recordMode = founderPage.getByRole("button", { name: "Record input" })
  const recordBounds = await recordMode.boundingBox()
  expect(recordBounds?.height).toBeGreaterThanOrEqual(44)
  await recordMode.focus()
  await founderPage.keyboard.press("Enter")
  await expect(editor).toHaveAttribute("data-detent", "compose")
  const recordSurface = founderPage.getByRole("button", {
    name: "Press to record",
  })
  await expect(recordSurface).toBeVisible()
  await founderPage
    .getByRole("button", { name: "Hide Original question" })
    .click()
  await expect(
    founderPage.getByRole("article", { name: "Original question" })
  ).toHaveCount(0)
  const recordLayout = await editor.evaluate((element) => {
    const input = element.querySelector(".unified-editor__input")
    const trigger = element.querySelector(".unified-editor__record-trigger")
    const submit = element.querySelector(".unified-editor__submit-row")
    if (!input || !trigger || !submit) return null
    const inputRect = input.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    const submitRect = submit.getBoundingClientRect()
    return {
      inputTop: inputRect.top,
      inputBottom: inputRect.bottom,
      triggerTop: triggerRect.top,
      triggerBottom: triggerRect.bottom,
      submitTop: submitRect.top,
      submitBottom: submitRect.bottom,
      editorBottom: element.getBoundingClientRect().bottom,
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
  expect(recordLayout!.submitBottom).toBeLessThanOrEqual(
    recordLayout!.editorBottom + 1
  )
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
    await recordSurface.click()
    await expect(
      founderPage.getByText(
        "Allow microphone access in your browser, then try again. Your typed input is unchanged."
      )
    ).toBeVisible()
  }
  const typeMode = founderPage.getByRole("button", { name: "Type input" })
  const typeBounds = await typeMode.boundingBox()
  expect(typeBounds?.height).toBeGreaterThanOrEqual(44)
  await typeMode.focus()
  await expect(typeMode).toBeFocused()
  await founderPage.keyboard.press("Enter")
  const typedInput = founderPage.getByRole("textbox", {
    name: "Founder input",
  })
  await expect(typedInput).toBeVisible()
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
  await founderPage.getByRole("button", { name: "Collapse editor" }).click()
  await expect(editor).toHaveAttribute("data-detent", "peek")
  await founderPage.getByRole("button", { name: "Expand editor" }).click()
  await expect(editor).toHaveAttribute("data-detent", "full")
  await expect(
    founderPage.getByRole("textbox", { name: "Founder input" })
  ).toBeVisible()
  const expandedDeck = await cards.evaluate((element) => ({
    display: getComputedStyle(element).display,
    scrollSnapType: getComputedStyle(element).scrollSnapType,
    overflow: element.scrollWidth - element.clientWidth,
  }))
  expect(expandedDeck.display).toBe(browserName === "webkit" ? "block" : "grid")
  expect(expandedDeck.scrollSnapType).not.toContain("x")
  expect(expandedDeck.overflow).toBe(0)

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
  const requestPath = pathname(founderPage.url())
  const ensureFounderEditorExpanded = async () => {
    await expect(editor).toHaveAttribute("data-detent", /^(peek|compose|full)$/)
    if ((await editor.getAttribute("data-detent")) !== "full") {
      await founderPage.getByRole("button", { name: "Expand editor" }).click()
      await expect(editor).toHaveAttribute("data-detent", "full")
    }
  }
  await founderPage.reload()
  await ensureFounderEditorExpanded()
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
  await ensureFounderEditorExpanded()
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

  await operatorPage
    .getByText("Record options & delivery", { exact: true })
    .click()
  await operatorPage.getByRole("button", { name: "Archive request" }).click()
  await founderPage.reload()
  await ensureFounderEditorExpanded()
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
