// storage.js
// Thin wrapper over chrome.storage.local. Sid keeps its whole state under a
// single key so reads and writes are atomic and easy to reason about.

const KEY = 'sid.v1';

// Read the persisted state, or null if nothing has been saved yet.
export async function load() {
  const data = await chrome.storage.local.get(KEY);
  return data[KEY] || null;
}

// Persist the full state object.
export async function save(state) {
  await chrome.storage.local.set({ [KEY]: state });
}

// Notify when another window's panel changes the shared state.
export function onChange(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY] && changes[KEY].newValue) {
      callback(changes[KEY].newValue);
    }
  });
}
