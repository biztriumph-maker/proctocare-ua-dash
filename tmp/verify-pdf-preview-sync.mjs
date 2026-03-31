import { chromium, devices } from "playwright";
import { readFileSync } from "node:fs";

const BASE_URL = "http://localhost:8080";
const BUCKET = "patient-files";

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
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function sbDelete(url, key, table, filter) {
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(await res.text());
}

async function storageUpload(url, key, bucket, path, bytes, contentType) {
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(await res.text());
}

async function storageDelete(url, key, bucket, path) {
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(await res.text());
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function displayDate(date) {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

function publicObjectUrl(url, bucket, path) {
  const encodedPath = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${url}/storage/v1/object/public/${bucket}/${encodedPath}`;
}

function tinyPdfBytes() {
  const minimalPdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 53 >>\nstream\nBT\n/F1 18 Tf\n40 72 Td\n(Hello PDF from e2e) Tj\nET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000010 00000 n \n0000000063 00000 n \n0000000120 00000 n \n0000000246 00000 n \n0000000351 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n421\n%%EOF\n`;
  return new TextEncoder().encode(minimalPdf);
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

async function openFilesTab(page) {
  const byRole = page.getByRole("button", { name: /files|файли|обстеження/i });
  if (await byRole.count()) {
    await byRole.first().click();
    return;
  }

  const byTitle = page.getByText(/files|файли|обстеження/i).first();
  if (await byTitle.count()) {
    await byTitle.click();
    return;
  }

  throw new Error("Could not find files tab on page");
}

async function assertPdfPreview(page, fileName) {
  const fileRow = page.locator("div", { hasText: fileName }).first();
  await fileRow.waitFor({ timeout: 15000 });

  const viewButton = fileRow.locator('button[title="Переглянути"]').first();
  if (await viewButton.count()) {
    await viewButton.click();
  } else {
    await page.getByTitle("Переглянути").first().click();
  }

  await page.getByText(fileName).first().waitFor({ timeout: 15000 });

  let iframeVisible = false;
  try {
    await page.locator("iframe").first().waitFor({ timeout: 15000 });
    iframeVisible = true;
  } catch {
    iframeVisible = false;
  }

  const hasError = await page
    .getByText("Не вдалося відкрити PDF для перегляду", { exact: false })
    .first()
    .isVisible()
    .catch(() => false);

  return { modalOpened: true, iframeVisible, hasError };
}

async function run() {
  const { url, key } = getTestSupabaseConfig();
  if (!url || !key) {
    throw new Error("Missing VITE_SUPABASE_TEST_URL or VITE_SUPABASE_TEST_ANON_KEY");
  }

  const token = Date.now();
  const visitId = `pdf-${token}`;
  const surname = `PDF${token}`;
  const now = new Date();
  const visitDateIso = isoDate(now);
  const visitDateDisplay = displayDate(now);

  const fileName = `autotest-${token}.pdf`;
  const storagePath = `${visitId}/${fileName}`;
  const pdfUrl = publicObjectUrl(url, BUCKET, storagePath);

  const report = {
    ok: false,
    desktop: { modalOpened: false, iframeVisible: false, hasError: false },
    mobile: { modalOpened: false, iframeVisible: false, hasError: false },
  };

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const desktopContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const mobileContext = await browser.newContext({ ...devices["Pixel 7"] });
  const desktopPage = await desktopContext.newPage();
  const mobilePage = await mobileContext.newPage();

  try {
    await storageUpload(url, key, BUCKET, storagePath, tinyPdfBytes(), "application/pdf");

    await sbInsert(url, key, "patients", [{
      id: visitId,
      name: `${surname} Test`,
      patronymic: "Test",
      phone: "+380671111222",
      birth_date: "15.05.1972",
      is_test: true,
    }]);

    await sbInsert(url, key, "visits", [{
      id: visitId,
      patient_id: visitId,
      visit_date: visitDateIso,
      visit_time: "10:00",
      procedure: "Колоноскопія",
      status: "planning",
      from_form: true,
      is_test: true,
      files: [{
        id: "pdf-file-1",
        name: fileName,
        type: "doctor",
        date: visitDateDisplay,
        url: pdfUrl,
        mimeType: "application/pdf",
      }],
    }]);

    await Promise.all([
      desktopPage.goto(BASE_URL, { waitUntil: "domcontentloaded" }),
      mobilePage.goto(BASE_URL, { waitUntil: "domcontentloaded" }),
    ]);

    await Promise.all([
      desktopPage.getByText("ProctoCare").first().waitFor({ timeout: 15000 }),
      mobilePage.getByText("ProctoCare").first().waitFor({ timeout: 15000 }),
    ]);

    await Promise.all([
      ensureOperational(desktopPage),
      ensureOperational(mobilePage),
    ]);

    await Promise.all([
      openPatientCard(desktopPage, surname),
      openPatientCard(mobilePage, surname),
    ]);

    await Promise.all([
      openFilesTab(desktopPage),
      openFilesTab(mobilePage),
    ]);

    const [desktopResult, mobileResult] = await Promise.all([
      assertPdfPreview(desktopPage, fileName),
      assertPdfPreview(mobilePage, fileName),
    ]);

    report.desktop = desktopResult;
    report.mobile = mobileResult;
    report.ok =
      desktopResult.modalOpened &&
      desktopResult.iframeVisible &&
      !desktopResult.hasError &&
      mobileResult.modalOpened &&
      mobileResult.iframeVisible &&
      !mobileResult.hasError;

    console.log(JSON.stringify(report, null, 2));
  } finally {
    try { await sbDelete(url, key, "visits", `id=eq.${encodeURIComponent(visitId)}`); } catch {}
    try { await sbDelete(url, key, "patients", `id=eq.${encodeURIComponent(visitId)}`); } catch {}
    try { await storageDelete(url, key, BUCKET, storagePath); } catch {}

    await desktopContext.close();
    await mobileContext.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error("verify-pdf-preview-sync failed:", error);
  process.exit(1);
});
