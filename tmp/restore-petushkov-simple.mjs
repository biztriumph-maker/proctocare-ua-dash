import { readFileSync } from 'node:fs';

function parseEnvFile(f) {
  try {
    const raw = readFileSync(f, 'utf8');
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
    return out;
  } catch { return {}; }
}

const env = {
  ...parseEnvFile('.env'),
  ...parseEnvFile('proctocare-ua-dash/.env'),
  ...parseEnvFile('.env.local'),
  ...parseEnvFile('proctocare-ua-dash/.env.local'),
  ...process.env,
};

const active = (env.VITE_SUPABASE_ENV || 'test').toLowerCase();
const isProd = active === 'prod';
const url = isProd ? env.VITE_SUPABASE_PROD_URL : env.VITE_SUPABASE_TEST_URL;
const key = isProd ? env.VITE_SUPABASE_PROD_ANON_KEY : env.VITE_SUPABASE_TEST_ANON_KEY;

console.log(`\n=== Supabase: ${active.toUpperCase()} ===`);

const VISIT_ID = 'f9f845a3-ae61-4729-b76c-df25a7e076a7';

// Спочатку перевіримо поточний стан
const check = await fetch(`${url}/rest/v1/visits?id=eq.${VISIT_ID}&select=id,visit_date,visit_time,status,completed,no_show,protocol,protocol_history`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
const current = await check.json();
console.log('\nПоточний стан:');
console.log(JSON.stringify(current[0], null, 2));

// Відновлюємо до незакритого стану
const patchRes = await fetch(`${url}/rest/v1/visits?id=eq.${VISIT_ID}`, {
  method: 'PATCH',
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify({
    status: 'progress',
    completed: false,
    no_show: false,
    protocol: '',
  }),
});

const result = await patchRes.json();
const r = result[0];

if (r) {
  console.log('\n✅ ВІДНОВЛЕНО:');
  console.log(`  visit_date: ${r.visit_date}`);
  console.log(`  visit_time: ${r.visit_time}`);
  console.log(`  status: ${r.status}`);
  console.log(`  completed: ${r.completed}`);
  console.log(`  no_show: ${r.no_show}`);
  console.log('\n🟠 Петушков 10.04.2026 тепер незакритий — оранжевий блок буде показано');
} else {
  console.log('⚠️  Відповідь порожня:', result);
}
