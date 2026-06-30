// ui.js
// Wires the side panel DOM to the storage and project modules.
// Owns the in-memory state, the debounced autosave, and the project combobox.

import * as storage from './storage.js';
import * as projects from './projects.js';

const SAVE_DELAY = 400; // ms to debounce autosave writes
const FLASH_MS = 900; // how long a "Copied" confirmation shows
const DAYS = ['mon', 'tue', 'wed', 'thu']; // working days in the week strip

const els = {
  comboWrap: document.getElementById('comboWrap'),
  projectInput: document.getElementById('projectInput'),
  projectListbox: document.getElementById('projectListbox'),
  renameInput: document.getElementById('renameInput'),
  saveProjectButton: document.getElementById('saveProjectButton'),
  renameButton: document.getElementById('renameButton'),
  archiveButton: document.getElementById('archiveButton'),
  noteComposer: document.getElementById('noteComposer'),
  copyAllButton: document.getElementById('copyAllButton'),
  completeAllButton: document.getElementById('completeAllButton'),
  noteList: document.getElementById('noteList'),
  dayCycleButton: document.getElementById('dayCycleButton'),
  dayThemeInput: document.getElementById('dayThemeInput'),
  scheduleList: document.getElementById('scheduleList'),
  scheduleInput: document.getElementById('scheduleInput'),
  taskList: document.getElementById('taskList'),
  taskInput: document.getElementById('taskInput'),
  taskNumber: document.getElementById('taskNumber'),
  removedSection: document.getElementById('removedSection'),
  removedSummary: document.getElementById('removedSummary'),
  removedList: document.getElementById('removedList'),
  distractionInput: document.getElementById('distractionInput')
};

let state = projects.emptyState();
let windowId = null;
let currentProject = null;
let saveTimer = null;

// Note edit + day-cycle state.
let editingNote = -1; // index of the note being edited inline, or -1
let cycleDay = 'mon'; // which day the theme control is showing
let editingTile = null; // { key, index } of the planner tile being edited, or null

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

  // Start the day-theme control on today (Mon–Thu), else Monday.
  cycleDay = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu' }[new Date().getDay()] || 'mon';

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

  els.saveProjectButton.addEventListener('click', saveProject);
  els.renameButton.addEventListener('click', enterRename);
  els.renameInput.addEventListener('keydown', onRenameKey);
  els.renameInput.addEventListener('blur', exitRename);
  els.archiveButton.addEventListener('click', archiveCurrent);

  // Note taker: type freely (wrapping); Enter commits the line as a task.
  els.noteComposer.addEventListener('input', () => autoGrow(els.noteComposer));
  els.noteComposer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (els.noteComposer.value.trim() && currentProject) {
        projects.addNote(state, currentProject, els.noteComposer.value);
        els.noteComposer.value = '';
        autoGrow(els.noteComposer);
        scheduleSave();
        renderNotes();
      }
    }
  });
  els.copyAllButton.addEventListener('click', copyAllNotes);
  els.completeAllButton.addEventListener('click', completeAllNotes);

  // Day theme: the button cycles Mon→Tue→Wed→Thu; the field edits that day.
  els.dayCycleButton.addEventListener('click', () => {
    cycleDay = DAYS[(DAYS.indexOf(cycleDay) + 1) % DAYS.length];
    renderDayCycle();
    els.dayThemeInput.focus();
  });
  els.dayThemeInput.addEventListener('input', () => {
    projects.setDayTheme(state, cycleDay, els.dayThemeInput.value);
    scheduleSave();
  });

  // Distractions: capture and clear; the box stays collapsed (no list shown).
  els.distractionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (els.distractionInput.value.trim()) {
        projects.addDistraction(state, els.distractionInput.value);
        els.distractionInput.value = '';
        scheduleSave();
      }
    }
  });

  // Planner: schedule (left) + numbered tasks (right). Enter adds the next tile.
  els.scheduleInput.addEventListener('keydown', (e) => addOnEnter(e, els.scheduleInput, 'schedule'));
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

// Click a note to edit it in place (in a wrapping textarea).
function startEdit(index) {
  editingNote = index;
  renderNotes();
  const input = document.getElementById('noteEditInput');
  if (input) {
    autoGrow(input);
    input.focus();
    input.select();
  }
}

function commitEdit(index, value) {
  if (editingNote !== index) return; // already committed/cancelled
  editingNote = -1;
  projects.editNote(state, currentProject, index, value);
  scheduleSave();
  renderNotes();
}

function cancelEdit() {
  editingNote = -1;
  renderNotes();
}

// Tick complete = remove the item.
function tickNote(index) {
  projects.removeNote(state, currentProject, index);
  scheduleSave();
  renderNotes();
}

// Copy text to the clipboard and briefly confirm on the button.
async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    flash(button);
  } catch (error) {
    console.error(error);
  }
}

// Copy all notes (one per line) without removing them.
function copyAllNotes() {
  const items = projects.getProject(state, currentProject).notes || [];
  if (!items.length) return;
  copyText(items.join('\n'), els.copyAllButton);
}

// Complete all = clear the list.
function completeAllNotes() {
  if (!currentProject) return;
  projects.clearNotes(state, currentProject);
  scheduleSave();
  renderNotes();
}

// Briefly flash a button green to confirm a copy.
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
  renderProjectInput();
  renderNotes();
  renderDayCycle();
  renderPlanner();
  renderSaveStatus();
  renderRemoved();
}

// Add an item to a global list on Enter; the input stays as the next empty tile.
function addOnEnter(event, input, key) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (!input.value.trim()) return;
  projects.addToList(state, key, input.value);
  input.value = '';
  scheduleSave();
  renderPlanner();
}

// Planner: the schedule list (left) and the auto-numbered task list (right).
function renderPlanner() {
  renderTileColumn(els.scheduleList, state.schedule || [], 'schedule', false);
  renderTileColumn(els.taskList, state.tasks || [], 'tasks', true);
  els.taskNumber.textContent = `${(state.tasks || []).length + 1}.`;
}

function renderTileColumn(listEl, items, key, numbered) {
  listEl.innerHTML = '';
  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = `planner-item${item.done ? ' done' : ''}`;

    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = 'note-btn tick';
    tick.title = item.done ? 'Mark not done' : 'Complete';
    tick.setAttribute('aria-label', tick.title);
    tick.innerHTML = icon('M20 6 9 17l-5-5');
    tick.addEventListener('click', () => toggleTile(key, i));
    li.appendChild(tick);

    if (numbered) {
      const num = document.createElement('span');
      num.className = 'planner-num';
      num.textContent = `${i + 1}.`;
      li.appendChild(num);
    }

    if (editingTile && editingTile.key === key && editingTile.index === i) {
      const input = document.createElement('textarea');
      input.id = 'tileEditInput';
      input.className = 'note-composer tile-edit';
      input.rows = 1;
      input.value = item.text;
      input.addEventListener('input', () => autoGrow(input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commitTileEdit(key, i, input.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelTileEdit();
        }
      });
      input.addEventListener('blur', () => commitTileEdit(key, i, input.value));
      li.appendChild(input);
    } else {
      const label = document.createElement('span');
      label.className = 'planner-text';
      label.textContent = item.text;
      label.title = 'Click to edit';
      label.addEventListener('click', () => startTileEdit(key, i));
      li.appendChild(label);
    }

    listEl.appendChild(li);
  });
}

function toggleTile(key, index) {
  projects.toggleListItem(state, key, index);
  scheduleSave();
  renderPlanner();
}

function startTileEdit(key, index) {
  editingTile = { key, index };
  renderPlanner();
  const input = document.getElementById('tileEditInput');
  if (input) {
    autoGrow(input);
    input.focus();
    input.select();
  }
}

function commitTileEdit(key, index, value) {
  if (!editingTile || editingTile.key !== key || editingTile.index !== index) return;
  editingTile = null;
  projects.editListItem(state, key, index, value);
  scheduleSave();
  renderPlanner();
}

function cancelTileEdit() {
  editingTile = null;
  renderPlanner();
}

// The day-cycle button shows the selected day; the field edits that day's theme.
function renderDayCycle() {
  const labels = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu' };
  const todayKey = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu' }[new Date().getDay()];
  els.dayCycleButton.textContent = labels[cycleDay];
  els.dayCycleButton.classList.toggle('is-today', cycleDay === todayKey);
  if (document.activeElement !== els.dayThemeInput) {
    els.dayThemeInput.value = (state.dayThemes && state.dayThemes[cycleDay]) || '';
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

// Notes are per-project, so the list is disabled while the window is unbound.
function renderNotes() {
  const bound = currentProject !== null;
  const items = bound ? projects.getProject(state, currentProject).notes || [] : [];

  if (!bound) editingNote = -1;
  els.noteComposer.disabled = !bound;
  els.copyAllButton.disabled = !items.length;
  els.completeAllButton.disabled = !items.length;

  els.noteList.innerHTML = '';
  items.forEach((text, i) => {
    const item = document.createElement('li');
    item.className = 'note-item';

    if (i === editingNote) {
      const input = document.createElement('textarea');
      input.id = 'noteEditInput';
      input.className = 'note-composer note-edit-input';
      input.rows = 1;
      input.value = text;
      input.addEventListener('input', () => autoGrow(input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commitEdit(i, input.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit();
        }
      });
      input.addEventListener('blur', () => commitEdit(i, input.value));
      item.appendChild(input);
      els.noteList.appendChild(item);
      return;
    }

    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = 'note-btn tick';
    tick.title = 'Complete';
    tick.setAttribute('aria-label', 'Complete');
    tick.innerHTML = icon('M20 6 9 17l-5-5');
    tick.addEventListener('click', () => tickNote(i));

    const label = document.createElement('span');
    label.className = 'note-text';
    label.textContent = text;
    label.title = 'Click to edit';
    label.addEventListener('click', () => startEdit(i));

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'note-btn copy';
    copy.title = 'Copy';
    copy.setAttribute('aria-label', 'Copy');
    copy.innerHTML = icon('M9 9h11v11H9z', 'M5 15H4V4h11v1');
    copy.addEventListener('click', () => copyText(text, copy));

    item.append(tick, label, copy);
    els.noteList.appendChild(item);
  });
}

// Build an inline SVG icon from one or more path "d" strings.
function icon(...paths) {
  const d = paths.map((p) => `<path d="${p}"/>`).join('');
  return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
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

// --- Persistence -----------------------------------------------------------

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.save(state), SAVE_DELAY);
}
