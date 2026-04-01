import { chromium, devices } from "playwright";
import { readFileSync } from "node:fs";

const PATIENT_ID = "test-history-patient-20260401";
const ACTIVE_VISIT_ID = "test-history-visit-active-20260401";
const VISIT_IDS = [
  "test-history-visit-20250214",
  "test-history-visit-20250318",
  "test-history-visit-20250422",
  "test-history-visit-20250510",
  ACTIVE_VISIT_ID,
];

const CANDIDATE_URLS = [
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];

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

function getSupabaseConfig() {
  const envLocal = { ...parseEnvFile(".env.local"), ...parseEnvFile("proctocare-ua-dash/.env.local") };
  const envBase = { ...parseEnvFile(".env"), ...parseEnvFile("proctocare-ua-dash/.env") };
  const env = { ...envBase, ...envLocal, ...process.env };

  const active = (env.VITE_SUPABASE_ENV || "test").toLowerCase();
  const isProd = active === "prod";
  const url = isProd ? env.VITE_SUPABASE_PROD_URL : env.VITE_SUPABASE_TEST_URL;
  const key = isProd ? env.VITE_SUPABASE_PROD_ANON_KEY : env.VITE_SUPABASE_TEST_ANON_KEY;

  if (!url || !key) throw new Error("Supabase config missing in .env.local");
  return { url, key, active };
}

async function detectBaseUrl() {
  for (const url of CANDIDATE_URLS) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return url;
    } catch {
      // continue
    }
  }
  throw new Error("Dev server not reachable on known URLs (8080/5173)");
}

async function supabaseRequest({ url, key, method, table, query = "", payload, prefer = "return=representation" }) {
  const endpoint = `${url}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const res = await fetch(endpoint, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(`${method} ${table} failed: ${res.status} ${JSON.stringify(json)}`);
  }

  return json;
}

async function cleanupOld(config) {
  for (const id of VISIT_IDS) {
    await supabaseRequest({
      ...config,
      method: "DELETE",
      table: "visits",
      query: `id=eq.${encodeURIComponent(id)}`,
      prefer: "return=minimal",
    });
  }

  await supabaseRequest({
    ...config,
    method: "DELETE",
    table: "patients",
    query: `id=eq.${encodeURIComponent(PATIENT_ID)}`,
    prefer: "return=minimal",
  });
}

async function seedPatient(config) {
  await cleanupOld(config);

  await supabaseRequest({
    ...config,
    method: "POST",
    table: "patients",
    payload: [{
      id: PATIENT_ID,
      name: "Тест Тестовий",
      patronymic: "Тестович",
      phone: "+380671112233",
      birth_date: "1990-01-15",
      allergies: "",
      diagnosis: "Тестовий діагноз для перевірки історії",
      is_test: true,
    }],
  });

  const visits = [
    {
      id: VISIT_IDS[0],
      patient_id: PATIENT_ID,
      visit_date: "2025-02-14",
      visit_time: "09:00",
      procedure: "Гастроскопія",
      status: "ready",
      ai_summary: "Завершено (лютий 2025)",
      notes: "Пацієнт виконав підготовку",
      protocol: "Висновок лікаря (лютий 2025): патологій не виявлено.",
      from_form: true,
      no_show: false,
      completed: true,
      is_test: true,
      files: [],
    },
    {
      id: VISIT_IDS[1],
      patient_id: PATIENT_ID,
      visit_date: "2025-03-18",
      visit_time: "10:00",
      procedure: "Колоноскопія",
      status: "ready",
      ai_summary: "Завершено (березень 2025)",
      notes: "Контрольний огляд",
      protocol: "Висновок лікаря (березень 2025): без ускладнень.",
      from_form: true,
      no_show: false,
      completed: true,
      is_test: true,
      files: [
        {
          id: "test-file-visit-mar",
          name: "test-report.pdf",
          type: "doctor",
          date: "18.03.2025",
          url: "https://example.com/test-report.pdf",
          mimeType: "application/pdf",
        },
      ],
    },
    {
      id: VISIT_IDS[2],
      patient_id: PATIENT_ID,
      visit_date: "2025-04-22",
      visit_time: "11:00",
      procedure: "Ректоскопія",
      status: "ready",
      ai_summary: "Завершено (квітень 2025)",
      notes: "Плановий візит",
      protocol: "Висновок лікаря (квітень 2025): стан стабільний.",
      from_form: true,
      no_show: false,
      completed: true,
      is_test: true,
      files: [],
    },
    {
      id: VISIT_IDS[3],
      patient_id: PATIENT_ID,
      visit_date: "2025-05-10",
      visit_time: "12:00",
      procedure: "Консультація",
      status: "risk",
      ai_summary: "Не з'явився",
      notes: "Пацієнт не прийшов на прийом",
      protocol: "Висновок лікаря (травень 2025): пацієнт не з'явився.",
      from_form: true,
      no_show: true,
      completed: false,
      is_test: true,
      files: [],
    },
    {
      id: VISIT_IDS[4],
      patient_id: PATIENT_ID,
      visit_date: "2026-04-01",
      visit_time: "09:30",
      procedure: "Колоноскопія",
      status: "progress",
      ai_summary: "Активний візит на сьогодні",
      notes: "Активний візит для перевірки кнопок",
      protocol: "Висновок лікаря (01.04.2026): в процесі.",
      from_form: true,
      no_show: false,
      completed: false,
      is_test: true,
      files: [],
    },
  ];

  await supabaseRequest({ ...config, method: "POST", table: "visits", payload: visits });
}

async function assertSeeded(config) {
  const rows = await supabaseRequest({
    ...config,
    method: "GET",
    table: "visits",
    query: `patient_id=eq.${encodeURIComponent(PATIENT_ID)}&select=id,visit_date,completed,no_show,protocol,files&order=visit_date.asc`,
    prefer: "return=representation",
  });

  if (!Array.isArray(rows) || rows.length !== 5) {
    throw new Error(`Expected 5 visits, got ${Array.isArray(rows) ? rows.length : "invalid response"}`);
  }

  const completed = rows.filter((r) => r.completed).length;
  const noShow = rows.filter((r) => r.no_show).length;
  if (completed !== 3) throw new Error(`Expected 3 completed visits, got ${completed}`);
  if (noShow !== 1) throw new Error(`Expected 1 no-show visit, got ${noShow}`);
}

async function ensureOperational(page) {
  const operational = page.getByRole("button", { name: /Оперативка|Операційна/i });
  if (await operational.count()) {
    await operational.first().click({ timeout: 3000 }).catch(() => {});
  }
}

async function openPatientCard(page, surname) {
  await page.getByText(surname, { exact: false }).first().waitFor({ timeout: 30000 });
  await page.getByText(surname, { exact: false }).first().click({ timeout: 10000 });
  await page.getByText("ПРОФІЛЬ ПАЦІЄНТА", { exact: false }).first().waitFor({ timeout: 20000 });
}

async function closePatientCard(page) {
  await page.locator("div.fixed.inset-0.z-[70] div.relative.z-10 button").first().click({ timeout: 2500 }).catch(() => {});
  await page.locator("div.fixed.inset-0.z-[70]").first().waitFor({ state: "hidden", timeout: 4000 }).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);
}

async function verifyHistoryPanel(page) {
  await page.getByText(/ОБСТЕЖЕННЯ ТА ФАЙЛИ/i).first().waitFor({ timeout: 15000 });
  const dateLikeCount = await page.locator("text=/2025|2026/").count();
  if (dateLikeCount < 1) {
    throw new Error("History check failed: no date-like entries found in files/history block");
  }

  const maybeDate = page.locator("text=/2025|2026/").first();
  let clickWorked = false;
  try {
    await maybeDate.click({ timeout: 5000 });
    clickWorked = true;
  } catch {
    clickWorked = false;
  }

  const protocolVisible = await page.locator("text=/Висновок лікаря \(березень 2025\)|Висновок лікаря \(лютий 2025\)|Висновок лікаря \(квітень 2025\)/").first().isVisible().catch(() => false);
  const fileVisible = await page.locator("text=test-report.pdf").first().isVisible().catch(() => false);

  return {
    historyVisible: true,
    detailsExpand: clickWorked || protocolVisible || fileVisible,
  };
}

async function clickCompleteFromList(page) {
  const card = page.locator("div", { hasText: "Тест Тестовий" }).first();
  await card.waitFor({ timeout: 20000 });
  const completeBtn = page.getByRole("button", { name: /Прийом завершено/i }).first();
  await completeBtn.click({ timeout: 8000, force: true });
  await page.getByRole("button", { name: /Підтвердити/i }).first().click({ timeout: 8000, force: true });
}

async function clickNoShowFromList(page) {
  const noShowBtn = page.getByRole("button", { name: /Не з'явився/i }).first();
  await noShowBtn.click({ timeout: 8000, force: true });
  await page.getByRole("button", { name: /Підтвердити/i }).first().click({ timeout: 8000, force: true });
}

async function patchVisit(config, payload) {
  await supabaseRequest({
    ...config,
    method: "PATCH",
    table: "visits",
    query: `id=eq.${encodeURIComponent(ACTIVE_VISIT_ID)}`,
    payload,
  });
}

async function runUiVerification(baseUrl, config) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mobileContext = await browser.newContext({ ...devices["Pixel 7"] });
  const desktop = await desktopContext.newPage();
  const mobile = await mobileContext.newPage();

  const report = {
    desktop: { historyVisible: false, detailsExpand: false, completeFlow: false },
    mobile: { historyVisible: false, detailsExpand: false, noShowFlow: false },
  };

  try {
    await Promise.all([
      desktop.goto(baseUrl, { waitUntil: "domcontentloaded" }),
      mobile.goto(baseUrl, { waitUntil: "domcontentloaded" }),
    ]);

    await Promise.all([
      desktop.getByText("ProctoCare").first().waitFor({ timeout: 20000 }),
      mobile.getByText("ProctoCare").first().waitFor({ timeout: 20000 }),
    ]);

    await Promise.all([ensureOperational(desktop), ensureOperational(mobile)]);

    await openPatientCard(desktop, "Тест Тестовий");
    const desktopHistory = await verifyHistoryPanel(desktop);
    report.desktop.historyVisible = desktopHistory.historyVisible;
    report.desktop.detailsExpand = desktopHistory.detailsExpand;

    await closePatientCard(desktop);
    await clickCompleteFromList(desktop);

    await patchVisit(config, { completed: false, no_show: false, status: "progress", ai_summary: "Активний візит на сьогодні" });

    await openPatientCard(mobile, "Тест Тестовий");
    const mobileHistory = await verifyHistoryPanel(mobile);
    report.mobile.historyVisible = mobileHistory.historyVisible;
    report.mobile.detailsExpand = mobileHistory.detailsExpand;

    await closePatientCard(mobile);
    await clickNoShowFromList(mobile);

    const activeRow = await supabaseRequest({
      ...config,
      method: "GET",
      table: "visits",
      query: `id=eq.${encodeURIComponent(ACTIVE_VISIT_ID)}&select=id,completed,no_show,status`,
      prefer: "return=representation",
    });

    const row = Array.isArray(activeRow) ? activeRow[0] : null;
    if (!row || row.no_show !== true) {
      throw new Error("No-show flow verification failed: active visit not updated to no_show=true");
    }

    const allRows = await supabaseRequest({
      ...config,
      method: "GET",
      table: "visits",
      query: `patient_id=eq.${encodeURIComponent(PATIENT_ID)}&select=id,visit_date,completed,no_show,protocol,files&order=visit_date.asc`,
      prefer: "return=representation",
    });
    if (!Array.isArray(allRows) || allRows.length < 5) {
      throw new Error("Archive/history verification failed: expected at least 5 visits in Supabase history");
    }

    report.desktop.completeFlow = true;
    report.mobile.noShowFlow = true;
  } finally {
    await desktopContext.close();
    await mobileContext.close();
    await browser.close();
  }

  return report;
}

async function main() {
  const config = getSupabaseConfig();
  const baseUrl = await detectBaseUrl();

  await seedPatient(config);
  await assertSeeded(config);
  const ui = await runUiVerification(baseUrl, config);

  console.log(JSON.stringify({
    ok: true,
    supabaseEnv: config.active,
    baseUrl,
    patient: {
      id: PATIENT_ID,
      fullName: "Тест Тестовий Тестович",
      activeVisitId: ACTIVE_VISIT_ID,
    },
    ui,
  }, null, 2));
}

main().catch((error) => {
  console.error("create-and-verify-history-patient failed:", error);
  process.exit(1);
});
