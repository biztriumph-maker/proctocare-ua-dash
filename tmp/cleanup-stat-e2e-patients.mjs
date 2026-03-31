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

  const findRes = await fetch(
    `${url}/rest/v1/patients?select=id,name&or=(name.ilike.STAT*,name.ilike.E2E*)`,
    { headers }
  );

  if (!findRes.ok) {
    throw new Error(`Failed to fetch patients: ${findRes.status} ${await findRes.text()}`);
  }

  const patients = await findRes.json();
  const ids = patients.map((p) => p.id);

  if (ids.length === 0) {
    console.log(JSON.stringify({ ok: true, env: active, found: 0, deletedVisits: 0, deletedPatients: 0 }, null, 2));
    return;
  }

  const idFilter = `(${ids.join(",")})`;

  const delVisitsRes = await fetch(
    `${url}/rest/v1/visits?patient_id=in.${idFilter}`,
    {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=representation" },
    }
  );

  if (!delVisitsRes.ok) {
    throw new Error(`Failed to delete visits: ${delVisitsRes.status} ${await delVisitsRes.text()}`);
  }

  const deletedVisits = await delVisitsRes.json();

  const delPatientsRes = await fetch(
    `${url}/rest/v1/patients?id=in.${idFilter}`,
    {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=representation" },
    }
  );

  if (!delPatientsRes.ok) {
    throw new Error(`Failed to delete patients: ${delPatientsRes.status} ${await delPatientsRes.text()}`);
  }

  const deletedPatients = await delPatientsRes.json();

  console.log(
    JSON.stringify(
      {
        ok: true,
        env: active,
        found: patients.length,
        deletedVisits: deletedVisits.length,
        deletedPatients: deletedPatients.length,
        sampleNames: patients.slice(0, 10).map((p) => p.name),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("cleanup-stat-e2e failed:", error);
  process.exit(1);
});
