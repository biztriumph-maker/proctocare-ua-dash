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
  } catch { return {}; }
}

function getSupabaseConfig() {
  const envLocal = { ...parseEnvFile(".env.local"), ...parseEnvFile("proctocare-ua-dash/.env.local") };
  const envBase  = { ...parseEnvFile(".env"),       ...parseEnvFile("proctocare-ua-dash/.env") };
  const env = { ...envBase, ...envLocal, ...process.env };
  const active = (env.VITE_SUPABASE_ENV || "test").toLowerCase();
  const url = active === "prod" ? env.VITE_SUPABASE_PROD_URL : env.VITE_SUPABASE_TEST_URL;
  const key = active === "prod" ? env.VITE_SUPABASE_PROD_ANON_KEY : env.VITE_SUPABASE_TEST_ANON_KEY;
  if (!url || !key) throw new Error("Supabase config missing");
  return { url, key, active };
}

async function main() {
  const { url, key } = getSupabaseConfig();
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  // 1. Check if 'files' column exists in visits table
  const testRes = await fetch(`${url}/rest/v1/visits?limit=1&select=id,files`, { headers });
  const testText = await testRes.text();
  const filesColumnExists = testRes.ok && !testText.includes('"code":"42703"') && !testText.includes("Column");

  let sampleFiles = null;
  if (filesColumnExists) {
    const sampleRes = await fetch(`${url}/rest/v1/visits?limit=3&select=id,files&files=not.is.null`, { headers });
    if (sampleRes.ok) {
      const data = await sampleRes.json();
      sampleFiles = data;
    }
  }

  // 2. Check storage buckets
  const bucketsRes = await fetch(`${url}/storage/v1/bucket`, { headers });
  const bucketsText = await bucketsRes.text();
  let buckets = null;
  try { buckets = JSON.parse(bucketsText); } catch {}

  console.log(JSON.stringify({
    filesColumnStatus: testRes.status,
    filesColumnExists,
    filesColumnResponse: testText.slice(0, 300),
    storageBuckets: bucketsRes.status === 200 ? buckets : bucketsText.slice(0, 200),
    sampleFilesInDB: sampleFiles,
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
