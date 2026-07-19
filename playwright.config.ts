import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:43117",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "bun run build:e2e && bun run preview:e2e --host 127.0.0.1 --port 43117",
    env: {
      ...process.env,
      FAIRLEND_E2E_AUTH_KEY: "local-playwright-only",
      FAIRLEND_E2E_ORGANIZATION_ID: "org_fairlend",
    },
    url: "http://127.0.0.1:43117/sign-in",
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
