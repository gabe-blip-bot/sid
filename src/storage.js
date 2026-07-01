// storage.js
// Thin wrapper over chrome.storage.local. Sid keeps its whole state under a
// single key so reads and writes are atomic and easy to reason about.

const KEY = 'sid.v1';
const BACKUP_KEY = 'sid.v1.backups';
const BACKUP_DAYS = 7; // how many daily snapshots to keep

// Read the persisted state, or null if nothing has been saved yet.
export async function load() {
  const data = await chrome.storage.local.get(KEY);
  return data[KEY] || null;
}

// Persist the full state object, and best-effort refresh today's backup
// snapshot alongside it (never blocks or throws on the caller).
export async function save(state) {
  await chrome.storage.local.set({ [KEY]: state });
  maybeBackup(state).catch(() => {});
}

// Notify when another window's panel changes the shared state.
export function onChange(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY] && changes[KEY].newValue) {
      callback(changes[KEY].newValue);
    }
  });
}

// --- Backups -----------------------------------------------------------
// A lightweight safety net, independent of the undo stack (which is
// in-memory only and resets on reload): keep one automatic snapshot per
// calendar day, so a bad write, an unexpected clear, or a mistaken action
// has a recent fallback to restore from. Kept under a separate storage key
// so a restore never touches the backup history itself.

async function maybeBackup(state) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const data = await chrome.storage.local.get(BACKUP_KEY);
  const backups = data[BACKUP_KEY] || {};
  if (backups[today]) return; // already have a snapshot for today
  backups[today] = state;
  const days = Object.keys(backups).sort().slice(-BACKUP_DAYS);
  const trimmed = {};
  for (const d of days) trimmed[d] = backups[d];
  await chrome.storage.local.set({ [BACKUP_KEY]: trimmed });
}

// Available backup dates, most recent first.
export async function listBackups() {
  const data = await chrome.storage.local.get(BACKUP_KEY);
  return Object.keys(data[BACKUP_KEY] || {}).sort().reverse();
}

// Restore a dated backup as the live state; propagates to every open window
// via the normal onChange path. Returns false if that date isn't available.
export async function restoreBackup(date) {
  const data = await chrome.storage.local.get(BACKUP_KEY);
  const snapshot = (data[BACKUP_KEY] || {})[date];
  if (!snapshot) return false;
  await save(snapshot);
  return true;
}
