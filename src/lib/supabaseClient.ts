import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xwzbpmssbbpofbvwuqms.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MHUMQXgw7Kc2jSHMMDKKpw__VJ1fEgH';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
