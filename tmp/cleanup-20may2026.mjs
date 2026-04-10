/**
 * Removes all visits with visit_date = '2026-05-20' created during testing.
 */
import { readFileSync } from "node:fs";

function parseEnvFile(f) {
  try {
    const raw = readFileSync(f, "utf8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const idx = t.indexOf("=");
      if (idx < 0) continue;
      out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const env = {
  ...parseEnvFile("proctocare-ua-dash/.env"),
  ...parseEnvFile("proctocare-ua-dash/.env.local"),
};

const SUPABASE_URL = env.VITE_SUPABASE_TEST_URL || env.VITE_SUPABASE_URL;
const SUPABASE_KEY = env.VITE_SUPABASE_TEST_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

async function supabase(path, method = "GET", body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "DELETE" ? "return=representation" : "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

const TARGET_DATE = "2026-05-20";

// 1. Find all visits on that date
const { data: visits, ok } = await supabase(`/visits?visit_date=eq.${TARGET_DATE}&select=id,patient_id,visit_date,visit_time,status,procedure`);
if (!ok) { console.error("Failed to fetch visits:", visits); process.exit(1); }

if (!visits.length) {
  console.log(`✅ No visits found on ${TARGET_DATE}. Nothing to delete.`);
  process.exit(0);
}

console.log(`Found ${visits.length} visit(s) on ${TARGET_DATE}:`);
for (const v of visits) {
  console.log(`  id=${v.id}  patient_id=${v.patient_id}  time=${v.visit_time}  status=${v.status}  procedure=${v.procedure}`);
}

// 2. Delete them all
const { data: deleted, ok: delOk, status } = await supabase(
  `/visits?visit_date=eq.${TARGET_DATE}`,
  "DELETE"
);
if (!delOk) {
  console.error(`❌ Delete failed (HTTP ${status}):`, deleted);
  process.exit(1);
}
console.log(`✅ Deleted ${visits.length} visit(s) on ${TARGET_DATE}.`);
