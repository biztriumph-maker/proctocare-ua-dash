import { chromium, devices } from "playwright";

const BASES = ["http://127.0.0.1:8080", "http://localhost:8080", "http://127.0.0.1:5173", "http://localhost:5173"];

async function detectBaseUrl() {
  for (const base of BASES) {
    try {
      const res = await fetch(base);
      if (res.ok) return base;
    } catch {}
  }
  throw new Error("Dev server not reachable");
}

async function ensureOperational(page) {
  const operational = page.getByRole("button", { name: /Оперативка|Операційна/i });
  if (await operational.count()) await operational.first().click().catch(() => {});
}

async function openPatientCard(page) {
  const patient = page.getByText("Тест Тестовий", { exact: false }).first();
  await patient.waitFor({ timeout: 30000 });
  await patient.click({ timeout: 10000 });

  const cardLabel = page.getByRole("button", { name: /Карта/i }).first();
  const filesLabel = page.getByRole("button", { name: /Обстеження/i }).first();
  const profileBlock = page.getByText(/Профіль пацієнта/i).first();

  const opened =
    (await cardLabel.isVisible().catch(() => false))
    || (await filesLabel.isVisible().catch(() => false))
    || (await profileBlock.isVisible().catch(() => false));

  if (!opened) {
    await profileBlock.waitFor({ timeout: 15000 });
  }
}

async function openFilesTabIfNeeded(page) {
  const filesTab = page.getByRole("button", { name: /Обстеження/i }).first();
  if (await filesTab.count()) {
    await filesTab.click({ timeout: 5000 }).catch(() => {});
  }
}

async function getHistorical2025Count(page) {
  return page.getByRole("button", { name: /2025/ }).count();
}

async function expand2025Timeline(page) {
  const yearButtons = page.getByRole("button", { name: /2025/ });
  const count = await yearButtons.count();
  for (let i = 0; i < count; i += 1) {
    await yearButtons.nth(i).click({ timeout: 5000 }).catch(() => {});
  }
}

async function verifyOne(page, mode) {
  await page.getByText("ProctoCare").first().waitFor({ timeout: 20000 });
  await ensureOperational(page);

  await openPatientCard(page);
  await openFilesTabIfNeeded(page);

  const filesHeaderVisible = await page.getByText(/Обстеження та Файли/i).first().isVisible({ timeout: 20000 }).catch(() => false);
  if (!filesHeaderVisible) {
    throw new Error(`[${mode}] files/history block is not visible`);
  }

  const historical2025Count = await getHistorical2025Count(page);
  await expand2025Timeline(page);

  const hasFebProtocol = await page.getByText(/лютий 2025/i).first().isVisible().catch(() => false);
  const hasMarProtocol = await page.getByText(/березень 2025/i).first().isVisible().catch(() => false);
  const hasAprProtocol = await page.getByText(/квітень 2025/i).first().isVisible().catch(() => false);
  const hasProtocol = hasFebProtocol && hasMarProtocol && hasAprProtocol;
  const hasFile = await page.locator("text=test-report.pdf").first().isVisible().catch(() => false);

  return {
    mode,
    historyBlockVisible: filesHeaderVisible,
    historical2025Count,
    dateClickAttempted: true,
    detailsVisible: hasProtocol || hasFile,
  };
}

async function run() {
  const baseUrl = await detectBaseUrl();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mobileContext = await browser.newContext({ ...devices["Pixel 7"] });
  const desktop = await desktopContext.newPage();
  const mobile = await mobileContext.newPage();

  try {
    await Promise.all([
      desktop.goto(baseUrl, { waitUntil: "domcontentloaded" }),
      mobile.goto(baseUrl, { waitUntil: "domcontentloaded" }),
    ]);

    const desktopReport = await verifyOne(desktop, "desktop");
    const mobileReport = await verifyOne(mobile, "mobile");

    const desktopHasAllDates = desktopReport.historical2025Count >= 3;
    const mobileHasAllDates = mobileReport.historical2025Count >= 3;
    const ok = desktopReport.historyBlockVisible
      && mobileReport.historyBlockVisible
      && desktopHasAllDates
      && mobileHasAllDates
      && desktopReport.detailsVisible
      && mobileReport.detailsVisible;

    console.log(JSON.stringify({ ok, baseUrl, desktop: desktopReport, mobile: mobileReport }, null, 2));

    if (!ok) process.exitCode = 1;
  } finally {
    await desktopContext.close();
    await mobileContext.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error("verify-test-patient-ui-history failed:", error);
  process.exit(1);
});
