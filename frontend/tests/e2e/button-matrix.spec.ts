import { expect, type Locator, type Page, test } from "@playwright/test";

const liveRun = process.env.PLAYWRIGHT_LIVE === "true";
const adminEmail = liveRun
  ? process.env.PLAYWRIGHT_ADMIN_EMAIL
  : (process.env.PLAYWRIGHT_ADMIN_EMAIL ?? "admin@example.com");
const adminPassword = liveRun
  ? process.env.PLAYWRIGHT_ADMIN_PASSWORD
  : (process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? "CorrectHorseBatteryStaple!");

if (!adminEmail || !adminPassword) {
  throw new Error(
    "Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for live E2E runs.",
  );
}
const expectTimeout = liveRun ? 60_000 : 15_000;
const authChoiceTimeout = liveRun ? 30_000 : 10_000;
const shortAuthTimeout = liveRun ? 30_000 : 5_000;
const responseTimeout = liveRun ? 60_000 : 20_000;
const sampleLog = [
  "2026-05-25T08:12:10Z production api ERROR DATABASE_URL is not configured",
  "2026-05-25T08:12:12Z production api FATAL database connection string missing",
  "2026-05-25T08:12:14Z pod/devpilot-api Warning CrashLoopBackOff back-off restarting failed container",
].join("\n");

const appRoutes = [
  { href: "/dashboard", label: "Incident Dashboard" },
  { href: "/logs", label: "Log Intake" },
  { href: "/kubernetes", label: "Kubernetes" },
  { href: "/auto-heal", label: "Auto Heal" },
  { href: "/agents", label: "Autonomous Agents" },
  { href: "/voice", label: "Voice Assistant" },
  { href: "/predictive-failures", label: "Failure Prediction" },
  { href: "/model-training", label: "Model Training" },
  { href: "/terraform", label: "Terraform" },
  { href: "/fix-pr", label: "Fix Pull Request" },
  { href: "/infra-command", label: "Plain English Infra" },
  { href: "/chaos", label: "Chaos Engineering" },
  { href: "/account", label: "Account & Billing" },
  { href: "/enterprise", label: "Command Center" },
  { href: "/digital-twin", label: "Digital Twin" },
  { href: "/security", label: "Security" },
  { href: "/cost", label: "Cloud Cost" },
  { href: "/plugins", label: "Plugins" },
  { href: "/demo", label: "Demo Mode" },
];

test.describe.configure({ timeout: liveRun ? 420_000 : 120_000 });

async function isVisible(locator: Locator, timeout = 2_000) {
  try {
    await expect(locator).toBeVisible({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function gotoAppRoute(page: Page, href: string) {
  await page.goto(href, { waitUntil: "domcontentloaded" });
}

async function authenticateFirstOwner(page: Page) {
  const uniqueEmail = adminEmail;
  const uniqueTeamName = `DevPilot E2E ${Date.now()}`;
  await gotoAppRoute(page, "/dashboard");

  const createWorkspaceButton = page.getByRole("button", {
    name: /create owner workspace/i,
  });
  const submitButton = page.locator('form button[type="submit"]');

  if (await isVisible(createWorkspaceButton, authChoiceTimeout)) {
    await page.getByPlaceholder("Pavan Sai").fill("E2E Admin");
    await page.getByPlaceholder("you@company.com").fill(uniqueEmail);
    await page.getByPlaceholder("12+ characters").fill(adminPassword);
    await page.getByPlaceholder("Repeat password").fill(adminPassword);
    await page.getByPlaceholder("Acme DevOps").fill(uniqueTeamName);
    await createWorkspaceButton.click();
    if (!(await isVisible(page.getByRole("heading", { name: "Incident Dashboard" }), shortAuthTimeout))) {
      await gotoAppRoute(page, "/dashboard");
      await expect(submitButton).toBeVisible();
      await page.getByPlaceholder("you@company.com").fill(uniqueEmail);
      await page.getByPlaceholder("12+ characters").fill(adminPassword);
      await submitButton.click();
    }
  } else {
    await expect(submitButton).toBeVisible();
    await page.getByPlaceholder("you@company.com").fill(uniqueEmail);
    await page.getByPlaceholder("12+ characters").fill(adminPassword);
    await submitButton.click();
  }

  await expect(
    page.getByRole("heading", { name: "Incident Dashboard" }),
  ).toBeVisible({ timeout: expectTimeout });
}

async function expectRouteHeading(page: Page, label: string) {
  await expect(
    page
      .locator("header")
      .first()
      .getByRole("heading", { name: label, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/application error|could not be found/i)).not.toBeVisible();
}

async function clickEnabled(locator: Locator) {
  await expect(locator).toBeEnabled({ timeout: expectTimeout });
  await locator.click();
}

async function runDemo(page: Page) {
  await gotoAppRoute(page, "/demo");
  await expectRouteHeading(page, "Demo Mode");
  const demoButton = page
    .locator("#demo-mode")
    .getByRole("button", { name: /run demo|demo loaded/i });
  if (await isVisible(page.locator("#demo-mode").getByRole("button", { name: /run demo/i }))) {
    await demoButton.click();
  }
  await expect(
    page.locator("#demo-mode").getByRole("button", { name: /demo loaded/i }),
  ).toBeVisible({ timeout: expectTimeout });
}

async function mockPullRequestCreation(page: Page) {
  await page.route("**/github/create-pull-request", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        repository: "demo/devpilot-ai",
        pull_request_number: 42,
        pull_request_url: "https://github.com/demo/devpilot-ai/pull/42",
        branch_name: "devpilot/fix-crashloop",
        base_branch: "main",
        files: [
          {
            path: "Dockerfile",
            status: "created",
            sha: "abc123",
            html_url: "https://github.com/demo/devpilot-ai/blob/devpilot/fix-crashloop/Dockerfile",
          },
        ],
      }),
    });
  });
}

async function installVoiceMocks(page: Page) {
  await page.addInitScript(() => {
    class MockSpeechRecognition {
      lang = "en-US";
      interimResults = true;
      continuous = false;
      onresult?: (event: { results: { transcript: string }[][] }) => void;
      onerror?: (event: { error: string }) => void;
      onend?: () => void;

      start() {
        window.setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: "Why did deployment fail?" }]] });
        }, 0);
      }

      stop() {
        this.onend?.();
      }
    }

    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: class {
        onend?: (event: Event) => void;
        onerror?: (event: Event) => void;
        pitch = 1;
        rate = 1;
        text: string;
        voice = null;

        constructor(text: string) {
          this.text = text;
        }
      },
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        addEventListener() {},
        cancel() {},
        getVoices() {
          return [];
        },
        removeEventListener() {},
        speak(utterance: { onend?: (event: Event) => void }) {
          window.setTimeout(() => utterance.onend?.(new Event("end")), 25);
        },
      },
    });
  });
}

test("button matrix renders every authenticated route", async ({ page }) => {
  await authenticateFirstOwner(page);

  for (const route of appRoutes) {
    await gotoAppRoute(page, route.href);
    await expectRouteHeading(page, route.label);
  }
});

test("operate buttons stay within safe local workflows", async ({ page }) => {
  await authenticateFirstOwner(page);
  await runDemo(page);

  await gotoAppRoute(page, "/dashboard");
  await expectRouteHeading(page, "Incident Dashboard");
  const downloadButton = page.getByRole("button", { name: /download pdf/i });
  await expect(downloadButton).toBeEnabled({ timeout: expectTimeout });
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/devpilot-incident-report.*\.pdf/i);

  await gotoAppRoute(page, "/logs");
  await expectRouteHeading(page, "Log Intake");
  await page.getByLabel("Paste Logs").fill(sampleLog);
  await clickEnabled(page.getByRole("button", { name: /submit logs/i }));
  await expect(page.getByText(/logs uploaded successfully/i)).toBeVisible();
  await clickEnabled(page.getByRole("button", { name: /analyze logs/i }));
  await expect(
    page.getByText(/missing required database runtime configuration/i),
  ).toBeVisible();

  await gotoAppRoute(page, "/kubernetes");
  await expectRouteHeading(page, "Kubernetes");
  await clickEnabled(page.getByRole("button", { name: /load demo cluster/i }));
  await expect(page.getByText(/demo cluster loaded/i)).toBeVisible();
  await clickEnabled(page.getByRole("button", { name: /restart pod/i }).first());
  await expect(page.getByText(/demo restart completed/i)).toBeVisible();
  await clickEnabled(page.getByRole("button", { name: /^rollback$/i }).first());
  await expect(page.getByText(/demo rollback completed/i)).toBeVisible();

  await gotoAppRoute(page, "/auto-heal");
  await expectRouteHeading(page, "Auto Heal");
  await clickEnabled(page.getByRole("button", { name: /run manual heal/i }));
  await expect(page.getByText(/infrastructure healed successfully/i)).toBeVisible();
});

test("ai and remediation buttons use fallback or mocked side effects", async ({ page }) => {
  await mockPullRequestCreation(page);
  await authenticateFirstOwner(page);

  await gotoAppRoute(page, "/agents");
  await expectRouteHeading(page, "Autonomous Agents");
  await clickEnabled(page.getByRole("button", { name: /run collaboration/i }));
  const rejectButtonLocator = page.getByRole("button", { name: /^reject$/i });
  await expect(rejectButtonLocator.first()).toBeVisible({
    timeout: expectTimeout,
  });
  const rejectReviewResponse = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      /\/agent\/approvals\/[^/]+\/review$/.test(response.url()) &&
      response.status() === 200
    );
  }, { timeout: responseTimeout });
  await clickEnabled(rejectButtonLocator.first());
  await rejectReviewResponse;

  let approveButtonLocator = page.getByRole("button", { name: /^approve$/i });
  if ((await approveButtonLocator.count()) === 0) {
    await clickEnabled(page.getByRole("button", { name: /run collaboration/i }));
    approveButtonLocator = page.getByRole("button", { name: /^approve$/i });
    await expect(approveButtonLocator.first()).toBeVisible({
      timeout: expectTimeout,
    });
  }

  const approveReviewResponse = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      /\/agent\/approvals\/[^/]+\/review$/.test(response.url()) &&
      response.status() === 200
    );
  }, { timeout: responseTimeout });
  await clickEnabled(approveButtonLocator.first());
  await approveReviewResponse;

  await gotoAppRoute(page, "/predictive-failures");
  await expectRouteHeading(page, "Failure Prediction");
  await clickEnabled(page.getByRole("button", { name: /run prediction/i }));
  await expect(page.getByText(/risk/i).first()).toBeVisible();

  await gotoAppRoute(page, "/model-training");
  await expectRouteHeading(page, "Model Training");
  await clickEnabled(page.getByRole("button", { name: /train model/i }));
  await expect(page.getByText(/custom score/i)).toBeVisible({ timeout: expectTimeout });

  await gotoAppRoute(page, "/terraform");
  await expectRouteHeading(page, "Terraform");
  await clickEnabled(page.getByRole("button", { name: /detect drift/i }));
  await expect(page.getByText(/drift findings/i)).toBeVisible();
  await clickEnabled(page.getByRole("button", { name: /auto-patch terraform/i }));
  await expect(page.getByText(/terraform infra auto-patched/i)).toBeVisible();

  await gotoAppRoute(page, "/fix-pr");
  await expectRouteHeading(page, "Fix Pull Request");
  await page.getByLabel("Repository").fill("demo/devpilot-ai");
  await clickEnabled(page.getByRole("button", { name: /generate files/i }));
  await expect(page.getByText("Generated Files")).toBeVisible({ timeout: expectTimeout });
  await clickEnabled(page.getByRole("button", { name: /create pr/i }));
  await expect(page.getByText(/pull request opened in demo\/devpilot-ai\./i)).toBeVisible({
    timeout: expectTimeout,
  });

  await gotoAppRoute(page, "/infra-command");
  await expectRouteHeading(page, "Plain English Infra");
  await page.getByLabel("Command").fill("Restart pods for deployment devpilot-api");
  await clickEnabled(page.getByRole("button", { name: /preview plan/i }));
  await expect(page.getByText(/translated into an infrastructure plan/i)).toBeVisible();

  await gotoAppRoute(page, "/chaos");
  await expectRouteHeading(page, "Chaos Engineering");
  await clickEnabled(page.getByRole("button", { name: /inject failure/i }));
  await expect(page.getByText(/auto-heal executed/i)).toBeVisible({ timeout: expectTimeout });
});

test("enterprise, demo, and voice controls are clickable", async ({ page }) => {
  await installVoiceMocks(page);
  await authenticateFirstOwner(page);

  await gotoAppRoute(page, "/account");
  await expectRouteHeading(page, "Account & Billing");
  const matrixTeamName = `Matrix Team ${Date.now()}`;
  await page.getByPlaceholder("Team name").fill(matrixTeamName);
  await clickEnabled(page.getByRole("button", { name: /^create team$/i }));
  await expect(
    page.getByText("Active Team").locator("xpath=ancestor::div[2]").getByText(matrixTeamName),
  ).toBeVisible({ timeout: expectTimeout });
  await clickEnabled(page.getByRole("button", { name: /^select plan$/i }).first());
  await expect(page.getByText(/^Pro$/).first()).toBeVisible();
  await page.getByPlaceholder("Email").fill(`matrix-${Date.now()}@example.com`);
  await clickEnabled(page.getByRole("button", { name: /^invite$/i }));
  await expect(page.getByText(/@example\.com/i).first()).toBeVisible();

  await gotoAppRoute(page, "/security");
  await expectRouteHeading(page, "Security");
  await clickEnabled(page.getByRole("button", { name: /refresh report/i }));
  await expect(page.getByText(/findings/i).first()).toBeVisible();

  await gotoAppRoute(page, "/cost");
  await expectRouteHeading(page, "Cloud Cost");
  await clickEnabled(page.getByRole("button", { name: /refresh savings/i }));
  await expect(page.getByText(/recommendations/i)).toBeVisible();

  await gotoAppRoute(page, "/plugins");
  await expectRouteHeading(page, "Plugins");
  const installButtons = page.getByRole("button", { name: /^install$/i });
  const updateButtons = page.getByRole("button", { name: /^update$/i });
  const removeButtons = page.getByRole("button", { name: /^remove$/i });
  await expect(
    page.getByRole("button", { name: /^(install|update)$/i }).first(),
  ).toBeVisible({ timeout: expectTimeout });

  if ((await installButtons.count()) > 0) {
    await clickEnabled(installButtons.first());
    await expect(page.getByText(/integration installed\./i).first()).toBeVisible({
      timeout: expectTimeout,
    });
    await expect(updateButtons.first()).toBeVisible({ timeout: expectTimeout });
    await clickEnabled(removeButtons.first());
    await expect(page.getByText(/integration uninstalled\./i).first()).toBeVisible({
      timeout: expectTimeout,
    });
    await expect(installButtons.first()).toBeVisible({ timeout: expectTimeout });
  } else {
    await clickEnabled(updateButtons.first());
    await expect(page.getByText(/integration installed\./i).first()).toBeVisible({
      timeout: expectTimeout,
    });
    await clickEnabled(removeButtons.first());
    await expect(page.getByText(/integration uninstalled\./i).first()).toBeVisible({
      timeout: expectTimeout,
    });
    await expect(installButtons.first()).toBeVisible({ timeout: expectTimeout });
    await clickEnabled(installButtons.first());
    await expect(page.getByText(/integration installed\./i).first()).toBeVisible({
      timeout: expectTimeout,
    });
    await expect(updateButtons.first()).toBeVisible({ timeout: expectTimeout });
  }

  await gotoAppRoute(page, "/demo");
  await expectRouteHeading(page, "Demo Mode");
  await clickEnabled(page.locator("#demo-mode").getByRole("button", { name: /run demo/i }));
  await expect(
    page.locator("#demo-mode").getByRole("button", { name: /demo loaded/i }),
  ).toBeVisible({ timeout: expectTimeout });
  await clickEnabled(page.locator("#judge-mode").getByRole("button", { name: /judge mode/i }));
  await expect(page.getByText(/elapsed/i)).toBeVisible({ timeout: expectTimeout });

  await gotoAppRoute(page, "/voice");
  await expectRouteHeading(page, "Voice Assistant");
  await clickEnabled(page.getByRole("button", { name: /^mic$/i }));
  await expect(page.getByRole("button", { name: /^stop$/i })).toBeVisible();
  await page.getByRole("button", { name: /^stop$/i }).click();
  await page.getByLabel("Question").fill("Why did deployment fail?");
  await clickEnabled(page.getByRole("button", { name: /ask devpilot/i }));
  await expect(page.getByText(/deployment/i).first()).toBeVisible({ timeout: expectTimeout });
  await clickEnabled(page.getByRole("button", { name: /replay|stop voice/i }));
});
