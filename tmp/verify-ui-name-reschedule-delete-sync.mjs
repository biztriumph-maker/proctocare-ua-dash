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
  if (!res.ok) throw new Error(`Insert ${table} failed: ${res.status} ${await res.text()}`);
}

async function sbSelect(url, key, table, query) {
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Select ${table} failed: ${res.status} ${await res.text()}`);
  const arr = await res.json();
  return arr[0] || null;
}

async function sbDelete(url, key, table, filter) {
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
  });
  if (!res.ok) throw new Error(`Delete ${table} failed: ${res.status} ${await res.text()}`);
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

async function closePatientCard(page) {
  const closeBtn = page.locator("button:has(svg.lucide-x)").first();
  if (await closeBtn.count()) await closeBtn.click({ force: true }).catch(() => {});
}

async function run() {
  const { url, key } = getTestSupabaseConfig();
  const token = Date.now();
  const visitId = `remaining-${token}`;
  const surname = `REM${token}`;
  const newSurname = `REMNEW${token}`;
  const initialTime = "10:00";

  const now = new Date();
  const visitDate = isoDate(now);

  const report = {
    ok: false,
    nameEdit: { ok: false },
    reschedule: { ok: false },
    deleteRecord: { ok: false },
  };

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const dCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const mCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const d = await dCtx.newPage();
  const m = await mCtx.newPage();

  try {
    await sbInsert(url, key, "patients", [{
      id: visitId,
      name: `${surname} Іван`,
      patronymic: "Іванович",
      phone: "+380671111222",
      birth_date: "24.07.1965",
      is_test: true,
    }]);

    await sbInsert(url, key, "visits", [{
      id: visitId,
      patient_id: visitId,
      visit_date: visitDate,
      visit_time: initialTime,
      procedure: "Колоноскопія",
      status: "planning",
      from_form: true,
      is_test: true,
    }]);

    await Promise.all([
      d.goto(BASE_URL, { waitUntil: "domcontentloaded" }),
      m.goto(BASE_URL, { waitUntil: "domcontentloaded" }),
    ]);

    await Promise.all([
      d.getByText("ProctoCare").first().waitFor({ timeout: 15000 }),
      m.getByText("ProctoCare").first().waitFor({ timeout: 15000 }),
    ]);

    await Promise.all([ensureOperational(d), ensureOperational(m)]);

    // 1) Name edit
    await Promise.all([openPatientCard(d, surname), openPatientCard(m, surname)]);

    await d.locator("h2").filter({ hasText: surname }).first().click({ force: true });
    const nameInput = d.locator("input[type='text']").first();
    await nameInput.waitFor({ timeout: 10000 });
    await nameInput.fill(`${newSurname} Іван Іванович`);
    await nameInput.press("Enter");

    await m.waitForFunction((expected) => {
      return (document.body.innerText || "").includes(expected);
    }, newSurname, { timeout: 30000 });

    const dbPatient = await sbSelect(url, key, "patients", `select=name,patronymic&id=eq.${encodeURIComponent(visitId)}`);
    report.nameEdit = {
      ok: !!dbPatient && String(dbPatient.name || "").includes(newSurname),
      dbName: dbPatient?.name || null,
      dbPatronymic: dbPatient?.patronymic || null,
    };

    // 2) Reschedule (time)
    await d.getByRole("button", { name: /Перенести прийом/i }).first().click({ force: true });
    const pickerTitle = d.getByRole("heading", { name: "Перенести прийом" });
    await pickerTitle.waitFor({ timeout: 10000 });

    const picker = d.locator("div.absolute.inset-0.z-\\[65\\]").last();
    await picker.getByRole("button", { name: /^День$/ }).click().catch(() => {});

    let selectedHour = null;
    for (const hour of ["17:00", "16:00", "15:00", "14:00", "13:00", "12:00", "11:00", "09:00", "08:00"]) {
      const freeBtn = picker.locator("button", { hasText: hour }).filter({ hasText: "— вільно —" }).first();
      if (await freeBtn.count()) {
        await freeBtn.click({ force: true });
        selectedHour = hour;
        break;
      }
    }

    if (!selectedHour) throw new Error("No free slot found in reschedule picker");

    await picker.locator("p", { hasText: `· ${selectedHour}` }).first().waitFor({ timeout: 10000 });

    const saveBtn = picker.getByRole("button", { name: "Зберегти" }).first();
    await saveBtn.waitFor({ timeout: 10000 });
    await saveBtn.click();
    await pickerTitle.waitFor({ state: "detached", timeout: 15000 });

    await m.waitForFunction((timeExpected) => {
      const text = document.body.innerText || "";
      return text.includes(`Час: ${timeExpected}`) || text.includes(timeExpected);
    }, selectedHour, { timeout: 30000 });

    const dbVisitAfterReschedule = await sbSelect(url, key, "visits", `select=visit_time,visit_date&id=eq.${encodeURIComponent(visitId)}`);
    report.reschedule = {
      ok: !!dbVisitAfterReschedule && dbVisitAfterReschedule.visit_time === selectedHour,
      expectedTime: selectedHour,
      dbVisitTime: dbVisitAfterReschedule?.visit_time || null,
      dbVisitDate: dbVisitAfterReschedule?.visit_date || null,
    };

    // 3) Delete record
    await closePatientCard(m);
    d.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await d.getByRole("button", { name: /Видалити запис/i }).first().click({ force: true });

    await d.waitForFunction((s) => !(document.body.innerText || "").includes(s), newSurname, { timeout: 30000 });
    await m.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await ensureOperational(m);
    await m.waitForFunction((s) => !(document.body.innerText || "").includes(s), newSurname, { timeout: 30000 });

    const dbVisitAfterDelete = await sbSelect(url, key, "visits", `select=id&id=eq.${encodeURIComponent(visitId)}`);
    report.deleteRecord = {
      ok: !dbVisitAfterDelete,
      dbVisitExists: !!dbVisitAfterDelete,
    };

    report.ok = report.nameEdit.ok && report.reschedule.ok && report.deleteRecord.ok;
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
  console.error("verify-ui-name-reschedule-delete-sync failed:", e);
  process.exit(1);
});
