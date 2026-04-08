import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

const env = { ...parseEnvFile(".env.local"), ...process.env };
const active = (env.VITE_SUPABASE_ENV || "test").toLowerCase();
const url = active === "prod" ? env.VITE_SUPABASE_PROD_URL : env.VITE_SUPABASE_TEST_URL;
const key = active === "prod" ? env.VITE_SUPABASE_PROD_ANON_KEY : env.VITE_SUPABASE_TEST_ANON_KEY;

if (!url || !key) { console.log("Missing env vars"); process.exit(1); }
console.log("ENV:", active, "| URL:", url.slice(0, 40));

const sb = createClient(url, key);
const { data, error } = await sb.from("visits").select("id, protocol_history").limit(1);
if (error) {
  console.log("❌ COLUMN MISSING or error:", error.message);
  console.log("→ Run migration_add_protocol_history.sql in Supabase Dashboard");
} else {
  console.log("✅ protocol_history column EXISTS");
  console.log("   Sample:", JSON.stringify(data?.[0]?.protocol_history));
}
