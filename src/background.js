// Background service worker.
// Its only job is to open Sid's side panel when the toolbar icon is clicked.
// With openPanelOnActionClick set, Chrome toggles the panel on its own — both
// for a toolbar click and for the _execute_action keyboard shortcut (Ctrl/Cmd+
// Shift+Y), so the same shortcut opens and closes the panel.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.action.setBadgeText({ text: '' }).catch(() => {}); // clear any old label
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId == null) return;
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Dev convenience: a shortcut (Ctrl/Cmd+Shift+U) reloads the extension, which
// re-reads the files from disk for an unpacked install — no trip to
// chrome://extensions to click Reload.
chrome.commands.onCommand.addListener((command) => {
  if (command === 'reload-extension') chrome.runtime.reload();
});
