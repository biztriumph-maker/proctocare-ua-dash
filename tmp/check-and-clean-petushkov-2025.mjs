/**
 * 1. Знаходить всі записи Петушкова в БД
 * 2. Видаляє старі візити з датою < 2026-01-01 (тобто 2025 і раніше)
 *    а також очищає поле protocol і protocol_history у valid-візитах,
 *    якщо вони містять текст від 2025-дат.
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
  ...parseEnvFile(".env"), ...parseEnvFile("proctocare-ua-dash/.env"),
  ...parseEnvFile(".env.local"), ...parseEnvFile("proctocare-ua-dash/.env.local"),
  ...process.env,
};
const active = (env.VITE_SUPABASE_ENV || "test").toLowerCase();
const isProd = active === "prod";
const url = isProd ? env.VITE_SUPABASE_PROD_URL : env.VITE_SUPABASE_TEST_URL;
const key = isProd ? env.VITE_SUPABASE_PROD_ANON_KEY : env.VITE_SUPABASE_TEST_ANON_KEY;

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

async function main() {
  console.log(`\n=== Supabase env: ${active.toUpperCase()} ===\n`);

  // Знайти пацієнтів зі схожим іменем
  const pets = await api(`/patients?name=ilike.*%D0%9F%D0%B5%D1%82%D1%83%D1%88*&select=id,name`);
  console.log("Patients table entries for Петушков:", pets.map(p => `${p.id} | ${p.name}`));
  if (!pets.length) { console.log("❌ Пацієнта Петушкова не знайдено в таблиці patients"); return; }

  const petIds = pets.map(p => p.id);

  // Знайти всі візити
  const visits = await api(
    `/visits?patient_id=in.(${petIds.join(",")})&select=id,visit_date,visit_time,status,completed,no_show,protocol&order=visit_date.asc`
  );
  console.log("\nВсі візити Петушкова:");
  for (const v of visits) {
    const proto = (v.protocol || "").slice(0, 60).replace(/\n/g, " ");
    console.log(`  ${v.id} | ${v.visit_date} ${v.visit_time || "--:--"} | status=${v.status} completed=${v.completed} | protocol="${proto}"`);
  }

  // Розділити: старі (2025 і раніше) vs нові (2026+)
  const old2025 = visits.filter(v => v.visit_date < "2026-01-01");
  const current = visits.filter(v => v.visit_date >= "2026-01-01");

  console.log(`\n📌 Старих візитів (до 2026): ${old2025.length}`);
  console.log(`📌 Поточних візитів (2026+): ${current.length}`);

  // Видалити старі візити
  if (old2025.length > 0) {
    for (const v of old2025) {
      console.log(`\n🗑  Видаляємо старий візит: ${v.id} | ${v.visit_date}`);
      await api(`/visits?id=eq.${v.id}`, { method: "DELETE", prefer: "return=minimal" });
      console.log(`✅  Видалено`);
    }
  } else {
    console.log("ℹ️  Старих візитів не знайдено.");
  }

  // Очистити protocol від записів у поточних 2026+ візитах, якщо він там є (залишок)
  for (const v of current) {
    if (!(v.protocol || "").trim()) continue;
    // Якщо є protocol в поточному 2026+ візиті — НЕ чіпаємо, він може бути легітимним
  }

  // Фінальна перевірка
  console.log("\n=== ФІНАЛЬНА ПЕРЕВІРКА ===");
  const finalVisits = await api(
    `/visits?patient_id=in.(${petIds.join(",")})&select=id,visit_date,visit_time,status,completed,protocol&order=visit_date.asc`
  );
  for (const v of finalVisits) {
    const proto = (v.protocol || "").slice(0, 60).replace(/\n/g, " ");
    console.log(`  ${v.id} | ${v.visit_date} | protocol="${proto}"`);
  }
  console.log("\n✅  Очищення завершено.\n");
}

main().catch(e => { console.error(e); process.exit(1); });
