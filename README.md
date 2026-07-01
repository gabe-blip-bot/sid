# Sidebar Sid

Sidebar Sid is a lightweight browser context layer that lives in the Chrome side panel.

It exists to answer one question immediately: **what was I working on?**

It is not a task manager, not a notes app, and not an AI assistant.

## How it works

- Each Chrome window is attached to a project. The Sid toolbar icon shows an
  **orange dot** for any window whose side panel isn't currently open, so you can
  tell at a glance which windows have Sid open; it clears the moment you open the
  panel in that window.
- Chrome's side-panel header shows the window's current project — `<project> — Sid`
  (project name first so it survives truncation), or plain `Sid` when the window is
  unbound. It updates as you switch projects, and if the project is renamed or
  archived from the new tab page.
- The panel has two sections: the **per-project (window) section** on top (project
  bar, notes, then removed tabs pinned at its foot) and the **global (chrome)
  section** below (planner, distractions — shared across all windows), set off by a
  light dividing line.
- The header is a single project **combobox** (a small chevron marks it as a
  dropdown): click to see all projects, type to filter, and Enter on a new name
  creates it. Typing a name that already exists switches to it (never merges).
  That's all the sidebar does with projects — **renaming and archiving live on
  the new tab page** instead. Header icons: **undo** (revert the last content
  change) and **copy-all** / **clear-all** notes.
  The whole panel is styled like a plain written document — no tiles, boxes, or
  list buttons; you type straight onto lines.
- **Notes** — a raw notepad that behaves like a small text editor. The bottom line
  is always an empty line you write on: **Enter** commits it (**Shift+Enter**
  inserts a newline); **Backspace** at the very start of the write-line pulls the
  previous line back in to edit it. Committed lines are plain text; **hover** a line
  to reveal **copy** and **clear** buttons for it. The header's **copy-all** and
  **clear-all** icons copy every note (one per line) or empty the list. Empty
  inputs hint with `Notes…`, `Schedule…`, `Task…`, `Distractions…`, hidden once the
  list has entries.
- **Planner** — two global columns: a plain-text **schedule** (left, no bullets)
  and a numbered **task** list (right), with today's **day and date** above the
  schedule. Type on a column's bottom line and press Enter to add an entry. On
  both lists, **single-click a line to edit** it in place (Enter commits, Esc
  cancels, empty removes it), **double-click to delete** it, and **drag to
  reorder** within its own column (task numbers renumber automatically).
- A link at the **top-right of the global section** opens the full-page
  ([new tab](#new-tab-page)) view of these global surfaces.
- **Distractions** — one global quick-capture box at the bottom of the panel.
  Click it, type a distraction, and press Enter; it's saved and the box clears —
  that's the whole interaction in the panel (no in-panel review; distractions are
  shared across every window). Open the **new tab page** to see and manage the
  full captured list.
- **Everything autosaves.** Notes, schedule, tasks, distractions, and the project
  name persist as you type, and the window's reopenable tabs (title + URL, in
  order) are **snapshotted automatically** whenever the tabs change — there's no
  save button.
- **Removed Tabs** — when the auto-snapshot no longer contains a previously seen
  tab (you closed it or navigated away), it's archived here (by URL, deduped). The
  panel shows the **5 most recent**. **Restore** reopens it and clears it from the
  list; a tab that reappears leaves the archive automatically.
- **Archiving** a project hides it from the switcher and moves its window(s) to
  another active project; its notes and saved tabs are kept. Renaming, archiving,
  and restoring an archived project all happen on the **new tab page's Projects
  list**, not the side panel.
- Switching windows switches to that window's project automatically.
- **Backups**: alongside the live data, Sid keeps one automatic snapshot of the
  whole state per calendar day (last 7 days) in a separate storage key, as a
  safety net independent of undo (which is in-memory only and resets on reload).
  Browse and restore them from the **new tab page's Backups list**.
- **Undo** (header icon) reverts the last content change in either panel — adding
  or deleting a note, schedule/task/distraction line, or reordering a planner
  line — one step at a time. History is per window and not kept across reloads.
- **Across a Chrome restart**, window IDs are reassigned, so Sid does not try to
  restore window↔project bindings. On startup it prunes bindings for windows
  that no longer exist, and each reopened window comes up **unbound** — prompting
  you to pick or create a project — rather than all landing on the same one. A
  fresh install with no projects still opens with one ready-to-use project.

All data stays in Chrome local storage. No accounts, no network requests.

## New tab page

`newtab.html` **replaces Chrome's new tab page** (`chrome_url_overrides.newtab`).
Opening a fresh tab shows a full-page view of Sid's **global** surfaces, laid out
as a centered column for a wide page: today's **day and date** at the top (with a
line beneath it), then the **schedule** and **tasks** columns side by side (no
column-header labels, just the lists), and a titled **Distractions** section below.

Schedule and tasks behave exactly as they do in the side panel: single-click a
line to edit it in place, double-click to delete, and drag to reorder within
their own column; the `Schedule…`/`Task…` hints only show on an empty list.
Distractions are always shown here — no toggle, unlike the panel — with an add
line and the full captured list beneath it (single-click copies a line,
double-click deletes).

Below that, two collapsible admin lists:

- **Projects** — every project, active first then archived. Click an active
  project's name to **rename** it inline (Enter commits, Esc cancels); its
  **Archive** button hides it from the sidebar's switcher. An archived project is
  shown muted with a **Restore** button. Unlike the side panel, nothing here is
  tied to "the current project" — every row names its project explicitly, so you
  can manage any project from any window.
- **Backups** — the dated automatic snapshots (see above). **Restore** asks for
  confirmation, then replaces the live state with that day's snapshot; every open
  window (and this page) picks up the change immediately.

It reads and writes the **same** `chrome.storage.local` state as the side panel
(via `projects.js` / `storage.js`) and updates live, so edits in one show in the
other. It's project-agnostic — no project bar, notes, or tabs here (Projects
manages project records, not a "current" one); the side panel's **new-tab icon**
(top-right of the global section) also opens one.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.
5. Click the Sid toolbar icon — or press the keyboard shortcut — to open the
   side panel.

After editing files, click **Reload** on the Sid card.

## Updating

Sid stays an unpacked, local install on purpose — no store, no auto-update
mechanism (Chrome only checks `update_url` for packaged/enterprise-managed
installs, not `Load unpacked`). To pick up changes: `git pull`, then reload the
extension. `./update.sh` does both steps — pulls the latest commit and prints a
reminder to reload — from wherever you cloned the repo.

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
