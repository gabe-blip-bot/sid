// Background service worker.
// Opens Sid's side panel on toolbar click, and keeps a short project tag on the
// toolbar icon's badge (full name in the tooltip) for the focused window.

const KEY = 'sid.v1';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  refreshBadge();
});

chrome.runtime.onStartup.addListener(refreshBadge);

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId == null) return;
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// The badge shows the focused window's project; update it as focus or state
// changes. setBadge* without a tabId applies to whatever window is focused.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) setBadgeForWindow(windowId);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[KEY]) refreshBadge();
});

async function refreshBadge() {
  try {
    const win = await chrome.windows.getLastFocused();
    await setBadgeForWindow(win.id);
  } catch (error) {
    // No focused window yet; ignore.
  }
}

async function setBadgeForWindow(windowId) {
  if (windowId == null || windowId < 0) return;
  const data = await chrome.storage.local.get(KEY);
  const state = data[KEY] || {};
  const name = (state.windows && state.windows[String(windowId)]) || '';
  await chrome.action.setBadgeText({ text: shortTag(name) });
  await chrome.action.setBadgeBackgroundColor({ color: '#0b57d0' });
  await chrome.action.setTitle({ title: name ? `Sidebar Sid — ${name}` : 'Open Sidebar Sid' });
}

// A compact badge tag: initials of up to three words, else the first 4 letters.
function shortTag(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const tag =
    words.length > 1 ? words.slice(0, 3).map((w) => w[0]).join('') : words[0].slice(0, 4);
  return tag.toUpperCase();
}
