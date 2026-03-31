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

  if (!url || !key) {
    throw new Error("Supabase config missing in env files");
  }

  return { url, key, active };
}

async function main() {
  const { url, key, active } = getSupabaseConfig();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const findRes = await fetch(
    `${url}/rest/v1/visits?visit_date=eq.${todayIso}&or=(visit_time.eq.16:00,visit_time.eq.17:00)&select=id,visit_time,patients(name)`,
    { headers }
  );

  if (!findRes.ok) {
    throw new Error(`Failed to fetch visits: ${findRes.status} ${await findRes.text()}`);
  }

  const visits = await findRes.json();
  const ids = visits.map((v) => v.id);

  if (ids.length === 0) {
    console.log(JSON.stringify({ ok: true, env: active, found: 0, deleted: 0 }, null, 2));
    return;
  }

  const idFilter = `(${ids.join(",")})`;

  const delRes = await fetch(
    `${url}/rest/v1/visits?id=in.${idFilter}`,
    {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=representation" },
    }
  );

  if (!delRes.ok) {
    throw new Error(`Failed to delete visits: ${delRes.status} ${await delRes.text()}`);
  }

  const deleted = await delRes.json();

  console.log(
    JSON.stringify(
      {
        ok: true,
        env: active,
        found: visits.length,
        deleted: deleted.length,
        details: visits.map(v => ({ id: v.id, time: v.visit_time, patient: v.patients?.[0]?.name })),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("cleanup-1600-1700 failed:", error);
  process.exit(1);
});
