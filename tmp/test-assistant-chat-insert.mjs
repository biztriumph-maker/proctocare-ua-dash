/**
 * Diagnostic: insert a test row into assistant_chats and read it back.
 * Usage: node tmp/test-assistant-chat-insert.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const m = line.match(/^([^#\s][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch { /* .env.local optional */ }

const SUPABASE_URL = process.env.VITE_SUPABASE_TEST_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_TEST_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing VITE_SUPABASE_TEST_URL / VITE_SUPABASE_TEST_ANON_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log('=== assistant_chats INSERT TEST ===\n');

  // 1. Get a real visit_id (UUID format, not "new-" temp IDs) from the DB
  const { data: visits, error: ve } = await supabase
    .from('visits')
    .select('id')
    .not('id', 'ilike', 'new-%')
    .limit(5);

  if (ve || !visits?.length) {
    console.error('❌ Cannot fetch visits:', ve?.message ?? 'empty result');
    process.exit(1);
  }
  const visitId = visits[0].id;
  console.log('✓ Using visit_id:', visitId);

  // 2. Check assistant_chats columns (try SELECT *)
  const { data: existing, error: se } = await supabase
    .from('assistant_chats')
    .select('*')
    .eq('visit_id', visitId)
    .limit(3);

  if (se) {
    console.error('❌ SELECT from assistant_chats failed:', se.message);
    console.error('   code:', se.code);
    console.error('   hint:', se.hint ?? 'none');
    process.exit(1);
  }
  console.log(`✓ SELECT OK — existing rows for this visit: ${existing?.length ?? 0}`);
  if (existing?.length) {
    console.log('  Columns present:', Object.keys(existing[0]).join(', '));
  }

  // 3. Insert a test message
  const testId = `test-${Date.now()}`;
  const { error: ie } = await supabase
    .from('assistant_chats')
    .insert({
      id: testId,
      visit_id: visitId,
      sender: 'ai',
      text: '[DIAGNOSTIC TEST] — safe to delete',
      time: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      step: 'diagnostic',
      created_at: new Date().toISOString(),
    });

  if (ie) {
    console.error('❌ INSERT failed:', ie.message);
    console.error('   code:', ie.code);
    console.error('   details:', ie.details ?? 'none');
    console.error('   hint:', ie.hint ?? 'none');
    process.exit(1);
  }
  console.log('✓ INSERT OK — id:', testId);

  // 4. Read back
  const { data: readBack, error: re } = await supabase
    .from('assistant_chats')
    .select('*')
    .eq('id', testId)
    .single();

  if (re || !readBack) {
    console.error('❌ Read-back failed:', re?.message);
    process.exit(1);
  }
  console.log('✓ Read-back OK:');
  console.log('  id:', readBack.id);
  console.log('  visit_id:', readBack.visit_id);
  console.log('  sender:', readBack.sender);
  console.log('  text:', readBack.text);
  console.log('  created_at:', readBack.created_at);

  // 5. Cleanup
  await supabase.from('assistant_chats').delete().eq('id', testId);
  console.log('✓ Cleanup done (test row deleted)');

  console.log('\n🎉 assistant_chats is fully operational!\n');
  console.log('Columns confirmed: id, visit_id, sender, text, time, step, created_at');
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
