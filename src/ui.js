// ui.js
// Wires the side panel DOM to the storage and project modules.
// Owns the in-memory state, the debounced autosave, and the project combobox.

import * as storage from './storage.js';
import * as projects from './projects.js';

const SAVE_DELAY = 400; // ms to debounce autosave writes
const FLASH_MS = 900; // how long a "Copied" confirmation shows
const CLICK_DELAY = 220; // ms to wait for a second click before copying

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const ICON_COPY = `${SVG_OPEN}<path d="M9 9h11v11H9z"/><path d="M5 15H4V4h11v1"/></svg>`;
const ICON_CLEAR = `${SVG_OPEN}<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

const els = {
  comboWrap: document.getElementById('comboWrap'),
  projectInput: document.getElementById('projectInput'),
  projectListbox: document.getElementById('projectListbox'),
  renameInput: document.getElementById('renameInput'),
  undoButton: document.getElementById('undoButton'),
  newtabLink: document.getElementById('newtabLink'),
  copyAllButton: document.getElementById('copyAllButton'),
  completeAllButton: document.getElementById('completeAllButton'),
  saveProjectButton: document.getElementById('saveProjectButton'),
  renameButton: document.getElementById('renameButton'),
  archiveButton: document.getElementById('archiveButton'),
  noteList: document.getElementById('noteList'),
  noteComposeItem: document.getElementById('noteComposeItem'),
  noteComposeRow: document.getElementById('noteComposeRow'),
  dayDate: document.getElementById('dayDate'),
  dayThemeInput: document.getElementById('dayThemeInput'),
  scheduleList: document.getElementById('scheduleList'),
  scheduleInput: document.getElementById('scheduleInput'),
  taskList: document.getElementById('taskList'),
  taskInput: document.getElementById('taskInput'),
  removedSection: document.getElementById('removedSection'),
  removedSummary: document.getElementById('removedSummary'),
  removedList: document.getElementById('removedList'),
  distractionInput: document.getElementById('distractionInput'),
  distractionToggle: document.getElementById('distractionToggle'),
  distractionCount: document.getElementById('distractionCount'),
  distractionList: document.getElementById('distractionList')
};

let state = projects.emptyState();
let windowId = null;
let currentProject = null;
let saveTimer = null;

let distractionsOpen = false; // whether the distractions review list is expanded
let themeEditing = false; // true once the theme field has snapshotted this focus

// Undo: snapshots of state taken before each content edit (this window only).
const UNDO_LIMIT = 50;
const undoStack = [];

// Combobox state.
let comboOpen = false;
let comboRows = []; // [{ kind:'project'|'create'|'hint', name?, text? }]
let highlight = -1; // index into comboRows of the active row

init().catch((error) => {
  console.error(error);
});

async function init() {
  const win = await chrome.windows.getCurrent();
  windowId = String(win.id);

  state = projects.normaliseState(await storage.load());

  // A restart reassigns window IDs, so garbage-collect bindings for windows
  // Chrome no longer has. Persist only if pruning actually removed something.
  const sizeBefore = Object.keys(state.windows).length + Object.keys(state.openWindows).length;
  const liveIds = new Set((await chrome.windows.getAll()).map((w) => String(w.id)));
  projects.pruneWindows(state, liveIds);
  let dirty =
    Object.keys(state.windows).length + Object.keys(state.openWindows).length !== sizeBefore;

  currentProject = projects.windowProject(state, windowId);

  // First run only: seed one ready-to-use project so a fresh install isn't
  // empty. Otherwise an unbound window stays neutral until the user picks or
  // creates a project (never auto-grabbing the first one).
  if (!currentProject && projects.projectNames(state).length === 0) {
    currentProject = projects.newProjectName(state);
    projects.attachWindow(state, windowId, currentProject);
    dirty = true;
  }

  if (dirty) await storage.save(state);

  renderAll();
  bindEvents();

  // Neutral window: nudge the user toward picking or creating a project.
  if (!currentProject) els.projectInput.focus();

  // Keep this panel in sync when another window edits the shared state.
  storage.onChange((incoming) => {
    state = projects.normaliseState(incoming);
    currentProject = projects.windowProject(state, windowId) || currentProject;
    renderAll();
    if (comboOpen) renderList();
  });
}

function bindEvents() {
  els.projectInput.addEventListener('focus', openCombo);
  els.projectInput.addEventListener('input', () => {
    if (!comboOpen) openCombo();
    else renderList();
  });
  els.projectInput.addEventListener('keydown', onComboKey);
  els.projectInput.addEventListener('blur', closeCombo);
  // Keep focus on the input when clicking a row, so blur doesn't pre-empt click.
  els.projectListbox.addEventListener('mousedown', (e) => e.preventDefault());

  els.undoButton.addEventListener('click', undo);
  els.newtabLink.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
  });
  els.saveProjectButton.addEventListener('click', saveProject);
  els.renameButton.addEventListener('click', enterRename);
  els.renameInput.addEventListener('keydown', onRenameKey);
  els.renameInput.addEventListener('blur', exitRename);
  els.archiveButton.addEventListener('click', archiveCurrent);

  // Note compose row works like a text editor: Enter commits (Shift+Enter newline),
  // and Backspace at the very start merges the previous bullet back in to edit it.
  els.noteComposeRow.addEventListener('input', () => autoGrow(els.noteComposeRow));
  els.noteComposeRow.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitCompose();
    } else if (e.key === 'Backspace' && atStart(els.noteComposeRow)) {
      pullBackNote(e);
    }
  });
  els.copyAllButton.addEventListener('click', copyAllNotes);
  els.completeAllButton.addEventListener('click', clearAllNotes);

  // Theme: a single day-agnostic label (above the task column). Snapshot once per
  // editing session (on focus) so undo reverts the whole edit, not each keystroke.
  els.dayThemeInput.addEventListener('focus', () => {
    themeEditing = false;
  });
  els.dayThemeInput.addEventListener('input', () => {
    if (!themeEditing) {
      pushUndo();
      themeEditing = true;
    }
    projects.setTheme(state, els.dayThemeInput.value);
    scheduleSave();
  });

  // Distractions: capture-and-hide. Enter adds and clears; the list stays
  // collapsed, but the summary count bumps to confirm the capture landed.
  els.distractionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (els.distractionInput.value.trim()) {
        pushUndo();
        projects.addDistraction(state, els.distractionInput.value);
        els.distractionInput.value = '';
        scheduleSave();
        renderDistractions();
      }
    }
  });
  // The chevron expands/collapses the captured-distractions list.
  els.distractionToggle.addEventListener('click', () => {
    distractionsOpen = !distractionsOpen;
    renderDistractions();
  });

  // Planner: schedule (left, plain editable) + numbered tasks (right). Enter adds;
  // on the schedule line, Backspace at the start pulls the previous item back to edit.
  els.scheduleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && atStart(els.scheduleInput)) {
      pullBackListItem(e, els.scheduleInput, 'schedule');
    } else {
      addOnEnter(e, els.scheduleInput, 'schedule');
    }
  });
  els.taskInput.addEventListener('keydown', (e) => addOnEnter(e, els.taskInput, 'tasks'));

  bindTabWatch();
}

// Refresh the save-status dot when this window's tabs change.
function bindTabWatch() {
  const here = (winId) => String(winId) === windowId;
  chrome.tabs.onCreated.addListener((tab) => {
    if (here(tab.windowId)) renderSaveStatus();
  });
  chrome.tabs.onRemoved.addListener((id, info) => {
    if (here(info.windowId)) renderSaveStatus();
  });
  chrome.tabs.onUpdated.addListener((id, change, tab) => {
    if (change.url && here(tab.windowId)) renderSaveStatus();
  });
  chrome.tabs.onAttached.addListener((id, info) => {
    if (here(info.newWindowId)) renderSaveStatus();
  });
  chrome.tabs.onDetached.addListener((id, info) => {
    if (here(info.oldWindowId)) renderSaveStatus();
  });
}

// --- Project combobox ------------------------------------------------------

function openCombo() {
  comboOpen = true;
  els.projectInput.setAttribute('aria-expanded', 'true');
  els.projectListbox.hidden = false;
  renderList();
}

function closeCombo() {
  comboOpen = false;
  els.projectInput.setAttribute('aria-expanded', 'false');
  els.projectInput.removeAttribute('aria-activedescendant');
  els.projectListbox.hidden = true;
  els.projectListbox.innerHTML = '';
  highlight = -1;
  // Drop any uncommitted text.
  els.projectInput.value = currentProject || '';
}

function onComboKey(event) {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (!comboOpen) openCombo();
      else moveHighlight(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      moveHighlight(-1);
      break;
    case 'Enter': {
      event.preventDefault();
      const row = comboRows[highlight];
      if (comboOpen && row && row.kind !== 'hint') commitRow(row);
      else closeCombo();
      break;
    }
    case 'Escape':
      event.preventDefault();
      closeCombo();
      break;
    case 'Tab':
      closeCombo();
      break;
    default:
      break;
  }
}

function renderList() {
  const { rows, exact } = projects.projectMenuRows(
    projects.projectNames(state),
    els.projectInput.value,
    currentProject
  );
  comboRows = rows;
  els.projectListbox.innerHTML = '';

  rows.forEach((row, i) => {
    const li = document.createElement('li');
    li.id = `combo-opt-${i}`;

    if (row.kind === 'hint') {
      li.className = 'combo-hint';
      li.textContent = row.text;
    } else {
      li.className = 'combo-option';
      li.setAttribute('role', 'option');
      if (row.kind === 'project') {
        li.textContent = row.name;
        if (row.name === currentProject) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = 'current';
          li.appendChild(badge);
        }
      } else if (row.kind === 'create') {
        li.classList.add('combo-action');
        li.textContent = `Create "${row.name}"`;
      }
      li.addEventListener('click', () => commitRow(row));
      li.addEventListener('mousemove', () => setHighlight(i));
    }

    els.projectListbox.appendChild(li);
  });

  // Default highlight: an exact match, else the create row, else the current
  // project, else the first selectable row.
  let next = exact ? rows.findIndex((r) => r.kind === 'project' && r.name === exact) : -1;
  if (next < 0) next = rows.findIndex((r) => r.kind === 'create');
  if (next < 0) next = rows.findIndex((r) => r.kind === 'project' && r.name === currentProject);
  if (next < 0) next = rows.findIndex((r) => r.kind !== 'hint');
  setHighlight(next);
}

function setHighlight(index) {
  highlight = index;
  const options = els.projectListbox.children;
  for (let i = 0; i < options.length; i += 1) {
    options[i].classList.toggle('active', i === index);
  }
  if (index >= 0) {
    els.projectInput.setAttribute('aria-activedescendant', `combo-opt-${index}`);
    options[index].scrollIntoView({ block: 'nearest' });
  } else {
    els.projectInput.removeAttribute('aria-activedescendant');
  }
}

function moveHighlight(delta) {
  const selectable = comboRows
    .map((row, i) => (row.kind === 'hint' ? -1 : i))
    .filter((i) => i >= 0);
  if (!selectable.length) return;

  const pos = selectable.indexOf(highlight);
  const nextPos = (pos + delta + selectable.length) % selectable.length;
  setHighlight(selectable[nextPos]);
}

function commitRow(row) {
  if (row.kind === 'project' || row.kind === 'create') gotoProject(row.name);
}

// Switch to a project, creating it if the name is new.
function gotoProject(name) {
  const clean = projects.normaliseName(name);
  if (!clean) {
    closeCombo();
    return;
  }
  currentProject = clean;
  projects.attachWindow(state, windowId, clean);
  ensureCurrentActive();
  commitProjectChange();
}

function commitProjectChange() {
  closeCombo();
  renderAll();
  scheduleSave();
}

// The current window must always show an active project. If a switch or rename
// lands on a name that is archived, bring it back.
function ensureCurrentActive() {
  const project = state.projects[currentProject];
  if (project && project.archived) projects.restoreProject(state, currentProject);
}

// Return the current project's record, creating one if somehow absent. Only
// reached from explicit actions (adding a note, Save) — all disabled while the
// window is unbound — so it never creates a project from a render.
function activeProject() {
  if (!currentProject) {
    currentProject = projects.newProjectName(state);
    projects.attachWindow(state, windowId, currentProject);
    renderAll();
  }
  return projects.ensureProject(state, currentProject);
}

// --- Inline rename ---------------------------------------------------------

function enterRename() {
  if (!currentProject) return;
  closeCombo();
  els.comboWrap.hidden = true;
  els.renameInput.hidden = false;
  els.renameInput.value = currentProject || '';
  els.renameInput.focus();
  els.renameInput.select();
}

function exitRename() {
  els.renameInput.hidden = true;
  els.comboWrap.hidden = false;
  renderProjectInput();
}

function onRenameKey(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitRename();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    exitRename();
  }
}

function commitRename() {
  const clean = projects.normaliseName(els.renameInput.value);
  if (clean && currentProject) {
    // renameProject switches to an existing name rather than merging.
    currentProject = projects.renameProject(state, currentProject, clean);
    ensureCurrentActive();
    projects.attachWindow(state, windowId, currentProject);
    scheduleSave();
  }
  exitRename();
  renderAll();
}

// --- Archive ---------------------------------------------------------------

async function archiveCurrent() {
  if (!currentProject) return;
  projects.archiveProject(state, currentProject);
  currentProject = projects.windowProject(state, windowId);
  await storage.save(state);
  renderAll();
}

// --- Notes (per-project item list) -----------------------------------------

// Commit the compose row as a new note; keep focus so the next line is ready.
function commitCompose() {
  if (!els.noteComposeRow.value.trim() || !currentProject) return;
  pushUndo();
  projects.addNote(state, currentProject, els.noteComposeRow.value);
  els.noteComposeRow.value = '';
  autoGrow(els.noteComposeRow);
  scheduleSave();
  renderNotes(); // rebuilds committed rows only; the compose row keeps focus
}

// Double-click a note to delete it.
function deleteNote(index) {
  pushUndo();
  projects.removeNote(state, currentProject, index);
  scheduleSave();
  renderNotes();
}

// Backspace at the start of the compose line merges the previous bullet back in
// (its text + the compose text), caret at the join — like a text editor.
function pullBackNote(event) {
  if (!currentProject) return;
  const notes = projects.getProject(state, currentProject).notes || [];
  if (!notes.length) return;
  event.preventDefault();
  pushUndo();
  const prev = notes[notes.length - 1];
  projects.removeNote(state, currentProject, notes.length - 1);
  const combined = prev + els.noteComposeRow.value;
  scheduleSave();
  renderNotes();
  els.noteComposeRow.value = combined;
  autoGrow(els.noteComposeRow);
  els.noteComposeRow.focus();
  els.noteComposeRow.setSelectionRange(prev.length, prev.length);
}

// Copy every note (one per line) without removing them.
function copyAllNotes() {
  if (!currentProject) return;
  const items = projects.getProject(state, currentProject).notes || [];
  if (!items.length) return;
  copyText(items.join('\n'), els.copyAllButton);
}

// Clear all notes.
function clearAllNotes() {
  if (!currentProject) return;
  const items = projects.getProject(state, currentProject).notes || [];
  if (!items.length) return;
  pushUndo();
  projects.clearNotes(state, currentProject);
  scheduleSave();
  renderNotes();
}

// True when the caret sits at the very start of a field, with no selection.
function atStart(field) {
  return field.selectionStart === 0 && field.selectionEnd === 0;
}

// Copy text to the clipboard and briefly confirm on the element.
async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    flash(button);
  } catch (error) {
    console.error(error);
  }
}

// Briefly flash a line green to confirm a copy.
function flash(button) {
  if (button.dataset.flashing) return;
  button.dataset.flashing = '1';
  button.classList.add('copied');
  setTimeout(() => {
    button.classList.remove('copied');
    delete button.dataset.flashing;
  }, FLASH_MS);
}

// --- Workspace -------------------------------------------------------------

// Capture this window's reopenable tabs as the project's workspace snapshot.
// The saving window becomes the project's host window.
async function saveProject() {
  if (!currentProject) return;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const reopenable = tabs.filter((t) => projects.isReopenable(t.url));
  const updated = projects.captureWorkspace(activeProject(), reopenable, Date.now());

  state.projects[currentProject] = updated;
  projects.setWorkspaceWindow(state, currentProject, windowId);
  await storage.save(state);
  renderSaveStatus();
  renderRemoved();
}

// Reopen a removed tab in this window and drop it from the archive.
async function restoreTab(url) {
  await chrome.tabs.create({ url, windowId: Number(windowId) });
  state.projects[currentProject] = projects.unarchiveTab(activeProject(), url);
  await storage.save(state);
  renderRemoved();
}

// --- Rendering -------------------------------------------------------------

function renderAll() {
  // Reflect the window's project in Chrome's side-panel header. Project name
  // first so it survives truncation in the narrow header; plain 'Sid' when unbound.
  document.title = currentProject ? `${currentProject} — Sid` : 'Sid';
  renderProjectInput();
  renderNotes();
  renderDayHeader();
  renderPlanner();
  renderDistractions();
  renderSaveStatus();
  renderRemoved();
}

// Add an item to a global list on Enter; the input stays as the next empty tile.
function addOnEnter(event, input, key) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (!input.value.trim()) return;
  pushUndo();
  projects.addToList(state, key, input.value);
  input.value = '';
  scheduleSave();
  renderPlanner();
}

// Backspace at the start of a planner add-line pulls the previous item back into
// the line to edit it (text + the line's text), caret at the join.
function pullBackListItem(event, input, key) {
  const items = state[key] || [];
  if (!items.length) return;
  event.preventDefault();
  pushUndo();
  const prev = items[items.length - 1].text;
  projects.removeFromList(state, key, items.length - 1);
  input.value = prev + input.value;
  scheduleSave();
  renderPlanner();
  input.focus();
  input.setSelectionRange(prev.length, prev.length);
}

// Planner: schedule (left) and tasks (right) as plain text lists. Bullets and
// numbers are presentation-only (CSS); each line copies on single-click and
// deletes on double-click — the same gesture notes use.
function renderPlanner() {
  const schedule = state.schedule || [];
  const tasks = state.tasks || [];
  // Only hint on an empty column; once there are entries the add-line is blank.
  els.scheduleInput.placeholder = schedule.length ? '' : 'Schedule…';
  els.taskInput.placeholder = tasks.length ? '' : 'Task…';
  renderTileColumn(els.scheduleList, schedule, 'schedule');
  renderTileColumn(els.taskList, tasks, 'tasks');
}

function renderTileColumn(listEl, items, key) {
  listEl.innerHTML = '';
  const isTasks = key === 'tasks';
  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'planner-item';
    li.textContent = item.text;

    // Tasks: single-click toggles done (strikethrough, in place); the line
    // stays put as a record. Schedule: single-click copies. Both: double deletes.
    if (isTasks && item.done) li.classList.add('done');
    li.title = isTasks
      ? 'Click to complete, double-click to delete'
      : 'Click to copy, double-click to delete';

    // Disambiguate single from double with a short timer.
    let clickTimer = null;
    li.addEventListener('click', () => {
      if (clickTimer) return; // second click handled by dblclick
      clickTimer = setTimeout(() => {
        clickTimer = null;
        if (isTasks) toggleTask(i);
        else copyText(item.text, li);
      }, CLICK_DELAY);
    });
    li.addEventListener('dblclick', () => {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      deleteTile(key, i);
    });

    listEl.appendChild(li);
  });
}

// Single-click a task to toggle its done/strikethrough state, leaving it in place.
function toggleTask(index) {
  pushUndo();
  projects.toggleListItem(state, 'tasks', index);
  scheduleSave();
  renderPlanner();
}

// Double-click a line to delete it (mistakes/clearing).
function deleteTile(key, index) {
  pushUndo();
  projects.removeFromList(state, key, index);
  scheduleSave();
  renderPlanner();
}

// The day/date label sits above the schedule; the theme box (above the tasks)
// edits today's theme.
function renderDayHeader() {
  els.dayDate.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
  if (document.activeElement !== els.dayThemeInput) {
    els.dayThemeInput.value = state.theme || '';
  }
}

function renderProjectInput() {
  const bound = currentProject !== null;
  els.saveProjectButton.disabled = !bound;
  els.renameButton.disabled = !bound;
  els.archiveButton.disabled = !bound;
  els.projectInput.placeholder = bound ? 'Project' : 'Pick or create a project';
  // Don't clobber what the user is typing into the open combobox.
  if (comboOpen && document.activeElement === els.projectInput) return;
  els.projectInput.value = bound ? currentProject : '';
}

// Notes are a raw notepad: each committed row is plain text with copy/clear
// buttons revealed on hover; a persistent empty compose row sits at the end. The
// list is disabled while the window is unbound.
function renderNotes() {
  const bound = currentProject !== null;
  const items = bound ? projects.getProject(state, currentProject).notes || [] : [];

  els.noteComposeRow.disabled = !bound;
  // Hint "Notes…" only on a blank notepad; once you've written, the line is bare.
  els.noteComposeRow.placeholder = !bound ? 'Pick a project first' : items.length ? '' : 'Notes…';
  els.copyAllButton.disabled = !items.length;
  els.completeAllButton.disabled = !items.length;

  // Rebuild only the committed rows; the compose row at the end is persistent
  // so in-progress text and focus survive a re-render.
  els.noteList.querySelectorAll('.note-item').forEach((el) => el.remove());

  items.forEach((text, i) => {
    const item = document.createElement('li');
    item.className = 'note-item';

    const textEl = document.createElement('span');
    textEl.className = 'note-text';
    textEl.textContent = text;

    // Per-line copy / clear buttons, revealed on hover.
    const actions = document.createElement('span');
    actions.className = 'note-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'note-line-btn';
    copyBtn.title = 'Copy';
    copyBtn.setAttribute('aria-label', 'Copy');
    copyBtn.innerHTML = ICON_COPY;
    copyBtn.addEventListener('click', () => copyText(text, copyBtn));

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'note-line-btn';
    clearBtn.title = 'Clear';
    clearBtn.setAttribute('aria-label', 'Clear');
    clearBtn.innerHTML = ICON_CLEAR;
    clearBtn.addEventListener('click', () => deleteNote(i));

    actions.append(copyBtn, clearBtn);
    item.append(textEl, actions);
    els.noteList.insertBefore(item, els.noteComposeItem);
  });
}

// Resize a textarea to fit its content (so writing wraps across lines).
function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// The save icon shows last-saved time on hover and a status dot. It only tracks
// the saved TABS snapshot — not notes/ideas (those autosave separately): green
// when the snapshot matches the window's tabs, red when tabs have drifted, and
// no dot until a snapshot exists.
async function renderSaveStatus() {
  const bound = currentProject !== null;
  const workspace = bound ? projects.getProject(state, currentProject).workspace : null;
  els.saveProjectButton.title = !bound
    ? 'Save project tabs'
    : workspace
    ? `Save project tabs — last saved ${new Date(workspace.savedAt).toLocaleString()}`
    : 'Save project tabs — not saved yet';

  if (!bound || !workspace) {
    els.saveProjectButton.classList.remove('is-clean', 'is-dirty');
    return;
  }
  const saved = await isWorkspaceSaved(workspace);
  els.saveProjectButton.classList.toggle('is-clean', saved);
  els.saveProjectButton.classList.toggle('is-dirty', !saved);
}

// True when the saved snapshot's reopenable URLs match the window's now.
async function isWorkspaceSaved(workspace) {
  if (!workspace || !workspace.tabs) return false;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const live = tabs.filter((t) => projects.isReopenable(t.url)).map((t) => t.url).sort();
  const saved = workspace.tabs.map((t) => t.url).sort();
  return live.length === saved.length && live.every((url, i) => url === saved[i]);
}

function renderRemoved() {
  if (!currentProject) {
    els.removedSection.hidden = true;
    return;
  }
  const removed = projects.getProject(state, currentProject).removedTabs || [];
  els.removedSection.hidden = removed.length === 0;
  els.removedSummary.textContent = `Removed Tabs (${removed.length})`;

  els.removedList.innerHTML = '';
  for (const tab of removed) {
    const item = document.createElement('li');
    item.className = 'removed-item';

    const meta = document.createElement('div');
    meta.className = 'removed-meta';

    const title = document.createElement('div');
    title.className = 'removed-title';
    title.textContent = tab.title || tab.url;

    const link = document.createElement('a');
    link.className = 'removed-url';
    link.href = tab.url;
    link.textContent = tab.url;
    link.target = '_blank';
    link.rel = 'noreferrer';

    meta.append(title, link);

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.textContent = 'Restore';
    restore.addEventListener('click', () => restoreTab(tab.url));

    item.append(meta, restore);
    els.removedList.appendChild(item);
  }
}

// --- Distractions (global capture-and-hide list) ---------------------------

// One module: the input captures; a count + chevron on the right appears once
// something is captured and expands the review list. Each row is plain text —
// single-click copies, double-click deletes.
function renderDistractions() {
  const items = state.distractions || [];
  const has = items.length > 0;
  if (!has) distractionsOpen = false; // nothing to show, so stay collapsed

  els.distractionToggle.hidden = !has;
  els.distractionCount.textContent = String(items.length);
  els.distractionToggle.classList.toggle('is-open', distractionsOpen);
  els.distractionToggle.setAttribute('aria-expanded', String(distractionsOpen));
  const label = distractionsOpen ? 'Hide distractions' : 'Show distractions';
  els.distractionToggle.title = label;
  els.distractionToggle.setAttribute('aria-label', label);

  els.distractionList.hidden = !(has && distractionsOpen);
  els.distractionList.innerHTML = '';
  if (els.distractionList.hidden) return;

  items.forEach((text, i) => {
    const li = document.createElement('li');
    li.className = 'note-item';
    li.textContent = text;
    li.title = 'Click to copy, double-click to delete';

    // Disambiguate single (copy) from double (delete) with a short timer.
    let clickTimer = null;
    li.addEventListener('click', () => {
      if (clickTimer) return; // second click handled by dblclick
      clickTimer = setTimeout(() => {
        clickTimer = null;
        copyText(text, li);
      }, CLICK_DELAY);
    });
    li.addEventListener('dblclick', () => {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      deleteDistraction(i);
    });

    els.distractionList.appendChild(li);
  });
}

function deleteDistraction(index) {
  pushUndo();
  projects.removeDistraction(state, index);
  scheduleSave();
  renderDistractions();
}

// --- Undo ------------------------------------------------------------------

// Snapshot the whole state before a content edit so it can be reverted. Covers
// both panels (notes, schedule, tasks, theme, distractions).
function pushUndo() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  updateUndoButton();
}

// Revert the most recent content edit and persist it (also syncs other windows).
function undo() {
  const prev = undoStack.pop();
  if (prev === undefined) return;
  state = projects.normaliseState(JSON.parse(prev));
  currentProject = projects.windowProject(state, windowId) || currentProject;
  storage.save(state);
  renderAll();
  updateUndoButton();
}

function updateUndoButton() {
  els.undoButton.disabled = undoStack.length === 0;
}

// --- Persistence -----------------------------------------------------------

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.save(state), SAVE_DELAY);
}
