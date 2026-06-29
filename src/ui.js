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
  lastSaved: document.getElementById('lastSaved'),
  noteAddButton: document.getElementById('noteAddButton'),
  noteAddInput: document.getElementById('noteAddInput'),
  copyAllButton: document.getElementById('copyAllButton'),
  completeAllButton: document.getElementById('completeAllButton'),
  noteList: document.getElementById('noteList'),
  scratchpadInput: document.getElementById('scratchpadInput'),
  removedSection: document.getElementById('removedSection'),
  removedSummary: document.getElementById('removedSummary'),
  removedList: document.getElementById('removedList')
};

let state = projects.emptyState();
let windowId = null;
let currentProject = null;
let saveTimer = null;

// Note add/edit state.
let addingNote = false; // is the inline add field open
let editingNote = -1; // index of the note being edited inline, or -1

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
    renderAll({ preserveFocus: true });
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

  els.noteAddButton.addEventListener('click', openAdd);
  els.noteAddInput.addEventListener('keydown', onAddKey);
  els.noteAddInput.addEventListener('blur', closeAdd);
  els.copyAllButton.addEventListener('click', copyAllNotes);
  els.completeAllButton.addEventListener('click', completeAllNotes);

  els.scratchpadInput.addEventListener('input', () => {
    state.scratchpad = els.scratchpadInput.value;
    autoGrowScratch();
    scheduleSave();
  });

  for (const day of DAYS) {
    const input = document.getElementById(`theme-${day}`);
    input.addEventListener('input', () => {
      projects.setDayTheme(state, day, input.value);
      scheduleSave();
    });
  }
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

// Reveal the inline add field (the "+" button collapses into a text input).
function openAdd() {
  if (!currentProject) return;
  addingNote = true;
  renderAddRow();
  els.noteAddInput.focus();
}

function closeAdd() {
  addingNote = false;
  els.noteAddInput.value = '';
  renderAddRow();
}

function onAddKey(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (els.noteAddInput.value.trim() && currentProject) {
      projects.addNote(state, currentProject, els.noteAddInput.value);
      els.noteAddInput.value = '';
      scheduleSave();
      renderNotes(); // rebuilds only the list; the add field keeps focus
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeAdd();
  }
}

// Swap between the "+" button and the inline input.
function renderAddRow() {
  const bound = currentProject !== null;
  if (!bound) addingNote = false;
  els.noteAddButton.disabled = !bound;
  els.noteAddButton.hidden = addingNote;
  els.noteAddInput.hidden = !addingNote;
}

// Click a note to edit it in place.
function startEdit(index) {
  editingNote = index;
  renderNotes();
  const input = document.getElementById('noteEditInput');
  if (input) {
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

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    flash(button);
  } catch (error) {
    console.error(error);
  }
}

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

// Briefly confirm a copy: text buttons show "Copied", icon buttons flash green.
function flash(button) {
  if (button.dataset.flashing) return;
  button.dataset.flashing = '1';
  if (button.classList.contains('small')) {
    const label = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = label;
      delete button.dataset.flashing;
    }, FLASH_MS);
  } else {
    button.classList.add('copied');
    setTimeout(() => {
      button.classList.remove('copied');
      delete button.dataset.flashing;
    }, FLASH_MS);
  }
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
  renderWorkspace();
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

function renderAll({ preserveFocus = false } = {}) {
  renderProjectInput();
  renderNotes();
  renderWeek();
  renderScratchpad({ preserveFocus });
  renderWorkspace();
  renderRemoved();
}

// Show each day's theme and highlight today's row (Mon–Thu only).
function renderWeek() {
  const todayKey = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu' }[new Date().getDay()];
  for (const day of DAYS) {
    const input = document.getElementById(`theme-${day}`);
    if (document.activeElement !== input) {
      input.value = (state.dayThemes && state.dayThemes[day]) || '';
    }
    document.getElementById(`day-${day}`).classList.toggle('is-today', day === todayKey);
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
  renderAddRow();
  els.copyAllButton.disabled = !items.length;
  els.completeAllButton.disabled = !items.length;

  els.noteList.innerHTML = '';
  items.forEach((text, i) => {
    const item = document.createElement('li');
    item.className = 'note-item';

    if (i === editingNote) {
      const input = document.createElement('input');
      input.id = 'noteEditInput';
      input.className = 'input note-edit-input';
      input.type = 'text';
      input.value = text;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
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

// The scratchpad is global; it stays editable even while unbound.
function renderScratchpad({ preserveFocus = false } = {}) {
  if (!(preserveFocus && document.activeElement === els.scratchpadInput)) {
    els.scratchpadInput.value = state.scratchpad || '';
  }
  autoGrowScratch();
}

// Grow the scratchpad to fit its content, up to ~40% of the panel, then scroll.
function autoGrowScratch() {
  const el = els.scratchpadInput;
  el.style.height = 'auto';
  const max = Math.max(38, Math.round(window.innerHeight * 0.4));
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
}

function renderWorkspace() {
  if (!currentProject) {
    els.lastSaved.textContent = '';
    return;
  }
  const workspace = projects.getProject(state, currentProject).workspace;
  els.lastSaved.textContent = workspace
    ? `Last saved ${new Date(workspace.savedAt).toLocaleString()}`
    : 'Not saved yet';
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
