// Діагностичний скрипт: перевіряє Storage bucket і права на завантаження
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xwzbpmssbbpofbvwuqms.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_MHUMQXgw7Kc2jSHMMDKKpw__VJ1fEgH';
const BUCKET = 'patient-files';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function run() {
  console.log('=== STORAGE DIAGNOSTICS ===');
  console.log('URL:', SUPABASE_URL);
  console.log('Key (first 30):', SUPABASE_ANON_KEY.slice(0, 30) + '...');
  console.log('Bucket:', BUCKET);
  console.log('');

  // 1. Перевірити список бакетів
  console.log('--- Step 1: list buckets ---');
  const { data: buckets, error: bucketsErr } = await supabase.storage.listBuckets();
  if (bucketsErr) {
    console.error('❌ listBuckets error:', bucketsErr);
  } else {
    console.log('✓ Buckets found:', buckets.map(b => `${b.name} (public=${b.public})`));
    const target = buckets.find(b => b.name === BUCKET);
    if (!target) {
      console.error(`❌ Bucket "${BUCKET}" NOT FOUND — це і є причина помилки!`);
      console.error('   Треба створити bucket із назвою "patient-files" у Supabase dashboard.');
    } else {
      console.log(`✓ Bucket "${BUCKET}" EXISTS, public=${target.public}`);
    }
  }
  console.log('');

  // 2. Спробувати завантажити мінімальний тестовий файл
  console.log('--- Step 2: test upload (1px PNG) ---');
  // 1x1 прозорий PNG у Base64
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const pngBuffer = Buffer.from(pngBase64, 'base64');
  const testPath = `test-visit-id/diag-test-${Date.now()}.png`;

  const { data: uploadData, error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(testPath, pngBuffer, { upsert: true, contentType: 'image/png' });

  if (uploadErr) {
    console.error('❌ Upload FAILED:');
    console.error('   message:', uploadErr.message);
    console.error('   statusCode:', uploadErr.statusCode ?? 'n/a');
    console.error('   full error:', JSON.stringify(uploadErr, null, 2));
  } else {
    console.log('✓ Upload OK! path:', uploadData.path);

    // 3. Отримати публічний URL
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path);
    console.log('✓ Public URL:', urlData.publicUrl);

    // 4. Видалити тестовий файл
    await supabase.storage.from(BUCKET).remove([testPath]);
    console.log('✓ Test file deleted');
  }

  console.log('');
  console.log('=== DONE ===');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
