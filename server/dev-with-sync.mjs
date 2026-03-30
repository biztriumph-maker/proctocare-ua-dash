import { spawn } from 'node:child_process';

const processes = [];
let shuttingDown = false;

async function isSyncHealthy() {
  try {
    const response = await fetch('http://127.0.0.1:8787/sync-api/health');
    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

function log(prefix, data) {
  const text = String(data).trimEnd();
  if (!text) {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    console.log(`[${prefix}] ${line}`);
  }
}

function start(name, command, args) {
  const isWindows = process.platform === 'win32';
  const child = isWindows
    ? spawn('cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      })
    : spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

  child.stdout.on('data', (chunk) => log(name, chunk));
  child.stderr.on('data', (chunk) => log(name, chunk));

  child.on('exit', async (code) => {
    if (shuttingDown) {
      return;
    }

    if (name === 'sync' && (code ?? 1) !== 0) {
      const healthy = await isSyncHealthy();
      if (healthy) {
        console.log('[runner] Sync backend is already running, reusing existing instance.');
        return;
      }
    }

    shuttingDown = true;
    console.error(`[${name}] exited with code ${code ?? 'unknown'}. Stopping all processes.`);
    stopAll(code ?? 1);
  });

  processes.push(child);
}

function stopAll(exitCode = 0) {
  for (const child of processes) {
    if (!child.killed) {
      child.kill('SIGINT');
    }
  }

  setTimeout(() => process.exit(exitCode), 150);
}

process.on('SIGINT', () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  stopAll(0);
});

process.on('SIGTERM', () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  stopAll(0);
});

console.log('[runner] Starting sync server and Vite dev server...');
const npmCommand = 'npm';
const syncAlreadyRunning = await isSyncHealthy();
if (syncAlreadyRunning) {
  console.log('[runner] Sync backend already healthy on :8787, skipping second sync process.');
} else {
  start('sync', npmCommand, ['run', 'sync-server']);
}
start('vite', npmCommand, ['run', 'dev']);
