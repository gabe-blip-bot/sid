chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-window-next') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
});
