/**
 * Data fix:
 *  1. Delete the wrongly created Kurochkina visit on June 10
 *  2. Verify Kurochkina's April 17 visit is intact
 *  3. Reschedule Petushkov's April 10 (today) visit to June 10, keeping his time (09:00)
 */
import { readFileSync } from "node:fs";

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

  if (!url || !key) throw new Error("Supabase config missing in env files");
  return { url, key, active };
}

async function apiFetch(url, key, path, options = {}) {
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
  const { url, key, active } = getSupabaseConfig();
  console.log(`\n=== Supabase env: ${active.toUpperCase()} ===\n`);

  // ── Step 1: Find Kurochkina's patient_id ──────────────────────────────────
  const kurPatients = await apiFetch(url, key, `/patients?name=ilike.*%D0%9A%D1%83%D1%80%D0%BE%D1%87*&select=id,name`);
  if (!kurPatients.length) {
    console.log("❌  Пацієнта Курочкіна не знайдено в таблиці patients");
    return;
  }
  console.log("Курочкіна patients:", kurPatients.map(p => `${p.id} | ${p.name}`).join("\n"));
  const kurIds = kurPatients.map(p => p.id);

  // ── Step 2: Find and delete wrong June 10 visit for Kurochkina ───────────
  const kurJune10 = await apiFetch(url, key,
    `/visits?visit_date=eq.2026-06-10&patient_id=in.(${kurIds.join(",")})&select=id,visit_date,visit_time,status,completed`
  );
  if (!kurJune10.length) {
    console.log("ℹ️  Записів Курочкіної на 10 червня не знайдено (можливо вже видалено)");
  } else {
    console.log("🗑  Знайдено помилкові записи Курочкіної на 10 червня:");
    console.log(kurJune10);
    for (const v of kurJune10) {
      await apiFetch(url, key, `/visits?id=eq.${v.id}`, { method: "DELETE", prefer: "return=minimal" });
      console.log(`✅  Deleted visit id=${v.id}`);
    }
  }

  // ── Step 3: Verify Kurochkina's April 17 visit ───────────────────────────
  const kurApr17 = await apiFetch(url, key,
    `/visits?visit_date=eq.2026-04-17&patient_id=in.(${kurIds.join(",")})&select=id,visit_date,visit_time,status,completed`
  );
  if (kurApr17.length) {
    console.log("✅  Запис Курочкіної на 17 квітня існує:", kurApr17);
  } else {
    console.log("⚠️  Запис Курочкіної на 17 квітня НЕ ЗНАЙДЕНО — можливо вже був видалений раніше");
  }

  // ── Step 4: Reschedule Petushkov April 10 → June 10 ──────────────────────
  const petPatients = await apiFetch(url, key, `/patients?name=ilike.*%D0%9F%D0%B5%D1%82%D1%83%D1%88*&select=id,name`);
  if (!petPatients.length) {
    console.log("❌  Пацієнта Петушков не знайдено в таблиці patients");
    return;
  }
  console.log("\nПетушков patients:", petPatients.map(p => `${p.id} | ${p.name}`).join("\n"));
  const petIds = petPatients.map(p => p.id);

  const petApr10 = await apiFetch(url, key,
    `/visits?visit_date=eq.2026-04-10&patient_id=in.(${petIds.join(",")})&select=id,visit_date,visit_time,status,completed`
  );
  if (!petApr10.length) {
    console.log("⚠️  Петушкова на 10 квітня не знайдено (можливо вже перенесено?)");
    // check June 10 just in case
    const petJun10 = await apiFetch(url, key,
      `/visits?visit_date=eq.2026-06-10&patient_id=in.(${petIds.join(",")})&select=id,visit_date,visit_time,status`
    );
    console.log("Петушков on June 10:", petJun10);
  } else {
    console.log("Петушков on April 10:", petApr10);
    for (const v of petApr10) {
      await apiFetch(url, key, `/visits?id=eq.${v.id}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: JSON.stringify({ visit_date: "2026-06-10" }),
      });
      console.log(`✅  Петушков перенесено: id=${v.id}  →  2026-06-10 ${v.visit_time}`);
    }
  }

  console.log("\n=== Готово ===\n");
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
