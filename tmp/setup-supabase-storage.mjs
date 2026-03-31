/**
 * One-time setup: creates patient-files storage bucket + adds `files` JSONB column to visits.
 *
 * Usage:
 *   1. Add SUPABASE_TEST_SERVICE_KEY=<your service_role key> to .env.local
 *   2. node tmp/setup-supabase-storage.mjs
 *
 * The service_role key is in Supabase Dashboard → Settings → API → service_role (secret).
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
  } catch { return {}; }
}

function getConfig() {
  const env = {
    ...parseEnvFile(".env.local"),
    ...parseEnvFile("proctocare-ua-dash/.env.local"),
    ...process.env,
  };
  const active = (env.VITE_SUPABASE_ENV || "test").toLowerCase();
  const isProd = active === "prod";
  const url = isProd ? env.VITE_SUPABASE_PROD_URL : env.VITE_SUPABASE_TEST_URL;
  const anonKey = isProd ? env.VITE_SUPABASE_PROD_ANON_KEY : env.VITE_SUPABASE_TEST_ANON_KEY;
  const serviceKey = isProd
    ? (env.SUPABASE_PROD_SERVICE_KEY || env.VITE_SUPABASE_PROD_SERVICE_KEY)
    : (env.SUPABASE_TEST_SERVICE_KEY || env.VITE_SUPABASE_TEST_SERVICE_KEY);
  return { url, anonKey, serviceKey, active };
}

async function sql(url, serviceKey, query) {
  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql: query }),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

async function createBucket(url, serviceKey, bucketId) {
  // Try via storage API
  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: bucketId,
      name: bucketId,
      public: true,
      allowed_mime_types: null,
      file_size_limit: 52428800, // 50MB
    }),
  });
  const text = await res.text();
  if (res.ok) return { ok: true, message: "Bucket created" };
  if (text.includes("already exists") || text.includes("The resource already exists")) {
    return { ok: true, message: "Bucket already exists" };
  }
  return { ok: false, message: text };
}

async function ensureStoragePolicies(url, serviceKey, bucketId) {
  // Allow anon to read, upload and delete their own files
  const policies = [
    {
      name: `${bucketId}-anon-insert`,
      sql: `CREATE POLICY IF NOT EXISTS "anon_insert_${bucketId}" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = '${bucketId}');`,
    },
    {
      name: `${bucketId}-public-select`,
      sql: `CREATE POLICY IF NOT EXISTS "public_select_${bucketId}" ON storage.objects FOR SELECT TO public USING (bucket_id = '${bucketId}');`,
    },
    {
      name: `${bucketId}-anon-delete`,
      sql: `CREATE POLICY IF NOT EXISTS "anon_delete_${bucketId}" ON storage.objects FOR DELETE TO anon USING (bucket_id = '${bucketId}');`,
    },
  ];

  const results = [];
  for (const p of policies) {
    const r = await sql(url, serviceKey, p.sql);
    results.push({ policy: p.name, ok: r.ok || r.text.includes("already exists"), detail: r.text.slice(0, 100) });
  }
  return results;
}

async function main() {
  const { url, serviceKey, active } = getConfig();

  if (!serviceKey) {
    console.error(`
❌ Service role key not found.

Please add this line to your .env.local:
  SUPABASE_TEST_SERVICE_KEY=<your service_role key>

The key is here: Supabase Dashboard → Settings → API → service_role (secret).
`.trim());
    process.exit(1);
  }

  console.log(`\n🔧 Setting up Supabase for environment: ${active}\n`);

  // 1. Add `files` JSONB column to visits
  console.log("1. Adding `files` column to visits table...");
  const colSql = `ALTER TABLE visits ADD COLUMN IF NOT EXISTS files JSONB DEFAULT '[]'::JSONB;`;
  const colRes = await sql(url, serviceKey, colSql);
  if (colRes.ok || colRes.text.includes("already exists") || colRes.text.includes("42701")) {
    console.log("   ✅ Column ready");
  } else {
    console.log("   ⚠️  Column via RPC failed, trying direct query...");
    // Try direct REST approach
    const directRes = await fetch(`${url}/rest/v1/`, {
      method: "OPTIONS",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    console.log(`   Status ${colRes.status}: ${colRes.text.slice(0, 200)}`);
    console.log("\n   Run this SQL manually in Supabase Dashboard → SQL Editor:");
    console.log(`   ALTER TABLE visits ADD COLUMN IF NOT EXISTS files JSONB DEFAULT '[]'::JSONB;`);
  }

  // 2. Create storage bucket
  console.log("\n2. Creating storage bucket `patient-files`...");
  const bucketResult = await createBucket(url, serviceKey, "patient-files");
  console.log(bucketResult.ok ? `   ✅ ${bucketResult.message}` : `   ❌ ${bucketResult.message}`);

  // 3. Storage policies
  console.log("\n3. Setting storage policies...");
  const policyResults = await ensureStoragePolicies(url, serviceKey, "patient-files");
  for (const p of policyResults) {
    console.log(`   ${p.ok ? "✅" : "⚠️ "} ${p.policy}`);
  }

  console.log("\n✅ Setup complete. Restart the app to apply changes.\n");
}

main().catch(e => { console.error(e); process.exit(1); });
