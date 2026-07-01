// Background service worker.
// With openPanelOnActionClick set, Chrome opens/closes Sid's side panel on its
// own — both for a toolbar click and for the _execute_action keyboard shortcut
// (Ctrl/Cmd+Shift+Period by default) — so this file doesn't need to handle
// clicks itself. It tracks which windows' panels are open (for the toolbar
// badge), maintains the "paste from project notes" right-click menu, and
// reloads the extension on its dev shortcut.

import * as storage from './storage.js';
import * as projects from './projects.js';

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
  initFocusedWindow();
});
chrome.runtime.onStartup.addListener(() => {
  markAllWindowsUnopened();
  initFocusedWindow();
});
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

// --- "Paste from project notes" right-click menu ---------------------------
// A submenu on editable fields listing the focused window's project's notes;
// picking one inserts that note's text at the cursor of whatever's focused on
// the right-clicked page. Context menus have no "about to open" hook, so we
// rebuild it whenever the focused window changes (tracked via
// windows.onFocusChanged) or that project's notes change.
const MENU_ROOT = 'sid-paste-note';
let focusedWindowId = null;
let menuNotes = []; // the notes currently listed, indexed to match menu ids

async function initFocusedWindow() {
  try {
    const win = await chrome.windows.getLastFocused();
    focusedWindowId = win && win.id != null ? win.id : null;
  } catch {
    focusedWindowId = null;
  }
  rebuildContextMenu().catch(() => {});
}

async function rebuildContextMenu() {
  const state = projects.normaliseState(await storage.load());
  const project = focusedWindowId != null ? projects.windowProject(state, String(focusedWindowId)) : null;
  menuNotes = project ? projects.getProject(state, project).notes || [] : [];

  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ROOT,
    title: project ? `Paste from "${project}" notes` : 'Paste from project notes',
    contexts: ['editable']
  });
  if (!menuNotes.length) {
    chrome.contextMenus.create({
      id: `${MENU_ROOT}-empty`,
      parentId: MENU_ROOT,
      title: project ? 'No notes yet' : 'No project for this window',
      enabled: false,
      contexts: ['editable']
    });
  } else {
    menuNotes.forEach((text, i) => {
      chrome.contextMenus.create({
        id: `${MENU_ROOT}-${i}`,
        parentId: MENU_ROOT,
        title: text.length > 60 ? `${text.slice(0, 57)}...` : text,
        contexts: ['editable']
      });
    });
  }
}

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // focus left Chrome; keep the last window
  focusedWindowId = windowId;
  rebuildContextMenu().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['sid.v1']) rebuildContextMenu().catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (!id.startsWith(`${MENU_ROOT}-`)) return;
  const index = Number(id.slice(MENU_ROOT.length + 1));
  const text = menuNotes[index];
  if (Number.isNaN(index) || text == null || !tab || tab.id == null) return;
  chrome.scripting
    .executeScript({ target: { tabId: tab.id }, func: insertAtCursor, args: [text] })
    .catch((error) => console.error('Paste note failed', error));
});

// Runs inside the right-clicked page (not the extension): insert text at the
// focused element's cursor, for plain inputs/textareas and contenteditable.
function insertAtCursor(text) {
  const el = document.activeElement;
  if (!el) return;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (el.isContentEditable) {
    document.execCommand('insertText', false, text);
  }
}

// Dev convenience: a shortcut (Ctrl/Cmd+Shift+U) reloads the extension, which
// re-reads the files from disk for an unpacked install — no trip to
// chrome://extensions to click Reload.
chrome.commands.onCommand.addListener((command) => {
  if (command === 'reload-extension') chrome.runtime.reload();
});
