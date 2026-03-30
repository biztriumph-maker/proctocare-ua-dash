type SyncedEntry = {
  value: string;
  updatedAt: number;
};

type Snapshot = Record<string, SyncedEntry>;

const SYNCED_KEYS = [
  "proctocare_all_patients",
  "proctocare_assistant_chat",
  "proctocare_temp_chat_logs",
  "proctocare_doctor_profile",
  "proctocare_welcome_sent",
] as const;

const REMOTE_SYNC_EVENT = "proctocare-remote-storage-updated";
const POLL_INTERVAL_MS = 4000;

let initialized = false;
let applyingRemote = false;
let pollTimer: number | null = null;

const storagePrototype = typeof window !== "undefined" ? Storage.prototype : undefined;
const originalSetItem = storagePrototype?.setItem;
const originalRemoveItem = storagePrototype?.removeItem;

function isTrackedKey(key: string): boolean {
  return (SYNCED_KEYS as readonly string[]).includes(key);
}

function getApiUrl(path: string): string {
  const base = (import.meta.env.VITE_SYNC_API_BASE as string | undefined)?.replace(/\/$/, "") || "";
  return `${base}${path}`;
}

async function fetchSnapshot(): Promise<Snapshot> {
  const response = await fetch(getApiUrl("/sync-api/state"), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Sync fetch failed: ${response.status}`);
  }
  const data = await response.json() as { entries?: Snapshot };
  return data.entries || {};
}

async function pushEntry(key: string, value: string | null): Promise<void> {
  await fetch(getApiUrl("/sync-api/state"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
}

async function pushBulk(entries: Record<string, string>): Promise<void> {
  await fetch(getApiUrl("/sync-api/state/bulk"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
}

function dispatchRemoteUpdate(changedKeys: string[]) {
  if (changedKeys.length === 0) return;
  window.dispatchEvent(new CustomEvent(REMOTE_SYNC_EVENT, { detail: { changedKeys } }));
}

function collectLocalEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const key of SYNCED_KEYS) {
    const value = localStorage.getItem(key);
    if (value != null) entries[key] = value;
  }
  return entries;
}

function applyRemoteSnapshot(snapshot: Snapshot): string[] {
  if (!originalSetItem || !originalRemoveItem) return [];

  applyingRemote = true;
  const changedKeys: string[] = [];

  try {
    for (const key of SYNCED_KEYS) {
      const remote = snapshot[key];
      const local = localStorage.getItem(key);

      if (!remote) {
        continue;
      }

      if (local !== remote.value) {
        originalSetItem.call(localStorage, key, remote.value);
        changedKeys.push(key);
      }
    }
  } finally {
    applyingRemote = false;
  }

  return changedKeys;
}

async function synchronizeOnce(): Promise<void> {
  try {
    const snapshot = await fetchSnapshot();
    const remoteKeys = Object.keys(snapshot);
    const localEntries = collectLocalEntries();

    if (remoteKeys.length === 0 && Object.keys(localEntries).length > 0) {
      await pushBulk(localEntries);
      return;
    }

    const changedKeys = applyRemoteSnapshot(snapshot);
    dispatchRemoteUpdate(changedKeys);
  } catch {
    // Keep app functional when sync backend is unavailable.
  }
}

function installStorageMirroring() {
  if (!storagePrototype || !originalSetItem || !originalRemoveItem) return;

  storagePrototype.setItem = function patchedSetItem(key: string, value: string) {
    originalSetItem.call(this, key, value);
    if (!applyingRemote && isTrackedKey(key)) {
      void pushEntry(key, value);
    }
  };

  storagePrototype.removeItem = function patchedRemoveItem(key: string) {
    originalRemoveItem.call(this, key);
    if (!applyingRemote && isTrackedKey(key)) {
      void pushEntry(key, null);
    }
  };
}

function startPolling() {
  if (pollTimer != null) return;
  pollTimer = window.setInterval(() => {
    void synchronizeOnce();
  }, POLL_INTERVAL_MS);

  window.addEventListener("focus", () => {
    void synchronizeOnce();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void synchronizeOnce();
    }
  });
}

export async function bootstrapSharedStateSync(): Promise<void> {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;
  installStorageMirroring();
  await synchronizeOnce();
  startPolling();
}

export { REMOTE_SYNC_EVENT };