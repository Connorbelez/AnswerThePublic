import { defineConfig, devices } from "@playwright/test"

const reuseExternalServer = process.env.FAIRLEND_E2E_REUSE_SERVER === "true"
const e2ePort = process.env.FAIRLEND_E2E_PORT ?? "43117"
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`

export default defineConfig({
  testDir: "./tests/e2e",
  // The E2E server owns one in-memory Convex workspace shared by both projects.
  // Serialize mutations so browser runs cannot claim or transition each other's data.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: e2eBaseUrl,
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
  webServer: reuseExternalServer
    ? undefined
    : {
        command: `bun run build:e2e && bun run preview:e2e --host 127.0.0.1 --port ${e2ePort}`,
        env: {
          ...process.env,
          FAIRLEND_E2E_AUTH_KEY: "local-playwright-only",
          FAIRLEND_E2E_ORGANIZATION_ID: "org_fairlend",
        },
        url: `${e2eBaseUrl}/sign-in`,
        reuseExistingServer: false,
        timeout: 240_000,
      },
})
