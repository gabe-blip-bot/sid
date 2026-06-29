# Sid

Sid is a lightweight browser context layer that lives in the Chrome side panel.

It exists to answer one question immediately: **what was I working on?**

It is not a task manager, not a notes app, and not an AI assistant.

## How it works

- Each Chrome window is attached to a project.
- The header has a project selector (autocomplete existing projects, or type a
  new name to create one), the window number, and the save status.
- **Current objective** — a single bold line.
- **Notes** — multiline, belongs to the project.
- **Scratchpad** — multiline, shared across every window.
- Switching windows switches to that window's project automatically.
- Everything autosaves to Chrome local storage with debounced writes.
- **Export Markdown** downloads the project, objective, notes, scratchpad, and
  every open tab (title and URL) for the current window.

All data stays in Chrome local storage. No accounts, no network requests.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.
5. Click the Sid toolbar icon to open the side panel.

After editing files, click **Reload** on the Sid card.

## Layout

```text
manifest.json     extension manifest (Manifest V3)
sidepanel.html    side panel markup
src/
  background.js   opens the side panel on toolbar click
  ui.js           DOM wiring, autosave, orchestration
  storage.js      chrome.storage.local wrapper
  projects.js     project/state data model
  export.js       Markdown export
  styles.css      side panel styling
icons/            toolbar icons
```
