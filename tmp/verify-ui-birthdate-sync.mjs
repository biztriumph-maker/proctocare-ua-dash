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

  const url = env.VITE_SUPABASE_TEST_URL;
  const key = env.VITE_SUPABASE_TEST_ANON_KEY;

  if (!url || !key) throw new Error("Missing test Supabase config");
  return { url, key };
}

async function sbInsert({ url, key, table, payload }) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Insert ${table} failed: ${res.status} ${await res.text()}`);
}

async function sbSelectOne({ url, key, table, query }) {
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) throw new Error(`Select ${table} failed: ${res.status} ${await res.text()}`);
  const arr = await res.json();
  return arr[0] || null;
}

async function sbDeleteByIds({ url, key, table, ids, column = "id" }) {
  if (!ids.length) return;
  const filter = `(${ids.join(",")})`;
  const res = await fetch(`${url}/rest/v1/${table}?${column}=in.${filter}`, {
    method: "DELETE",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=minimal",
    },
  });
  if (!res.ok) throw new Error(`Delete ${table} failed: ${res.status} ${await res.text()}`);
}

async function ensureOperational(page) {
  const operational = page.getByRole("button", { name: /Оперативка|Операційна/i });
  if (await operational.count()) await operational.first().click().catch(() => {});
}

async function openPatientCard(page, surname) {
  await page.getByText(surname).first().waitFor({ timeout: 30000 });
  await page.getByText(surname).first().click();
  await page.locator("h2", { hasText: surname }).first().waitFor({ timeout: 15000 });
  const cardTab = page.getByRole("button", { name: /^Карта$/ });
  if (await cardTab.count()) await cardTab.first().click().catch(() => {});
}

async function run() {
  const sb = getTestSupabaseConfig();
  const token = Date.now();
  const visitId = `uibirth-${token}`;
  const surname = `UIBD${token}`;
  const desiredBirthDate = "13.02.1991";
  const today = new Date();
  const visitDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const report = {
    ok: false,
    visitId,
    surname,
    desiredBirthDate,
    mobileUpdated: false,
    persistedInSupabase: false,
    desktopBirthValue: null,
    mobileBirthValue: null,
    supabaseBirthValue: null,
  };

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const desktopCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const mobileCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const desktop = await desktopCtx.newPage();
  const mobile = await mobileCtx.newPage();

  try {
    await sbInsert({
      ...sb,
      table: "patients",
      payload: [{
        id: visitId,
        name: `${surname} Іван`,
        patronymic: "Іванович",
        phone: "+380671111111",
        birth_date: "01.01.1980",
        is_test: true,
      }],
    });

    await sbInsert({
      ...sb,
      table: "visits",
      payload: [{
        id: visitId,
        patient_id: visitId,
        visit_date: visitDate,
        visit_time: "15:00",
        procedure: "Колоноскопія",
        status: "planning",
        from_form: true,
        is_test: true,
      }],
    });

    await Promise.all([
      desktop.goto(BASE_URL, { waitUntil: "domcontentloaded" }),
      mobile.goto(BASE_URL, { waitUntil: "domcontentloaded" }),
    ]);

    await Promise.all([
      desktop.getByText("ProctoCare").first().waitFor({ timeout: 15000 }),
      mobile.getByText("ProctoCare").first().waitFor({ timeout: 15000 }),
    ]);

    await Promise.all([ensureOperational(desktop), ensureOperational(mobile)]);

    await Promise.all([
      openPatientCard(desktop, surname),
      openPatientCard(mobile, surname),
    ]);

    const desktopBirthInput = desktop.locator('input[placeholder="ДД.ММ.РРРР"]').first();
    await desktopBirthInput.fill(desiredBirthDate);
    report.desktopBirthValue = await desktopBirthInput.inputValue();

    try {
      await mobile.waitForFunction((value) => {
        const el = document.querySelector('input[placeholder="ДД.ММ.РРРР"]');
        return !!el && el.value === value;
      }, desiredBirthDate, { timeout: 30000 });
      report.mobileUpdated = true;
    } catch {
      const mobileBirthInput = mobile.locator('input[placeholder="ДД.ММ.РРРР"]').first();
      if (await mobileBirthInput.count()) {
        report.mobileBirthValue = await mobileBirthInput.inputValue();
      }
    }

    const dbRow = await sbSelectOne({
      ...sb,
      table: "patients",
      query: `select=id,birth_date&id=eq.${encodeURIComponent(visitId)}`,
    });

    report.supabaseBirthValue = dbRow?.birth_date || null;
    report.persistedInSupabase = !!dbRow && dbRow.birth_date === desiredBirthDate;
    report.ok = report.mobileUpdated && report.persistedInSupabase;

    console.log(JSON.stringify(report, null, 2));
  } finally {
    try {
      await sbDeleteByIds({ ...sb, table: "visits", ids: [visitId], column: "id" });
      await sbDeleteByIds({ ...sb, table: "patients", ids: [visitId], column: "id" });
    } catch {
      // cleanup best-effort
    }
    await desktopCtx.close();
    await mobileCtx.close();
    await browser.close();
  }
}

run().catch((e) => {
  console.error("verify-ui-birthdate-sync failed:", e);
  process.exit(1);
});
