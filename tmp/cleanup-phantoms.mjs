/**
 * Audits and cleans phantom visits for Курочкіна and Петушков.
 * Keeps:
 *  - Kurochkina: only the April 17 planning visit
 *  - Petushkov: only v7 (completed April 10) + one June 10 planning visit
 * Deletes everything else that looks phantom/duplicate.
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
      out[t.slice(0,i).trim()] = t.slice(i+1).trim().replace(/^"|"$/g,"");
    }
    return out;
  } catch { return {}; }
}

const env = {
  ...parseEnvFile(".env"), ...parseEnvFile("proctocare-ua-dash/.env"),
  ...parseEnvFile(".env.local"), ...parseEnvFile("proctocare-ua-dash/.env.local"),
  ...process.env
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

  // ── KUROCHKINA ─────────────────────────────────────────────────────────
  const kurPats = await api(`/patients?name=ilike.*%D0%9A%D1%83%D1%80%D0%BE%D1%87*&select=id,name`);
  console.log("Курочкіна patients:", kurPats.map(p=>`${p.id} | ${p.name}`));
  const kurIds = kurPats.map(p=>p.id);

  if (kurIds.length) {
    const kurVisits = await api(`/visits?patient_id=in.(${kurIds.join(",")})&select=id,visit_date,visit_time,status,completed,no_show`);
    console.log("Курочкіна visits:", kurVisits);

    for (const v of kurVisits) {
      // Keep only the April 17 planning visit
      const isGood = (v.visit_date === "2026-04-17");
      if (!isGood) {
        console.log(`🗑  Deleting phantom Kurochkina visit: ${v.id} | ${v.visit_date} | ${v.status}`);
        await api(`/visits?id=eq.${v.id}`, { method: "DELETE", prefer: "return=minimal" });
      } else {
        console.log(`✅  Keeping: ${v.id} | ${v.visit_date} | ${v.status}`);
      }
    }
  }

  // ── PETUSHKOV ──────────────────────────────────────────────────────────
  const petPats = await api(`/patients?name=ilike.*%D0%9F%D0%B5%D1%82%D1%83%D1%88*&select=id,name`);
  console.log("\nПетушков patients:", petPats.map(p=>`${p.id} | ${p.name}`));
  const petIds = petPats.map(p=>p.id);

  if (petIds.length) {
    const petVisits = await api(`/visits?patient_id=in.(${petIds.join(",")})&select=id,visit_date,visit_time,status,completed,no_show`);
    console.log("Петушков visits:", petVisits);

    // Keep: v7 (completed Apr 10) + LATEST June 10 planning visit
    const jun10 = petVisits
      .filter(v => v.visit_date === "2026-06-10" && !v.completed)
      .sort((a, b) => a.id > b.id ? -1 : 1); // latest id first

    const keepIds = new Set();
    keepIds.add("v7");
    if (jun10.length) keepIds.add(jun10[0].id); // keep only the latest June 10

    for (const v of petVisits) {
      if (keepIds.has(v.id)) {
        console.log(`✅  Keeping: ${v.id} | ${v.visit_date} | ${v.status} | completed=${v.completed}`);
      } else {
        console.log(`🗑  Deleting phantom: ${v.id} | ${v.visit_date} | ${v.status}`);
        await api(`/visits?id=eq.${v.id}`, { method: "DELETE", prefer: "return=minimal" });
      }
    }

    // Ensure v7 is on April 10, completed=true
    await api(`/visits?id=eq.v7`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ visit_date: "2026-04-10", completed: true }),
    });
    console.log("✅  Confirmed v7 = April 10, completed=true");
  }

  console.log("\n=== Cleanup done ===\n");
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
