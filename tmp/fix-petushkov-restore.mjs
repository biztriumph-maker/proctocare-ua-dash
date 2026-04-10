/**
 * Fix Petushkov data:
 *  1. Restore v7 (completed April 10) back to April 10
 *  2. Create a NEW planning visit for Petushkov on June 10
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

const d1 = await api("/visits?id=eq.v7", {
  method: "PATCH",
  prefer: "return=representation",
  body: JSON.stringify({ visit_date: "2026-04-10" }),
});
console.log("1. Restored v7 → April 10:", d1[0]?.visit_date, "completed:", d1[0]?.completed);

const newId = `new-petushkov-jun10-${Date.now()}`;
const d2 = await api("/visits", {
  method: "POST",
  prefer: "return=representation",
  body: JSON.stringify({
    id: newId,
    patient_id: "mock-petushkov",
    visit_date: "2026-06-10",
    visit_time: "09:00",
    status: "planning",
    completed: false,
    no_show: false,
    from_form: true,
  }),
});
console.log("2. New planning visit June 10:", d2[0]?.id, d2[0]?.visit_date, d2[0]?.status);
console.log("Done");
