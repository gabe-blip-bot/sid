# Sidebar Sid

Sidebar Sid is a lightweight browser context layer that lives in the Chrome side panel.

It exists to answer one question immediately: **what was I working on?**

It is not a task manager, not a notes app, and not an AI assistant.

## How it works

- Each Chrome window is attached to a project. The Sid toolbar icon shows a short
  badge tag for the focused window's project (initials or first letters), with the
  full name in the icon's tooltip. (Chrome doesn't let extensions label the tab
  bar itself, so the badge is the closest always-visible indicator.)
- Chrome's side-panel header shows the window's current project — `<project> — Sid`
  (project name first so it survives truncation), or plain `Sid` when the window is
  unbound. It updates as you switch, rename, or archive the project.
- The panel is two raised white tiles on a faint recessed background — separated
  by depth (soft shadow + a clean channel) rather than a divider line: the
  **per-project (window) card** on top (project bar, notes, removed tabs) and the
  **global (chrome) card** below (day theme, planner, distractions — shared across
  all windows).
- The header is a single project combobox: click to see all projects, type to
  filter, and Enter on a new name creates it. Typing a name that already exists
  switches to it (never merges). Header icons act on the current project:
  **save** (capture this window's tabs), **pencil** (rename in place), and
  **archive**.
- **Notes** — a frictionless inline list of short window notes for the project.
  An always-present empty row at the end is where you type: **Enter** commits the
  line as a note (**Shift+Enter** inserts a newline) and the row clears, ready for
  the next. Committed notes are plain text — **single-click** a note to copy it
  (with a brief confirmation), **double-click** to delete it. Below the list,
  **copy-all** and **complete-all** icons copy every note (one per line) or clear
  the list.
- **Day theme** — a button that cycles through the working days (Mon→Tue→Wed→Thu)
  with a theme field beside it. It's global (not per project) and autosaves; the
  button defaults to today and is highlighted when showing today. Purely passive.
- **Planner** — two global columns: a free-form **schedule** (left) and an
  auto-numbered **task** list (right). Type in a column's input and press Enter to
  add a tile; the next empty input is ready immediately (no number shown until a
  task actually exists, so only created tasks are numbered 1..N). Each task shows
  its **number** on the left; click it to complete the task — the number turns
  into a **tick** and the text strikes through (click again to undo). Click a
  tile's text to edit it in place, or **drag a tile to reorder** it within its
  column. Schedule tiles are plain (no number, no strike).
- **Distractions** — one global quick-capture box at the bottom of the panel.
  Click it, type a distraction, and press Enter; it's saved and the box clears
  (nothing expands). Once you've captured something, a **count + chevron** appears
  on the right of the box — click it to expand the captured list, click again to
  collapse. Each row is plain text: **single-click** copies it, **double-click**
  deletes it. The chevron hides when the list is empty, and distractions are
  shared across every window.
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
5. Click the Sid toolbar icon — or press the keyboard shortcut — to open the
   side panel.

After editing files, click **Reload** on the Sid card.

## Keyboard shortcut

Press **Ctrl+Shift+. (period)** (**Cmd+Shift+.** on macOS) to toggle the side
panel open and closed — the same as clicking the toolbar icon. If another
extension already claimed that combo, Chrome leaves Sid's unset — pick your own
at `chrome://extensions/shortcuts`.

While developing, **Ctrl+Shift+U** (**Cmd+Shift+U** on macOS) reloads the
extension — it re-reads the files from disk, so you don't have to click **Reload**
on the Sid card after editing.

Rebind or clear either shortcut at `chrome://extensions/shortcuts` if it clashes
with another extension.

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
