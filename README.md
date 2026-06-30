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
- The panel has two sections: the **per-project (window) section** on top (project
  bar, notes, then removed tabs pinned at its foot) and the **global (chrome)
  section** below (planner, distractions — shared across all windows), set off by a
  light dividing line.
- The header is a single project combobox: click to see all projects, type to
  filter, and Enter on a new name creates it. Typing a name that already exists
  switches to it (never merges). Header icons: **undo** (revert the last content
  change in either panel), **save** (capture this window's tabs), **pencil**
  (rename in place), and **archive**.
  The whole panel is styled like a plain written document — no tiles, boxes, or
  list buttons; you type straight onto lines.
- **Notes** — a raw notepad that behaves like a small text editor. The bottom line
  is always an empty line you write on: **Enter** commits it (**Shift+Enter**
  inserts a newline); **Backspace** at the very start of the write-line pulls the
  previous line back in to edit it. Committed lines are plain text; **hover** a line
  to reveal **copy** and **clear** buttons for it. Beneath the lowest line,
  **copy-all** and **clear-all** icons copy every note (one per line) or empty the
  list.
- **Planner** — two global columns: a plain-text **schedule** (left, no bullets)
  and a numbered **task** list (right). Above the schedule sits today's **day and
  date**; above the tasks sits a **theme** line (a short global label, autosaved).
  Type on a column's bottom line and press Enter to add an entry. **Schedule**
  lines: single-click copies, double-click deletes, and **Backspace** at the start
  of the add-line pulls the previous item back to edit it. **Tasks** keep a done
  state — single-click toggles **strikethrough** (the task stays in place as a
  record of done vs. left), double-click deletes.
- A link at the **top-right of the global section** opens the full-page
  ([new tab](#new-tab-page-preview)) view of these global surfaces.
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
- **Undo** (header icon) reverts the last content change in either panel — adding
  or deleting a note, schedule/task/distraction line, completing a task, or a theme
  edit — one step at a time. History is per window and not kept across reloads.
- **Across a Chrome restart**, window IDs are reassigned, so Sid does not try to
  restore window↔project bindings. On startup it prunes bindings for windows
  that no longer exist, and each reopened window comes up **unbound** — prompting
  you to pick or create a project — rather than all landing on the same one. A
  fresh install with no projects still opens with one ready-to-use project.

All data stays in Chrome local storage. No accounts, no network requests.

## New tab page (preview)

`newtab.html` is a standalone, full-page view of Sid's **global** surfaces — the
day/date + theme header, the schedule and task lists, and distractions — laid out
as a centered column for a wide page. It reads and writes the **same**
`chrome.storage.local` state as the side panel (via `projects.js` / `storage.js`)
and updates live, so edits in one show in the other. It does **not** override
Chrome's new tab; open it manually at
`chrome-extension://<extension-id>/newtab.html` (the id is on the Sid card at
`chrome://extensions`). It's a first cut for evaluation — no project bar, notes,
or tabs here.

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
