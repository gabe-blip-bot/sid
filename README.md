# Sidebar Sid

Sidebar Sid is a lightweight browser context layer that lives in the Chrome side panel.

It exists to answer one question immediately: **what was I working on?**

It is not a task manager, not a notes app, and not an AI assistant.

## How it works

- Each Chrome window is attached to a project.
- The header is a single project combobox: click to see all projects, type to
  filter, Enter on a new name creates it, and a **Rename** row renames the
  current project. Renaming to a name that already exists is blocked with a hint
  rather than merging.
- **Notes** — multiline, belongs to the project.
- **Scratchpad** — multiline, shared across every window.
- **Workspace** — **Save Project** captures the current window's reopenable tabs
  (title + URL, in order) with a timestamp as the project's snapshot. **Open
  Project** reopens that snapshot in a window and attaches it to the project,
  focusing an existing project window if one is already open.
- **Removed Tabs** — when a save no longer contains a previously saved tab, it is
  archived here (by URL, deduped). **Restore** reopens it and clears it from the
  list. A tab that reappears in a later save leaves the archive automatically.
- Switching windows switches to that window's project automatically.
- Notes and scratchpad autosave to Chrome local storage with debounced writes;
  the save status sits in the footer. Saving a project writes immediately.
- **Export Markdown** downloads the project's notes, scratchpad, current live
  tabs, saved workspace, and removed tabs.

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
