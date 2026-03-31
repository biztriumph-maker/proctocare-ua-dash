import { chromium, devices } from "playwright";
import { readFileSync } from "node:fs";

const BASE_URL = "http://localhost:8080";

function parseEnvFile(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^"|"$/g, "");
      out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

function getTestSupabaseConfig() {
  const envLocal = { ...parseEnvFile(".env.local"), ...parseEnvFile("proctocare-ua-dash/.env.local") };
  const envBase = { ...parseEnvFile(".env"), ...parseEnvFile("proctocare-ua-dash/.env") };
  const env = { ...envBase, ...envLocal, ...process.env };
  return { url: env.VITE_SUPABASE_TEST_URL, key: env.VITE_SUPABASE_TEST_ANON_KEY };
}

async function sbInsert(url, key, table, payload) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function sbSelect(url, key, table, query) {
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(await res.text());
  const arr = await res.json();
  return arr[0] || null;
}

async function sbDelete(url, key, table, filter) {
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(await res.text());
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function ensureOperational(page) {
  const btn = page.getByRole("button", { name: /Оперативка|Операційна/i });
  if (await btn.count()) await btn.first().click().catch(() => {});
}

async function openPatientCard(page, surname) {
  await page.getByText(surname).first().waitFor({ timeout: 30000 });
  await page.getByText(surname).first().click();
  await page.locator("h2", { hasText: surname }).first().waitFor({ timeout: 15000 });
}

async function run() {
  const { url, key } = getTestSupabaseConfig();
  const token = Date.now();
  const visitId = `file-${token}`;
  const surname = `FILE${token}`;

  const now = new Date();
  const visitDate = isoDate(now);

  const report = {
    ok: false,
    filesOnDesktop: false,
    filesOnMobile: false,
    filesInDatabase: 0,
  };

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const dCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const mCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const d = await dCtx.newPage();
  const m = await mCtx.newPage();

  try {
    // Create test patient
    await sbInsert(url, key, "patients", [{
      id: visitId,
      name: `${surname} Іван`,
      patronymic: "Іванович",
      phone: "+380671111000",
      birth_date: "15.05.1972",
      is_test: true,
    }]);

    // Create test visit with files metadata
    const testFiles = [
      { id: "f1", name: "12 ключей к успеху.jpg", type: "doctor", date: "31.03.2026", storageKey: "test-1", mimeType: "image/jpeg" },
      { id: "f2", name: "Анонс вебинара.pdf", type: "doctor", date: "31.03.2026", storageKey: "test-2", mimeType: "application/pdf" },
    ];

    await sbInsert(url, key, "visits", [{
      id: visitId,
      patient_id: visitId,
      visit_date: visitDate,
      visit_time: "10:00",
      procedure: "Колоноскопія",
      status: "planning",
      from_form: true,
      is_test: true,
      files: testFiles,
    }]);

    // Load on both devices
    await Promise.all([
      d.goto(BASE_URL, { waitUntil: "domcontentloaded" }),
      m.goto(BASE_URL, { waitUntil: "domcontentloaded" }),
    ]);

    await Promise.all([
      d.getByText("ProctoCare").first().waitFor({ timeout: 15000 }),
      m.getByText("ProctoCare").first().waitFor({ timeout: 15000 }),
    ]);

    await Promise.all([ensureOperational(d), ensureOperational(m)]);

    // Open patient on both devices
    await Promise.all([
      openPatientCard(d, surname),
      openPatientCard(m, surname),
    ]);

    // Click to files tab
    const fileTabD = d.getByRole("button", { name: /files|файли|обстеження/i });
    if (await fileTabD.count()) await fileTabD.first().click().catch(() => {});

    const fileTabM = m.getByRole("button", { name: /files|файли|обстеження/i });
    if (await fileTabM.count()) await fileTabM.first().click().catch(() => {});

    // Wait for files to appear
    try {
      await d.waitForFunction(() => {
        const text = document.body.innerText || "";
        return text.includes("12 ключей") || text.includes("Анонс вебинара");
      }, { timeout: 15000 });
      report.filesOnDesktop = true;
    } catch {
      report.filesOnDesktop = false;
    }

    try {
      await m.waitForFunction(() => {
        const text = document.body.innerText || "";
        return text.includes("12 ключей") || text.includes("Анонс вебинара");
      }, { timeout: 15000 });
      report.filesOnMobile = true;
    } catch {
      report.filesOnMobile = false;
    }

    // Check database
    const dbVisit = await sbSelect(url, key, "visits", `select=files&id=eq.${encodeURIComponent(visitId)}`);
    report.filesInDatabase = dbVisit?.files?.length || 0;

    report.ok = report.filesOnDesktop && report.filesOnMobile && report.filesInDatabase > 0;

    console.log(JSON.stringify(report, null, 2));
  } finally {
    try { await sbDelete(url, key, "visits", `id=eq.${encodeURIComponent(visitId)}`); } catch {}
    try { await sbDelete(url, key, "patients", `id=eq.${encodeURIComponent(visitId)}`); } catch {}
    await dCtx.close();
    await mCtx.close();
    await browser.close();
  }
}

run().catch((e) => {
  console.error("verify-file-sync failed:", e);
  process.exit(1);
});
