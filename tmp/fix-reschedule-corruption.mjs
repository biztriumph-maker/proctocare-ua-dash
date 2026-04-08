/**
 * Recovery script: fixes a rescheduled visit where the visit_date was mutated in DB
 * instead of creating a new row.
 *
 * Scenario: Patient had completed visit on 07.04, it got rescheduled to 16.04 by
 * mutating visit_date in the same row. This script:
 *   1. Restores the original row to today's date with completed=true
 *   2. Creates a new planning row for the future date
 *
 * Usage: node tmp/fix-reschedule-corruption.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xwzbpmssbbpofbvwuqms.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MHUMQXgw7Kc2jSHMMDKKpw__VJ1fEgH';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Today in Kyiv / UTC+3
function getTodayKyiv() {
  const now = new Date();
  const kyiv = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
  const y = kyiv.getFullYear();
  const m = String(kyiv.getMonth() + 1).padStart(2, '0');
  const d = String(kyiv.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function run() {
  const today = getTodayKyiv();
  console.log('Today (Kyiv):', today);

  // ── Step 1: Find all future (date > today) uncompleted visits
  const { data: futureVisits, error: err0 } = await supabase
    .from('visits')
    .select('*, patients(id, name)')
    .gt('visit_date', today)
    .eq('completed', false);

  if (err0) { console.error('Query error:', err0); process.exit(1); }

  if (!futureVisits?.length) {
    console.log('✅ No future uncompleted visits found — nothing to fix.');
    process.exit(0);
  }

  console.log(`\nFound ${futureVisits.length} future uncompleted visit(s):`);
  for (const v of futureVisits) {
    console.log(`  id=${v.id}  name="${v.patients?.name}"  date=${v.visit_date}  time=${v.visit_time || '--'}  protocol="${v.protocol || ''}"`);
  }

  // ── Step 2: For each future visit, check if same patient had NO completed past visit.
  //   If so → this is a corrupted reschedule (the original date was lost).
  const toFix = [];
  for (const fv of futureVisits) {
    const { data: samePatientVisits } = await supabase
      .from('visits')
      .select('id, visit_date, completed, status')
      .eq('patient_id', fv.patient_id);

    const hasCompletedPast = (samePatientVisits || []).some(
      v => v.id !== fv.id && v.completed === true && v.visit_date < fv.visit_date
    );

    if (!hasCompletedPast) {
      toFix.push(fv);
    }
  }

  if (!toFix.length) {
    console.log('\n✅ All future visits already have completed past visits — no corruption detected.');
    process.exit(0);
  }

  console.log(`\nNeed to fix ${toFix.length} visit(s):`);
  for (const v of toFix) {
    console.log(`  → "${v.patients?.name}"  future_date=${v.visit_date}  time=${v.visit_time || '--'}`);
  }

  // ── Step 3: Fix each corrupted record
  for (const fv of toFix) {
    const futureDate = fv.visit_date;
    const futureTime = fv.visit_time;
    const procedure = fv.procedure || '';

    console.log(`\nFixing visit id=${fv.id} for "${fv.patients?.name}"...`);

    // 3a. Restore the existing row to today (the "real" visit date), mark as completed
    const { error: e1 } = await supabase
      .from('visits')
      .update({
        visit_date: today,
        completed: true,
        status: 'ready',
        // Keep protocol as-is (may be empty, can't recover lost text)
      })
      .eq('id', fv.id);

    if (e1) {
      console.error(`  ❌ Failed to update visit ${fv.id}:`, e1.message);
      continue;
    }
    console.log(`  ✅ Restored visit ${fv.id} → date=${today}, completed=true`);

    // 3b. Create a fresh planning row for the future date
    const newId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { error: e2 } = await supabase
      .from('visits')
      .insert({
        id: newId,
        patient_id: fv.patient_id,
        visit_date: futureDate,
        visit_time: futureTime || null,
        procedure,
        status: 'planning',
        completed: false,
        no_show: false,
        from_form: true,
      });

    if (e2) {
      console.error(`  ❌ Failed to create new visit row:`, e2.message);
      continue;
    }
    console.log(`  ✅ Created new planning visit ${newId} → date=${futureDate}, time=${futureTime || '--'}`);
  }

  console.log('\n🎉 Recovery complete! Refresh the app to see changes.');
}

run().catch(err => { console.error(err); process.exit(1); });
