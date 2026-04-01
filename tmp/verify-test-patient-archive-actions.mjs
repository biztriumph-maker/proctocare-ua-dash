import { chromium, devices } from "playwright";
import { readFileSync } from "node:fs";

const PATIENT_ID = "test-history-patient-20260401";
const ACTIVE_VISIT_ID = "test-history-visit-active-20260401";
const BASES = ["http://127.0.0.1:8080", "http://localhost:8080", "http://127.0.0.1:5173", "http://localhost:5173"];

function parseEnvFile(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    return Object.fromEntries(
      raw
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((line) => {
          const idx = line.indexOf("=");
          return [line.slice(0, idx).trim(), line.slice(idx + 1).trim().replace(/^"|"$/g, "")];
        })
    );
  } catch {
    return {};
  }
}

function getSupabaseConfig() {
  const env = { ...parseEnvFile(".env.local"), ...process.env };
  return {
    url: env.VITE_SUPABASE_TEST_URL,
    key: env.VITE_SUPABASE_TEST_ANON_KEY,
  };
}

async function detectBaseUrl() {
  for (const base of BASES) {
    try {
      const res = await fetch(base);
      if (res.ok) return base;
    } catch {}
  }
  throw new Error("Dev server not reachable");
}

async function patchVisit(config, payload) {
  const res = await fetch(`${config.url}/rest/v1/visits?id=eq.${encodeURIComponent(ACTIVE_VISIT_ID)}`, {
    method: "PATCH",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`PATCH failed: ${res.status} ${await res.text()}`);
}

async function getActiveVisit(config) {
  const res = await fetch(`${config.url}/rest/v1/visits?id=eq.${encodeURIComponent(ACTIVE_VISIT_ID)}&select=id,completed,no_show,status,patient_id`, {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
    },
  });
  if (!res.ok) throw new Error(`GET visit failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows[0];
}

async function ensureOperational(page) {
  const operational = page.getByRole("button", { name: /Оперативка|Операційна/i });
  if (await operational.count()) await operational.first().click().catch(() => {});
}

async function runAction(page, buttonText) {
  await page.getByText("ProctoCare").first().waitFor({ timeout: 20000 });
  await ensureOperational(page);
  await page.getByText("Тест Тестовий", { exact: false }).first().waitFor({ timeout: 30000 });

  await page.getByRole("button", { name: new RegExp(buttonText, "i") }).first().click({ timeout: 10000, force: true });
  await page.getByRole("button", { name: /Підтвердити/i }).first().click({ timeout: 10000, force: true });
}

async function run() {
  const config = getSupabaseConfig();
  const baseUrl = await detectBaseUrl();

  await patchVisit(config, { patient_id: PATIENT_ID, completed: false, no_show: false, status: "progress" });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mobileContext = await browser.newContext({ ...devices["Pixel 7"] });
  const desktop = await desktopContext.newPage();
  const mobile = await mobileContext.newPage();

  try {
    await desktop.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await runAction(desktop, "Прийом завершено");

    const afterComplete = await getActiveVisit(config);

    await patchVisit(config, { completed: false, no_show: false, status: "progress" });

    await mobile.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await runAction(mobile, "Не з'явився");

    const afterNoShow = await getActiveVisit(config);

    const ok = afterComplete?.completed === true && afterNoShow?.no_show === true;

    console.log(JSON.stringify({
      ok,
      baseUrl,
      afterComplete,
      afterNoShow,
    }, null, 2));
  } finally {
    await desktopContext.close();
    await mobileContext.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error("verify-test-patient-archive-actions failed:", error);
  process.exit(1);
});
