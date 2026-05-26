import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const frontendPort = 3100;
const backendPort = 8100;
const e2eRunId = process.env.DEVPILOT_E2E_RUN_ID ?? `${Date.now()}`;
const e2eIncidentDbPath = path.join(
  os.tmpdir(),
  `devpilot-incident-memory-${e2eRunId}.sqlite3`,
);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // The suite mutates one backend/SQLite instance, so keep browser tests serial.
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `python -m uvicorn main:app --host 127.0.0.1 --port ${backendPort}`,
      cwd: "../backend",
      env: {
        ...process.env,
        AUTONOMOUS_AGENT_ENABLED: "false",
        FRONTEND_ORIGINS: `http://127.0.0.1:${frontendPort}`,
        INCIDENT_DB_PATH: e2eIncidentDbPath,
        SESSION_SECRET: "devpilot-e2e-session-secret-with-at-least-32-chars",
      },
      reuseExistingServer: false,
      timeout: 60_000,
      url: `http://127.0.0.1:${backendPort}/health`,
    },
    {
      command: `npm run dev -- --hostname 127.0.0.1 --port ${frontendPort}`,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${backendPort}`,
      },
      reuseExistingServer: false,
      timeout: 90_000,
      url: `http://127.0.0.1:${frontendPort}`,
    },
  ],
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
