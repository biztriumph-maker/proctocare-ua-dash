/**
 * Check if there are any visits from 2025 in DB, regardless of patient
 * Also check if patients table has last_visit column
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

  // 1. All visits before 2026
  const old = await api(`/visits?visit_date=lt.2026-01-01&select=id,visit_date,visit_time,protocol&order=visit_date.desc`);
  console.log(`\n📌 Всього візитів до 2026: ${old.length}`);
  for (const v of old) {
    const proto = (v.protocol || "").slice(0, 60).replace(/\n/g, " ");
    console.log(`  ${v.id} | ${v.visit_date} | protocol="${proto}"`);
  }

  // 2. All columns in patients table (check first record)
  const pats = await api(`/patients?limit=1&select=*`);
  console.log("\n📋 Columns in patients table (first row keys):");
  if (pats.length > 0) console.log("  ", Object.keys(pats[0]).join(", "));

  // 3. Petushkov patients row
  const petPats = await api(`/patients?name=ilike.*%D0%9F%D0%B5%D1%82%D1%83%D1%88*&select=*`);
  console.log("\n📋 Petushkov in patients table:");
  for (const p of petPats) console.log("  ", JSON.stringify(p));

  // 4. All visits for Petushkov patient_ids
  const petIds = petPats.map(p => p.id);
  if (petIds.length) {
    const petVisits = await api(`/visits?patient_id=in.(${petIds.join(",")})&select=*&order=visit_date.asc`);
    console.log("\n📋 All visits for Petushkov:");
    for (const v of petVisits) {
      console.log("  ", JSON.stringify({
        id: v.id,
        visit_date: v.visit_date,
        visit_time: v.visit_time,
        status: v.status,
        completed: v.completed,
        protocol: (v.protocol || "").slice(0, 80),
        // Show ALL columns
        ...Object.fromEntries(Object.entries(v).filter(([k]) => !["id","visit_date","visit_time","status","completed","protocol","patient_id","notes","primary_notes","ai_summary","is_test","no_show","from_form","files"].includes(k)))
      }));
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
