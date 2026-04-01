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

async function verifyMode(page, mode) {
  await page.getByText("ProctoCare").first().waitFor({ timeout: 20000 });
  await ensureOperational(page);
  const cardEntry = page.getByText("Тест Тестовий", { exact: false }).first();
  await cardEntry.waitFor({ timeout: 30000 });
  await cardEntry.click({ timeout: 10000 });

  const repeatBadgeVisible = await page.getByText(/^Повторний$/).first().isVisible({ timeout: 10000 }).catch(() => false);
  const lastVisitVisible = await page.getByText("22.04.2025", { exact: false }).first().isVisible({ timeout: 10000 }).catch(() => false);

  return { mode, repeatBadgeVisible, lastVisitVisible };
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

    const desktopResult = await verifyMode(desktop, "desktop");
    const mobileResult = await verifyMode(mobile, "mobile");

    const ok = desktopResult.repeatBadgeVisible && desktopResult.lastVisitVisible && mobileResult.repeatBadgeVisible && mobileResult.lastVisitVisible;

    console.log(JSON.stringify({ ok, baseUrl, desktopResult, mobileResult }, null, 2));
  } finally {
    await desktopContext.close();
    await mobileContext.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error("verify-repeat-and-lastvisit failed:", error);
  process.exit(1);
});
