/**
 * Clean Petushkov DB record:
 * - clear notes / primaryNotes with test content
 * - clear lastVisit from patients table (if column exists)
 * - clear diagnosis if it contains old mock value
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

  // Get all Petushkov visits with full data
  const pets = await api(`/patients?name=ilike.*%D0%9F%D0%B5%D1%82%D1%83%D1%88*&select=id,name`);
  const petIds = pets.map(p => p.id);
  console.log("Petushkov patient rows:", pets.map(p => `${p.id} | ${p.name}`));

  if (!petIds.length) { console.log("No Petushkov patients found"); return; }

  const visits = await api(
    `/visits?patient_id=in.(${petIds.join(",")})&select=id,visit_date,notes,primary_notes,protocol,status,completed`
  );
  console.log("\nAll visits:");
  for (const v of visits) {
    console.log(`  ${v.id} | ${v.visit_date} | notes="${v.notes}" | primaryNotes="${v.primary_notes}" | protocol="${(v.protocol||"").slice(0,60)}"`);
  }

  // Clear notes/primaryNotes that contain test data
  const testNotePatterns = [/привет/i, /дружище/i, /позвонить/i, /переговорить/i, /переноса/i];
  for (const v of visits) {
    const notesIsTest = testNotePatterns.some(rx => rx.test(v.notes || "") || rx.test(v.primary_notes || ""));
    if (notesIsTest) {
      console.log(`\n🧹 Clearing test notes in visit ${v.id} (${v.visit_date})`);
      await api(`/visits?id=eq.${v.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ notes: null, primary_notes: null }),
      });
      console.log("✅ Done");
    }
  }

  // Check patients table for last_visit column
  const patientRow = await api(`/patients?id=eq.${petIds[0]}&select=*`);
  if (patientRow.length > 0) {
    console.log("\nPatient row:", JSON.stringify(patientRow[0]));
    const row = patientRow[0];
    // If there's a last_visit or lastVisit column with 2025 date, clear it
    const updates = {};
    if ((row.last_visit || "").includes("2025")) updates.last_visit = null;
    if ((row.lastVisit || "").includes("2025")) updates.lastVisit = null;
    // Clear mock diagnosis
    const diagnosisIsMock = /^(язва|гастрит)$/i.test((row.diagnosis || "").trim());
    // Don't auto-clear diagnosis as it might be real
    if (Object.keys(updates).length) {
      console.log(`\n🧹 Clearing stale fields from patients row:`, updates);
      await api(`/patients?id=eq.${petIds[0]}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify(updates),
      });
      console.log("✅ Done");
    } else {
      console.log("\nℹ️ No stale fields in patients table to clear");
    }
  }

  console.log("\n✅ Cleanup done.\n");
}

main().catch(e => { console.error(e); process.exit(1); });
