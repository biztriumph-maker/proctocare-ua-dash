const baseUrl = process.env.SYNC_URL || 'http://127.0.0.1:8787';
const endpoint = `${baseUrl.replace(/\/$/, '')}/sync-api/health`;

try {
  const response = await fetch(endpoint, { method: 'GET' });
  if (!response.ok) {
    console.error(`Sync health check failed: HTTP ${response.status}`);
    process.exit(1);
  }

  const data = await response.json();
  if (!data || data.ok !== true) {
    console.error('Sync health check failed: malformed response payload.');
    process.exit(1);
  }

  console.log(`Sync is healthy at ${endpoint}`);
} catch (error) {
  console.error(`Sync health check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
