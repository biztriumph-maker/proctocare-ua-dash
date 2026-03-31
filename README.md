# ProctoCare Dashboard

## Local run

Start frontend + shared sync backend together:

```bash
npm run dev:all
```

If you run commands from the parent folder, use:

```bash
npm --prefix proctocare-ua-dash run dev:all
```

## Supabase switching

The app is configured to work with real Supabase by default.

Use one selector to switch projects:

```bash
VITE_SUPABASE_ENV=test
```

Supported values:

```bash
VITE_SUPABASE_ENV=test
VITE_SUPABASE_ENV=prod
```

Required env vars:

```bash
VITE_DATA_MODE=supabase
VITE_SUPABASE_TEST_URL=
VITE_SUPABASE_TEST_ANON_KEY=
VITE_SUPABASE_PROD_URL=
VITE_SUPABASE_PROD_ANON_KEY=
```

The shared sync backend on port 8787 is still used for browser-to-browser localStorage sync features, but patient records should now come from Supabase.
