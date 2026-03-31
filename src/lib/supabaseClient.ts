import { createClient } from '@supabase/supabase-js';

const SUPABASE_ENV = ((import.meta.env.VITE_SUPABASE_ENV as string | undefined) || 'test').toLowerCase();

function getSupabaseConfig() {
	if (SUPABASE_ENV === 'prod') {
		return {
			url: import.meta.env.VITE_SUPABASE_PROD_URL as string | undefined,
			key: import.meta.env.VITE_SUPABASE_PROD_ANON_KEY as string | undefined,
		};
	}

	return {
		url: import.meta.env.VITE_SUPABASE_TEST_URL as string | undefined,
		key: import.meta.env.VITE_SUPABASE_TEST_ANON_KEY as string | undefined,
	};
}

const { url: SUPABASE_URL, key: SUPABASE_KEY } = getSupabaseConfig();

if (!SUPABASE_URL || !SUPABASE_KEY) {
	throw new Error(`Missing Supabase config for environment: ${SUPABASE_ENV}`);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
export const supabaseEnvironment = SUPABASE_ENV;
