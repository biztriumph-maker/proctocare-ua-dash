import { chromium, devices } from "playwright";
import { readFileSync } from "node:fs";

const CANDIDATE_URLS = [
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];

async function detectBaseUrl() {
  for (const url of CANDIDATE_URLS) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return url;
    } catch {
      // try next
    }
  }
  throw new Error("Dev server not reachable on known URLs (8080/5173)");
}

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

  if (!url || !key) {
    throw new Error("Supabase config missing in .env.local");
  }

  return { url, key, active };
}

async function supabaseInsert({ url, key, table, payload }) {
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

  if (!res.ok) {
    throw new Error(`Supabase insert failed (${table}): ${res.status} ${await res.text()}`);
  }
}

async function supabasePatch({ url, key, table, matchColumn, matchValue, payload }) {
  const res = await fetch(`${url}/rest/v1/${table}?${matchColumn}=eq.${encodeURIComponent(matchValue)}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Supabase patch failed (${table}): ${res.status} ${await res.text()}`);
  }
}

async function ensureOperational(page) {
  const operational = page.getByRole("button", { name: /Операційна/i });
  if (await operational.count()) {
    await operational.first().click({ timeout: 3000 }).catch(() => {});
  }
}

async function seedPatientVisit(config, patientId, fullName, dateIso) {
  const [surname, firstName, patronymic] = fullName.split(/\s+/);

  await supabaseInsert({
    ...config,
    table: "patients",
    payload: [{
      id: patientId,
      name: `${surname} ${firstName}`,
      patronymic,
      phone: "+380671119999",
      birth_date: "11.11.1990",
      is_test: true,
    }],
  });

  await supabaseInsert({
    ...config,
    table: "visits",
    payload: [{
      id: patientId,
      patient_id: patientId,
      visit_date: dateIso,
      visit_time: "16:00",
      procedure: "Колоноскопія",
      status: "planning",
      no_show: false,
      completed: false,
      ai_summary: "status e2e",
      from_form: true,
      is_test: true,
    }],
  });
}

async function waitPatientBadge(page, surname, badgeText) {
  await page.waitForFunction(
    ({ surnameArg, badgeArg }) => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.some((btn) => {
        if (!btn.textContent || !btn.textContent.includes(surnameArg)) return false;
        const cardRoot = btn.closest("div")?.parentElement;
        const text = (cardRoot?.textContent || btn.textContent || "").replace(/\s+/g, " ");
        return text.includes(badgeArg);
      });
    },
    { surnameArg: surname, badgeArg: badgeText },
    { timeout: 30000 }
  );
}

async function runStage(config, patientId, desktop, mobile, stageName, payload, expectedBadge) {
  await supabasePatch({
    ...config,
    table: "visits",
    matchColumn: "id",
    matchValue: patientId,
    payload,
  });

  await Promise.all([
    waitPatientBadge(desktop, patientId, expectedBadge).catch(async () => waitPatientBadge(desktop, payload.markerSurname || "", expectedBadge)),
    waitPatientBadge(mobile, patientId, expectedBadge).catch(async () => waitPatientBadge(mobile, payload.markerSurname || "", expectedBadge)),
  ]);

  return true;
}

async function run() {
  const baseUrl = await detectBaseUrl();
  const supabaseConfig = getSupabaseConfig();
  const token = Date.now();
  const surname = `STAT${token}`;
  const fullName = `${surname} Іван Іванович`;
  const patientId = `status-e2e-${token}`;
  const today = new Date();
  const dateIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mobileContext = await browser.newContext({ ...devices["Pixel 7"] });
  const desktop = await desktopContext.newPage();
  const mobile = await mobileContext.newPage();

  const report = {
    ok: false,
    baseUrl,
    supabaseEnv: supabaseConfig.active,
    patientId,
    stages: {
      status_progress: false,
      no_show_true: false,
      completed_true: false,
    },
  };

  try {
    await seedPatientVisit(supabaseConfig, patientId, fullName, dateIso);

    await Promise.all([
      desktop.goto(baseUrl, { waitUntil: "domcontentloaded" }),
      mobile.goto(baseUrl, { waitUntil: "domcontentloaded" }),
    ]);

    await Promise.all([
      desktop.getByText("ProctoCare").first().waitFor({ timeout: 15000 }),
      mobile.getByText("ProctoCare").first().waitFor({ timeout: 15000 }),
    ]);

    await Promise.all([ensureOperational(desktop), ensureOperational(mobile)]);

    await Promise.all([
      desktop.getByText(surname).first().waitFor({ timeout: 30000 }),
      mobile.getByText(surname).first().waitFor({ timeout: 30000 }),
    ]);

    await supabasePatch({
      ...supabaseConfig,
      table: "visits",
      matchColumn: "id",
      matchValue: patientId,
      payload: { status: "progress", no_show: false, completed: false },
    });
    await Promise.all([
      waitPatientBadge(desktop, surname, "Підготовка"),
      waitPatientBadge(mobile, surname, "Підготовка"),
    ]);
    report.stages.status_progress = true;

    await supabasePatch({
      ...supabaseConfig,
      table: "visits",
      matchColumn: "id",
      matchValue: patientId,
      payload: { no_show: true, completed: false, status: "risk" },
    });
    await Promise.all([
      waitPatientBadge(desktop, surname, "Не з'явився"),
      waitPatientBadge(mobile, surname, "Не з'явився"),
    ]);
    report.stages.no_show_true = true;

    await supabasePatch({
      ...supabaseConfig,
      table: "visits",
      matchColumn: "id",
      matchValue: patientId,
      payload: { no_show: false, completed: true, status: "ready" },
    });
    await Promise.all([
      waitPatientBadge(desktop, surname, "Виконано"),
      waitPatientBadge(mobile, surname, "Виконано"),
    ]);
    report.stages.completed_true = true;

    report.ok = Object.values(report.stages).every(Boolean);
  } finally {
    await desktopContext.close();
    await mobileContext.close();
    await browser.close();
  }

  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error("verify-visit-status-sync failed:", error);
  process.exit(1);
});
