# Sidebar Sid

Sidebar Sid is a lightweight browser context layer that lives in the Chrome side panel.

It exists to answer one question immediately: **what was I working on?**

It is not a task manager, not a notes app, and not an AI assistant.

## How it works

- Each Chrome window is attached to a project. The Sid toolbar icon shows a short
  badge tag for the focused window's project (initials or first letters), with the
  full name in the icon's tooltip. (Chrome doesn't let extensions label the tab
  bar itself, so the badge is the closest always-visible indicator.)
- Top to bottom the panel is: the week strip, the scratchpad, then the project
  bar, window notes, and removed tabs.
- The header is a single project combobox: click to see all projects, type to
  filter, and Enter on a new name creates it. Typing a name that already exists
  switches to it (never merges). Header icons act on the current project:
  **save** (capture this window's tabs), **pencil** (rename in place), **add a
  window note**, and **archive**.
- **Notes** — a list of short window notes for the project. The **add-note icon**
  in the header creates a new note in the list, ready to type. Click any note to
  edit it in place. Each item has a **tick** that completes and removes it and a
  **copy** button. Below the list, **copy-all** and **complete-all** icons copy
  every note (one per line) or clear the list.
- **Week strip** — a quiet Mon–Thu reminder of each working day's theme, shown in
  two columns (Mon/Tue, Wed/Thu) to save height. Each day has an editable theme
  field; it's global (not per project) and autosaves. Drag a row by its grip to
  reorder the themes. Today's row is highlighted on Mon–Thu. Purely passive.
- **Scratchpad** — global freeform text, shared across every window. Starts as a
  single line, auto-grows as you type (up to ~40% of the panel, then scrolls),
  and has a drag grip to resize manually.
- **Save** (header icon) captures the current window's reopenable tabs
  (title + URL, in order) with a timestamp as the project's snapshot. Its status
  dot is green when the snapshot matches the window's current tabs and red when
  there are unsaved changes; hover the icon to see when it was last saved.
- **Removed Tabs** — when a save no longer contains a previously saved tab, it is
  archived here (by URL, deduped). **Restore** reopens it and clears it from the
  list. A tab that reappears in a later save leaves the archive automatically.
- **Archiving** a project hides it from the switcher and moves its window(s) to
  another active project; its notes and saved tabs are kept. (Restoring and
  deleting archived projects will live on a separate surface, not the side
  panel.)
- Switching windows switches to that window's project automatically.
- Notes and scratchpad autosave to Chrome local storage with debounced writes.
  Saving a project writes immediately.
- **Across a Chrome restart**, window IDs are reassigned, so Sid does not try to
  restore window↔project bindings. On startup it prunes bindings for windows
  that no longer exist, and each reopened window comes up **unbound** — prompting
  you to pick or create a project — rather than all landing on the same one. A
  fresh install with no projects still opens with one ready-to-use project.

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
