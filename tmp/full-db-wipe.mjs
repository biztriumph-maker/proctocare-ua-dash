/**
 * FULL DATABASE WIPE — видаляє ВСІ записи з visits та patients.
 * Таблиці залишаються порожніми. UUID-based — sequence не потрібно скидати.
 */
import { readFileSync } from "node:fs";

function parseEnvFile(f) {
  try {
    const raw = readFileSync(f, "utf8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, "");
    }
    return out;
  } catch { return {}; }
}

const env = {
  ...parseEnvFile(".env"),
  ...parseEnvFile("proctocare-ua-dash/.env"),
  ...parseEnvFile(".env.local"),
  ...parseEnvFile("proctocare-ua-dash/.env.local"),
  ...process.env,
};

const active = (env.VITE_SUPABASE_ENV || "test").toLowerCase();
const isProd = active === "prod";

if (isProd) {
  console.error("❌ СТОП! Скрипт виявив PROD середовище. Відмовляюся виконувати.");
  process.exit(1);
}

const url = env.VITE_SUPABASE_TEST_URL;
const key = env.VITE_SUPABASE_TEST_ANON_KEY;

if (!url || !key) {
  console.error("❌ Не знайдено VITE_SUPABASE_TEST_URL або VITE_SUPABASE_TEST_ANON_KEY у .env файлі.");
  process.exit(1);
}

async function api(path, options = {}) {
  const res = await fetch(`${url}/rest/v1${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
    },
    ...options,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text}`);
  return text ? JSON.parse(text) : [];
}

async function count(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=id`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact",
    },
  });
  const countHeader = res.headers.get("content-range");
  if (countHeader) {
    const m = countHeader.match(/\/(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  const data = await res.json();
  return Array.isArray(data) ? data.length : 0;
}

async function main() {
  console.log(`\n=== FULL DB WIPE — Supabase TEST ===\n`);

  // 1. Підрахунок ПЕРЕД видаленням
  const visitsBefore = await count("visits");
  const patientsBefore = await count("patients");
  console.log(`Перед очищенням:`);
  console.log(`  visits:   ${visitsBefore}`);
  console.log(`  patients: ${patientsBefore}`);

  if (visitsBefore === 0 && patientsBefore === 0) {
    console.log("\n✅ База вже порожня. Нічого не видалено.");
    return;
  }

  // 2. Спочатку видаляємо visits (foreign key → patients)
  console.log(`\nВидаляємо всі visits...`);
  await api(`/visits?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: "DELETE",
    prefer: "return=minimal",
  });

  // 3. Потім patients
  console.log(`Видаляємо всіх patients...`);
  await api(`/patients?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: "DELETE",
    prefer: "return=minimal",
  });

  // 4. Підрахунок ПІСЛЯ видалення
  const visitsAfter = await count("visits");
  const patientsAfter = await count("patients");

  console.log(`\nПісля очищення:`);
  console.log(`  visits:   ${visitsAfter}`);
  console.log(`  patients: ${patientsAfter}`);

  if (visitsAfter === 0 && patientsAfter === 0) {
    console.log(`\n✅ База повністю очищена. 0 пацієнтів, 0 візитів.`);
    console.log(`   (UUID-based схема — sequence скидати не потрібно)\n`);
  } else {
    console.error(`\n⚠️  Залишилися записи! visits: ${visitsAfter}, patients: ${patientsAfter}`);
    console.error(`   Можливо, є RLS-обмеження. Перевір через Supabase Dashboard → SQL Editor.\n`);
  }
}

main().catch((err) => {
  console.error("❌ Помилка:", err.message);
  process.exit(1);
});
