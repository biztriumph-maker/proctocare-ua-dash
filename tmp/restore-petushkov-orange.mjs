/**
 * RESTORE: Повернути візит Петушкова 10.04.2026 в стан "Незакритий" (оранжевий)
 * 1. Знайти всі візити Петушкова
 * 2. Скинути completed/no_show на false, status → 'progress'
 * 3. Очистити пусті protocol_history записи за 10.04
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
  ...parseEnvFile(".env"),
  ...parseEnvFile("proctocare-ua-dash/.env"),
  ...parseEnvFile(".env.local"),
  ...parseEnvFile("proctocare-ua-dash/.env.local"),
  ...process.env,
};
const active = (env.VITE_SUPABASE_ENV || "test").toLowerCase();
const isProd = active === "prod";
const url = isProd ? env.VITE_SUPABASE_PROD_URL : env.VITE_SUPABASE_TEST_URL;
const key = isProd ? env.VITE_SUPABASE_PROD_ANON_KEY : env.VITE_SUPABASE_TEST_ANON_KEY;

console.log(`\n=== RESTORE Petushkov — Supabase: ${active.toUpperCase()} ===\n`);

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

// 1. Знайти пацієнта Петушкова в таблиці patients
const patients = await api(`/patients?or=(full_name.ilike.*Петушков*,name.ilike.*Петушков*)&select=id,full_name,name`);
console.log(`Знайдено пацієнтів: ${patients.length}`);
for (const p of patients) console.log("  →", p.id, p.full_name || p.name);

if (patients.length === 0) {
  console.log("❌ Пацієнта не знайдено в таблиці patients. Шукаємо в visits за name...");
}

// Зібрати patient_id-и
const patientIds = patients.map(p => p.id);

// 2. Знайти всі візити Петушкова (по patient_id або по name у visits)
let visits = [];
if (patientIds.length > 0) {
  const idFilter = patientIds.map(id => `patient_id.eq.${id}`).join(",");
  visits = await api(`/visits?or=(${idFilter})&select=id,visit_date,visit_time,status,completed,no_show,protocol,protocol_history&order=visit_date.desc`);
} else {
  // Деякі візити можуть мати ім'я прямо в колонці (legacy)
  visits = await api(`/visits?select=id,visit_date,visit_time,status,completed,no_show,protocol,protocol_history&order=visit_date.desc`);
  visits = visits.filter(v => {
    const phStr = JSON.stringify(v.protocol_history || "").toLowerCase();
    return phStr.includes("петушков") || (v.protocol || "").toLowerCase().includes("петушков");
  });
}

console.log(`\nВізити Петушкова (${visits.length}):`);
for (const v of visits) {
  const ph = Array.isArray(v.protocol_history) ? v.protocol_history.length : 0;
  console.log(`  ${v.visit_date} ${v.visit_time || '--:--'} | status=${v.status} | completed=${v.completed} | no_show=${v.no_show} | protocol="${(v.protocol||'').slice(0,50)}" | ph_entries=${ph}`);
}

// 3. Знайти цільовий візит 10.04.2026
const target = visits.find(v => v.visit_date === "2026-04-10");
if (!target) {
  console.log("\n❌ Візит 10.04.2026 НЕ знайдено. Можливо, він взагалі не в БД.");
  console.log("Перевіряємо всі візити квітня 2026...");
  const april = await api(`/visits?visit_date=gte.2026-04-01&visit_date=lte.2026-04-30&select=id,visit_date,visit_time,status,completed,no_show,patient_id&order=visit_date.asc`);
  for (const v of april) {
    console.log(`  ${v.visit_date} ${v.visit_time||'--'} | id=${v.id} | patient_id=${v.patient_id} | status=${v.status} | completed=${v.completed}`);
  }
  process.exit(0);
}

console.log(`\n✅ Цільовий візит знайдено: id=${target.id}`);
console.log(`   Поточний стан: status=${target.status}, completed=${target.completed}, no_show=${target.no_show}`);

// 4. Перевірити protocol_history — видалити пусті записи за 10.04
let cleanedHistory = target.protocol_history;
if (Array.isArray(cleanedHistory)) {
  const before = cleanedHistory.length;
  cleanedHistory = cleanedHistory.filter(entry => {
    // Видаляємо пустий або фантомний запис за 10.04 без реального тексту протоколу
    const isEmpty = !entry.value || entry.value.trim() === "" || entry.value.trim() === "🚫 Прийом аннульовано (неявка пацієнта)";
    const isToday = entry.date === "2026-04-10" || entry.timestamp === "10.04.2026";
    return !(isEmpty && isToday);
  });
  if (cleanedHistory.length !== before) {
    console.log(`\n🗑️  Видалено ${before - cleanedHistory.length} пустих записів з protocol_history`);
  } else {
    console.log(`\n✔️  protocol_history чистий (${before} записів), нічого видаляти не треба`);
  }
}

// 5. Відновити стан візиту: status='progress', completed=false, no_show=false
const updatePayload = {
  status: "progress",
  completed: false,
  no_show: false,
  protocol_history: cleanedHistory,
};

// Якщо protocol починається з аннуляційного маркера — очистити
if ((target.protocol || "").startsWith("🚫 Прийом аннульовано")) {
  // Видалити маркер, залишити тільки оригінальний текст (якщо був)
  const cleaned = target.protocol.replace(/^🚫 Прийом аннульовано \(неявка пацієнта\)\n\n/, "").trim();
  updatePayload.protocol = cleaned;
  console.log(`\n🔧 Очищено protocol від маркера неявки. Залишок: "${cleaned.slice(0, 60)}"`);
}

const result = await api(`/visits?id=eq.${target.id}`, {
  method: "PATCH",
  prefer: "return=representation",
  body: JSON.stringify(updatePayload),
});

if (result.length > 0) {
  const r = result[0];
  console.log(`\n✅ ВІДНОВЛЕНО:`);
  console.log(`   status=${r.status} | completed=${r.completed} | no_show=${r.no_show}`);
  console.log(`   visit_date=${r.visit_date} | visit_time=${r.visit_time}`);
  console.log(`\n🟠 Петушков ${r.visit_date} тепер у стані "Незакритий" — оранжевий блок буде показано`);
} else {
  console.log("⚠️  Відповідь порожня, перевірте вручну");
}

console.log("\nДон.");
