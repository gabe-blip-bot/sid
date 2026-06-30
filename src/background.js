// Background service worker.
// Its only job is to open Sid's side panel when the toolbar icon is clicked.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.action.setBadgeText({ text: '' }).catch(() => {}); // clear any old label
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId == null) return;
  chrome.sidePanel.open({ windowId: tab.windowId });
});
