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
  await gotoAppRoute(page, "/dashboard");

  const createWorkspaceButton = page.getByRole("button", {
    name: /create owner workspace/i,
  });
  const submitButton = page.locator('form button[type="submit"]');

  if (await isVisible(createWorkspaceButton, authChoiceTimeout)) {
    await page.getByPlaceholder("Pavan Sai").fill("E2E Admin");
    await page.getByPlaceholder("you@company.com").fill(adminEmail);
    await page.getByPlaceholder("12+ characters").fill(adminPassword);
    await page.getByPlaceholder("Repeat password").fill(adminPassword);
    await page.getByPlaceholder("Acme DevOps").fill("DevPilot E2E");
    await createWorkspaceButton.click();
    if (!(await isVisible(page.getByRole("heading", { name: "Incident Dashboard" }), shortAuthTimeout))) {
      await gotoAppRoute(page, "/dashboard");
      await expect(submitButton).toBeVisible();
      await page.getByPlaceholder("you@company.com").fill(adminEmail);
      await page.getByPlaceholder("12+ characters").fill(adminPassword);
      await submitButton.click();
    }
  } else {
    await expect(submitButton).toBeVisible();
    await page.getByPlaceholder("you@company.com").fill(adminEmail);
    await page.getByPlaceholder("12+ characters").fill(adminPassword);
    await submitButton.click();
  }

  await expect(
    page.getByRole("heading", { name: "Incident Dashboard" }),
  ).toBeVisible({
    timeout: expectTimeout,
  });
}

test("DevPilot incident flow updates the dashboard", async ({ page }) => {
  await authenticateFirstOwner(page);

  await gotoAppRoute(page, "/logs");

  await page.getByLabel("Paste Logs").fill(sampleLog);
  await page.getByRole("button", { name: /submit logs/i }).click();
  await expect(page.getByText(/logs uploaded successfully/i)).toBeVisible();

  await page.getByRole("button", { name: /analyze logs/i }).click();
  await expect(
    page.getByText(/missing required database runtime configuration/i),
  ).toBeVisible();

  await gotoAppRoute(page, "/fix-pr");
  await page.getByLabel("Detected Issue").fill(
    "Production API has CrashLoopBackOff because DATABASE_URL is missing.",
  );
  await page.getByRole("button", { name: /generate files/i }).click();
  await expect(page.getByText("Generated Files")).toBeVisible();
  await expect(page.getByText("Deployment Suggestions")).toBeVisible();

  await gotoAppRoute(page, "/auto-heal");
  await page.getByRole("button", { name: /run manual heal/i }).click();
  await expect(page.getByText(/infrastructure healed successfully/i)).toBeVisible();

  await gotoAppRoute(page, "/dashboard");
  await expect(page.getByText(/live memory/i)).toBeVisible();
  await expect(page.getByText(/DATABASE_URL is not configured/i)).toBeVisible();
  await expect(page.getByText("Auto Heal").first()).toBeVisible();
  await expect(page.getByText(/memory records analyzed/i)).toBeVisible();
});

test("DevPilot app routes render after authentication", async ({ page }) => {
  await gotoAppRoute(page, "/");
  await expect(page.locator("body")).toContainText("DevPilot AI");

  await authenticateFirstOwner(page);

  for (const route of appRoutes) {
    await gotoAppRoute(page, route.href);
    await expect(
      page
        .locator("header")
        .first()
        .getByRole("heading", { name: route.label, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/application error|could not be found/i)).not.toBeVisible();
  }
});
