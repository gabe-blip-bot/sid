// Background service worker.
// With openPanelOnActionClick set, Chrome opens/closes Sid's side panel on its
// own — both for a toolbar click and for the _execute_action keyboard shortcut
// (Ctrl/Cmd+Shift+Period by default) — so this file doesn't need to handle
// clicks itself. It tracks which windows' panels are open (for the toolbar
// badge) and reloads the extension on its dev shortcut.

// Orange dot on the toolbar icon for any window whose side panel isn't open.
// The panel (ui.js) holds a port open for as long as it's visible; a live port
// means "open" (clear the dot), a disconnect means "closed" (show the dot).
//
// The action badge API is per-TAB, not per-window (there's no windowId option),
// so we apply it to each window's active tab and re-apply whenever the active
// tab changes (a freshly-activated tab has no badge of its own yet).
const DOT_COLOR = '#e8825a';
const openPanels = new Set(); // window IDs with a connected side-panel port

async function updateBadge(windowId) {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, windowId });
  } catch {
    return; // window may already be gone
  }
  if (!tab) return;
  const open = openPanels.has(windowId);
  chrome.action.setBadgeText({ text: open ? '' : '●', tabId: tab.id }).catch(() => {});
  if (!open) {
    chrome.action.setBadgeBackgroundColor({ color: DOT_COLOR, tabId: tab.id }).catch(() => {});
  }
}

async function markAllWindowsUnopened() {
  const wins = await chrome.windows.getAll();
  for (const win of wins) updateBadge(win.id);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  markAllWindowsUnopened();
});
chrome.runtime.onStartup.addListener(markAllWindowsUnopened);
chrome.windows.onCreated.addListener((win) => updateBadge(win.id));
// Keep the badge correct as tabs are switched to or created within a window.
chrome.tabs.onActivated.addListener(({ windowId }) => updateBadge(windowId));
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.windowId != null) updateBadge(tab.windowId);
});

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('sidepanel:')) return;
  const windowId = Number(port.name.slice('sidepanel:'.length));
  openPanels.add(windowId);
  updateBadge(windowId);
  port.onDisconnect.addListener(() => {
    openPanels.delete(windowId);
    updateBadge(windowId);
  });
});

// Dev convenience: a shortcut (Ctrl/Cmd+Shift+U) reloads the extension, which
// re-reads the files from disk for an unpacked install — no trip to
// chrome://extensions to click Reload.
chrome.commands.onCommand.addListener((command) => {
  if (command === 'reload-extension') chrome.runtime.reload();
});
