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
  creates it. Typing a name that already exists switches to it (never merges). A
  **"+ Create new project"** row always sits at the bottom of the list — click it
  to clear the box (cursor ready) without first having to type a novel name. That's
  all the sidebar does with projects — **renaming and archiving live on the new
  tab page** instead. Header icons: **undo** (revert the last content change) and
  **copy-all** / **clear-all** notes.
  The whole panel is styled like a plain written document — no tiles, boxes, or
  list buttons; you type straight onto lines.
- **Every editable list — Notes, Schedule, Tasks, and Distractions — shares one
  interaction model**, so there's a single thing to learn everywhere in the
  panel (and on the [new tab page](#new-tab-page)):
  - **Add**: the bottom line of each list is always an empty line you write on.
    **Enter** commits it. On Notes (a multi-line notepad), **Shift+Enter**
    inserts a newline instead; Schedule, Tasks, and Distractions are single-line,
    so Enter is the only thing Enter does. **Backspace** at the very start of the
    write-line pulls the previous entry back in to edit it.
  - **Edit**: **single-click a committed line** to edit it in place — **Enter**
    commits, **Esc** cancels, and emptying it then pressing **Enter** removes it.
  - **Delete**: **double-click a line** to delete it outright.
  - **Copy**: **hover** a line to reveal a small **copy** button, and a small
    **delete (×)** button as an alternative to double-click.
  - **Reorder** (Schedule and Tasks only): **drag** a line to reorder it within
    its own list — hover reveals a small **grip handle** so the drag zone is
    visible rather than an invisible click-and-drag anywhere on the row.
  - **Complete** (Tasks only): the leading **number doubles as a tick** — click
    it (not the text) to mark the task done, turning it into a check mark with
    the text struck through; click again to undo. This is independent of the
    text's own click-to-edit.
  Empty lists hint with `Notes…`, `Schedule…`, `Task…`, `Distractions…`, hidden
  once they have entries. The header's **copy-all** and **clear-all** icons copy
  every note (one per line) or empty the list — Notes only.
- **Planner** — two global columns: a **schedule** (left) and a numbered **task**
  list (right), with today's **day and date** above the schedule.
- A link at the **top-right of the global section** opens the full-page
  ([new tab](#new-tab-page)) view of these global surfaces.
- **Distractions** — a global quick-capture list at the bottom of the panel,
  shared across every window, using the same add/edit/delete/copy model as
  Notes. Open the **new tab page** for the same list on a full page.
- **Right-click any editable field on any page** (not just Sid) and choose
  **Paste from "&lt;project&gt;" notes** to insert one of the focused window's
  project notes at the cursor — a submenu lists each note, truncated if long.
  The menu updates itself as you switch windows or edit notes.
- **Everything autosaves.** Notes, schedule, tasks, distractions, and the project
  name persist as you type, and the window's reopenable tabs (title + URL, in
  order) are **snapshotted automatically** whenever the tabs change — there's no
  save button.
- **Removed Tabs** — when the auto-snapshot no longer contains a previously seen
  tab (you closed it or navigated away), it's archived here (by URL, deduped),
  capped at the **5 most recent** — enforced both when a new tab is archived and
  retroactively on load, so it can't linger above 5 from before the cap existed.
  **Restore** reopens it and clears it from the list; a tab that reappears leaves
  the archive automatically.
- **Archiving** a project hides it from the switcher and moves its window(s) to
  another active project; its notes and saved tabs are kept. Renaming, archiving,
  and restoring an archived project all happen on the **new tab page's Projects
  list**, not the side panel.
- Switching windows switches to that window's project automatically.
- **Backups**: alongside the live data, Sid keeps one automatic snapshot of the
  whole state per calendar day (last 7 days) in a separate storage key, as a
  safety net independent of undo (which is in-memory only and resets on reload).
  Browse and restore them from the **new tab page's Backups list**.
- **Undo** (header icon) reverts the last content change in either panel — adding,
  editing, or deleting a note/schedule/task/distraction line, toggling a task
  done, or reordering a planner line — one step at a time. History is per window
  and not kept across reloads.
- **Across a Chrome restart**, window IDs are reassigned, so Sid does not try to
  restore window↔project bindings. On startup it prunes bindings for windows
  that no longer exist, and each reopened window comes up **unbound** — prompting
  you to pick or create a project — rather than all landing on the same one. A
  fresh install with no projects still opens with one ready-to-use project.

All data stays in Chrome local storage. No accounts, no network requests.

## New tab page

`newtab.html` **replaces Chrome's new tab page** (`chrome_url_overrides.newtab`).
Opening a fresh tab shows today's **day and date** at the top (with a line
beneath it), then a **responsive grid of modules** — **Schedule**, **Tasks**,
**Scratchpad**, **Distractions**, and **Projects** — that sit side by side when
the window is wide enough, wrapping down to fewer columns (to one, on a narrow
window) as it narrows.

Schedule, Tasks, Scratchpad, and Distractions share the **exact same interaction
model as the side panel** (see [How it works](#how-it-works)): a persistent
compose line adds an entry on **Enter** (**Shift+Enter** for a newline on
Scratchpad, which is multi-line like Notes; single-line elsewhere); **single-click**
a committed line to edit it in place; **double-click** to delete it; **hover** to
reveal **copy** and **delete** buttons; **Schedule** and **Tasks** also reveal a
**drag handle** on hover to reorder; and **Tasks**' leading number doubles as a
completion tick. **Schedule** and **Tasks** here read and write the exact same
lists as the side panel's planner, so edits and reordering made on either page
show up on the other immediately. **Projects** is the one exception to the shared
interaction — instead of typing, click an active project's name to **rename** it
inline, or use its **Archive** button; an archived project shows muted with a
**Restore** button. Unlike the side panel, nothing here is tied to "the current
project" — every row names its project explicitly, so you can manage any project
from any window.

Below the grid, a collapsible **Backups** list (see above): dated automatic
snapshots, each with a **Restore** button that asks for confirmation, then
replaces the live state; every open window (and this page) picks up the change
immediately.

It reads and writes the **same** `chrome.storage.local` state as the side panel
(via `projects.js` / `storage.js`) and updates live, so edits in one show in the
other. It's project-agnostic — no project bar, per-project notes, or tabs here;
the side panel's **new-tab icon** (top-right of the global section) also opens
one.

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
