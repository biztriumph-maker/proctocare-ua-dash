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

async function openPatient(page, surname) {
  const op = page.getByRole("button", { name: /Оперативка|Операційна/i });
  if (await op.count()) await op.first().click().catch(() => {});
  await page.getByText(surname).first().click();
  await page.locator("h2", { hasText: surname }).first().waitFor({ timeout: 10000 });
}

async function run() {
  const { url, key } = getTestSupabaseConfig();
  const t = Date.now();
  const id = `mod-${t}`;
  const surname = `MOD${t}`;
  const oldDate = "24.07.1965";
  const newDate = "31.12.1971";
  const today = new Date();
  const visitDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const dCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const mCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const d = await dCtx.newPage();
  const m = await mCtx.newPage();

  const out = { ok: false, mobileSynced: false, saved: false, oldDate, newDate };

  try {
    await sbInsert(url, key, "patients", [{ id, name: `${surname} Іван`, patronymic: "Іванович", birth_date: oldDate, phone: "+380671234567", is_test: true }]);
    await sbInsert(url, key, "visits", [{ id, patient_id: id, visit_date: visitDate, visit_time: "12:00", procedure: "Колоноскопія", status: "planning", from_form: true, is_test: true }]);

    await Promise.all([d.goto(BASE_URL), m.goto(BASE_URL)]);
    await Promise.all([d.getByText("ProctoCare").first().waitFor(), m.getByText("ProctoCare").first().waitFor()]);
    await Promise.all([openPatient(d, surname), openPatient(m, surname)]);

    const birthBlock = d.locator("div").filter({ hasText: "Дата народження" }).first();
    await birthBlock.locator("button").first().click({ force: true });

    const overlayTextarea = d.locator("textarea").last();
    await overlayTextarea.waitFor({ timeout: 10000 });
    await overlayTextarea.fill(newDate);
    await d.getByRole("button", { name: "Зберегти" }).last().click();

    await m.waitForFunction((val) => {
      const el = document.querySelector('input[placeholder="ДД.ММ.РРРР"]');
      return !!el && el.value === val;
    }, newDate, { timeout: 30000 });
    out.mobileSynced = true;

    const row = await sbSelect(url, key, "patients", `select=birth_date&id=eq.${encodeURIComponent(id)}`);
    out.saved = row?.birth_date === newDate;
    out.ok = out.mobileSynced && out.saved;
    console.log(JSON.stringify(out, null, 2));
  } finally {
    try { await sbDelete(url, key, "visits", `id=eq.${encodeURIComponent(id)}`); } catch {}
    try { await sbDelete(url, key, "patients", `id=eq.${encodeURIComponent(id)}`); } catch {}
    await dCtx.close();
    await mCtx.close();
    await browser.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
