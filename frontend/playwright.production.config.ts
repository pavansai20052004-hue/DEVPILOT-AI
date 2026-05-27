import { defineConfig, devices } from "@playwright/test";

const productionBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://devpilot-ai-two.vercel.app";

process.env.PLAYWRIGHT_LIVE ??= "true";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 420_000,
  expect: {
    timeout: 60_000,
  },
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: productionBaseUrl,
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          timeout: 60_000,
        },
      },
    },
  ],
});
