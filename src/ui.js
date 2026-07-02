// ui.js
// Wires the side panel DOM to the storage and project modules.
// Owns the in-memory state, the debounced autosave, and the project combobox.
//
// Every editable list (notes, schedule, tasks, distractions) shares one
// interaction model, driven by the MODULES table below: a persistent compose
// line at the end adds an entry (Enter commits; Shift+Enter is a newline on
// the multi-line lists only); a committed line is single-click-to-edit,
// double-click-to-delete, with copy/delete buttons and (on schedule/tasks) a
// drag handle revealed on hover. Tasks alone add a leading number that
// doubles as a done-tick. See newtab.js for the same model applied to the
// global lists on the full-page view.

import * as storage from './storage.js';
import * as projects from './projects.js';

const SAVE_DELAY = 400; // ms to debounce autosave writes
const FLASH_MS = 900; // how long a "Copied" confirmation shows
const CLICK_DELAY = 220; // ms to wait for a second click before starting an edit

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const ICON_COPY = `${SVG_OPEN}<path d="M9 9h11v11H9z"/><path d="M5 15H4V4h11v1"/></svg>`;
const ICON_CLEAR = `${SVG_OPEN}<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const ICON_TICK = `${SVG_OPEN}<path d="M20 6 9 17l-5-5"/></svg>`;
const ICON_GRIP =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">' +
  '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>' +
  '<circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>' +
  '<circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

const els = {
  projectInput: document.getElementById('projectInput'),
  projectListbox: document.getElementById('projectListbox'),
  undoButton: document.getElementById('undoButton'),
  newtabLink: document.getElementById('newtabLink'),
  copyAllButton: document.getElementById('copyAllButton'),
  completeAllButton: document.getElementById('completeAllButton'),
  noteList: document.getElementById('noteList'),
  noteComposeItem: document.getElementById('noteComposeItem'),
  noteComposeRow: document.getElementById('noteComposeRow'),
  dayDate: document.getElementById('dayDate'),
  scheduleList: document.getElementById('scheduleList'),
  scheduleComposeItem: document.getElementById('scheduleComposeItem'),
  scheduleComposeRow: document.getElementById('scheduleComposeRow'),
  taskList: document.getElementById('taskList'),
  taskComposeItem: document.getElementById('taskComposeItem'),
  taskComposeRow: document.getElementById('taskComposeRow'),
  removedSection: document.getElementById('removedSection'),
  removedSummary: document.getElementById('removedSummary'),
  removedList: document.getElementById('removedList'),
  distractionList: document.getElementById('distractionList'),
  distractionComposeItem: document.getElementById('distractionComposeItem'),
  distractionComposeRow: document.getElementById('distractionComposeRow')
};

let state = projects.emptyState();
let windowId = null;
let currentProject = null;
let saveTimer = null;
let workspaceTimer = null; // debounce for auto-capturing the tab snapshot

let editing = null; // { key, index } of the line being edited, or null
let dragSource = null; // { key, index } of the line being dragged, or null

// Undo: snapshots of state taken before each content edit (this window only).
const UNDO_LIMIT = 50;
const undoStack = [];

// Combobox state.
let comboOpen = false;
let comboRows = []; // [{ kind:'project'|'create'|'hint', name?, text? }]
let highlight = -1; // index into comboRows of the active row

// The four editable lists in the panel, unified: same compose/render/edit/
// delete/copy behaviour, differing only in where they read and write, whether
// their compose line is multi-line, and whether they're numbered/reorderable.
const MODULES = {
  notes: {
    key: 'notes',
    listEl: els.noteList,
    composeItemEl: els.noteComposeItem,
    composeRowEl: els.noteComposeRow,
    placeholder: 'Notes…',
    disabledPlaceholder: 'Pick a project first',
    multiline: true,
    disabled: () => !currentProject,
    getItems: () => (currentProject ? projects.getProject(state, currentProject).notes || [] : []),
    getText: (item) => item,
    add: (text) => projects.addNote(state, currentProject, text),
    removeAt: (i) => projects.removeNote(state, currentProject, i),
    editAt: (i, text) => projects.editNote(state, currentProject, i, text)
  },
  schedule: {
    key: 'schedule',
    listEl: els.scheduleList,
    composeItemEl: els.scheduleComposeItem,
    composeRowEl: els.scheduleComposeRow,
    placeholder: 'Schedule…',
    reorder: true,
    getItems: () => state.schedule || [],
    getText: (item) => item.text,
    add: (text) => projects.addToList(state, 'schedule', text),
    removeAt: (i) => projects.removeFromList(state, 'schedule', i),
    editAt: (i, text) => projects.editListItem(state, 'schedule', i, text),
    moveAt: (from, to) => projects.moveListItem(state, 'schedule', from, to)
  },
  tasks: {
    key: 'tasks',
    listEl: els.taskList,
    composeItemEl: els.taskComposeItem,
    composeRowEl: els.taskComposeRow,
    placeholder: 'Task…',
    numbered: true,
    reorder: true,
    getItems: () => state.tasks || [],
    getText: (item) => item.text,
    isDone: (item) => item.done,
    add: (text) => projects.addToList(state, 'tasks', text),
    removeAt: (i) => projects.removeFromList(state, 'tasks', i),
    editAt: (i, text) => projects.editListItem(state, 'tasks', i, text),
    moveAt: (from, to) => projects.moveListItem(state, 'tasks', from, to),
    toggleAt: (i) => projects.toggleListItem(state, 'tasks', i)
  },
  distractions: {
    key: 'distractions',
    listEl: els.distractionList,
    composeItemEl: els.distractionComposeItem,
    composeRowEl: els.distractionComposeRow,
    placeholder: 'Distractions…',
    getItems: () => state.distractions || [],
    getText: (item) => item,
    add: (text) => projects.addDistraction(state, text),
    removeAt: (i) => projects.removeDistraction(state, i),
    editAt: (i, text) => projects.editDistraction(state, i, text)
  }
};

init().catch((error) => {
  console.error(error);
});

async function init() {
  const win = await chrome.windows.getCurrent();
  windowId = String(win.id);
  connectPanelPort(win.id);

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

// Tell the background service worker this window's panel is open, so it can
// clear the "not open" toolbar-badge dot. Reconnects if the worker restarts
// underneath us (a disconnect while the panel itself is still alive); if the
// panel actually closes, execution stops here and nothing reconnects.
function connectPanelPort(numericWindowId) {
  const port = chrome.runtime.connect({ name: `sidepanel:${numericWindowId}` });
  port.onDisconnect.addListener(() => connectPanelPort(numericWindowId));
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
  // Now the actual Chrome new-tab page, so opening a fresh tab is enough.
  // Renaming and archiving live there too (see newtab.js) — the sidebar is
  // just the project switcher.
  els.newtabLink.addEventListener('click', () => {
    chrome.tabs.create({});
  });

  els.copyAllButton.addEventListener('click', copyAllNotes);
  els.completeAllButton.addEventListener('click', clearAllNotes);

  Object.values(MODULES).forEach(bindModule);

  bindTabWatch();
}

// Auto-capture this window's tab snapshot whenever its tabs change.
function bindTabWatch() {
  const here = (winId) => String(winId) === windowId;
  chrome.tabs.onCreated.addListener((tab) => {
    if (here(tab.windowId)) scheduleWorkspaceCapture();
  });
  chrome.tabs.onRemoved.addListener((id, info) => {
    if (here(info.windowId)) scheduleWorkspaceCapture();
  });
  chrome.tabs.onUpdated.addListener((id, change, tab) => {
    if (change.url && here(tab.windowId)) scheduleWorkspaceCapture();
  });
  chrome.tabs.onAttached.addListener((id, info) => {
    if (here(info.newWindowId)) scheduleWorkspaceCapture();
  });
  chrome.tabs.onDetached.addListener((id, info) => {
    if (here(info.oldWindowId)) scheduleWorkspaceCapture();
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
      } else if (row.kind === 'create') {
        li.classList.add('combo-action');
        li.textContent = `Create "${row.name}"`;
      } else if (row.kind === 'create-new') {
        li.classList.add('combo-action');
        li.textContent = '+ Create new project';
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
  else if (row.kind === 'create-new') startCreateNew();
}

// Clear the box (keeping the dropdown open and focused) so the cursor is ready
// for the user to type a new project's name — the discoverable alternative to
// already knowing you can just type a novel name. renderList()'s default
// highlight lands on the current project (since the box is now "resting"), which
// visually looks like it just selected that project — override it to nothing
// highlighted, since the point here is starting fresh.
function startCreateNew() {
  els.projectInput.value = '';
  renderList();
  setHighlight(-1);
  els.projectInput.focus();
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

// --- Editable lists (notes, schedule, tasks, distractions) ------------------
//
// One model for all four: a persistent compose line commits new entries on
// Enter; a committed line is single-click-to-edit, double-click-to-delete,
// with copy/delete buttons revealed on hover (plus a drag handle for the
// reorderable lists). See buildRow/bindModule below.

function bindModule(mod) {
  const row = mod.composeRowEl;
  if (mod.multiline) row.addEventListener('input', () => autoGrow(row));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitCompose(mod);
    } else if (e.key === 'Backspace' && atStart(row)) {
      pullBack(mod, e);
    }
  });

  // Click anywhere in the list's blank space (not an existing line, or the
  // compose row itself) to jump the cursor into the write-line. Don't steal
  // an active text selection (so manual copy-by-drag still works).
  mod.listEl.addEventListener('click', (e) => {
    if (e.target.closest('.note-item') || e.target === row) return;
    if (window.getSelection().toString()) return;
    row.focus();
    const len = row.value.length;
    row.setSelectionRange(len, len);
  });
}

// Commit the compose row as a new entry; keep focus so the next line is ready.
function commitCompose(mod) {
  if (mod.disabled && mod.disabled()) return;
  const row = mod.composeRowEl;
  if (!row.value.trim()) return;
  pushUndo();
  mod.add(row.value);
  row.value = '';
  if (mod.multiline) autoGrow(row);
  scheduleSave();
  renderModule(mod);
}

// Backspace at the start of the compose line merges the previous line back in
// (its text + the compose text), caret at the join — like a text editor.
function pullBack(mod, event) {
  const items = mod.getItems();
  if (!items.length) return;
  event.preventDefault();
  pushUndo();
  const row = mod.composeRowEl;
  const prev = mod.getText(items[items.length - 1]);
  mod.removeAt(items.length - 1);
  const combined = prev + row.value;
  scheduleSave();
  renderModule(mod);
  row.value = combined;
  if (mod.multiline) autoGrow(row);
  row.focus();
  row.setSelectionRange(prev.length, prev.length);
}

// Rebuild only the committed rows; the compose row at the end is persistent so
// in-progress text and focus survive a re-render.
function renderModule(mod) {
  const items = mod.getItems();
  const disabled = mod.disabled ? mod.disabled() : false;
  mod.composeRowEl.disabled = disabled;
  mod.composeRowEl.placeholder = disabled
    ? mod.disabledPlaceholder || ''
    : items.length
      ? ''
      : mod.placeholder;

  mod.listEl.querySelectorAll('.note-item').forEach((el) => el.remove());
  items.forEach((item, i) => {
    mod.listEl.insertBefore(buildRow(mod, item, i), mod.composeItemEl);
  });

  if (mod.key === 'notes') {
    els.copyAllButton.disabled = !items.length;
    els.completeAllButton.disabled = !items.length;
  }
}

// Build one committed line: an inline edit field while it's being edited, or
// plain text with hover copy/delete buttons (and, for reorderable lists, a
// hover drag handle) otherwise.
function buildRow(mod, item, index) {
  const li = document.createElement('li');
  li.className = 'note-item';
  const text = mod.getText(item);
  const done = mod.numbered && mod.isDone(item);
  if (done) li.classList.add('done');

  if (mod.reorder) li.appendChild(buildDragHandle(li, mod, index));

  if (mod.numbered) {
    const num = document.createElement('span');
    num.className = 'note-num';
    num.title = done ? 'Mark not done' : 'Mark done';
    if (done) num.innerHTML = ICON_TICK;
    else num.textContent = `${index + 1}.`;
    num.addEventListener('click', (e) => {
      e.stopPropagation();
      pushUndo();
      mod.toggleAt(index);
      scheduleSave();
      renderModule(mod);
    });
    li.appendChild(num);
  }

  if (editing && editing.key === mod.key && editing.index === index) {
    const input = document.createElement('input');
    input.className = 'tile-edit';
    input.type = 'text';
    input.value = text;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit(mod, index, input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit(mod);
      }
    });
    input.addEventListener('blur', () => commitEdit(mod, index, input.value));
    li.appendChild(input);
  } else {
    const textEl = document.createElement('span');
    textEl.className = 'note-text';
    textEl.textContent = text;
    li.appendChild(textEl);
    li.title = 'Click to edit, double-click to delete';

    // Disambiguate single (edit) from double (delete) with a short timer.
    let clickTimer = null;
    li.addEventListener('click', (e) => {
      if (e.target.closest('.drag-handle, .note-num, .note-line-btn')) return;
      if (clickTimer) return; // second click handled by dblclick
      clickTimer = setTimeout(() => {
        clickTimer = null;
        startEdit(mod, index);
      }, CLICK_DELAY);
    });
    li.addEventListener('dblclick', (e) => {
      if (e.target.closest('.drag-handle, .note-num, .note-line-btn')) return;
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      deleteItem(mod, index);
    });

    const actions = document.createElement('span');
    actions.className = 'note-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'note-line-btn';
    copyBtn.title = 'Copy';
    copyBtn.setAttribute('aria-label', 'Copy');
    copyBtn.innerHTML = ICON_COPY;
    copyBtn.addEventListener('click', () => copyText(text, copyBtn));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'note-line-btn';
    deleteBtn.title = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.innerHTML = ICON_CLEAR;
    deleteBtn.addEventListener('click', () => deleteItem(mod, index));

    actions.append(copyBtn, deleteBtn);
    li.appendChild(actions);
  }

  return li;
}

function buildDragHandle(li, mod, index) {
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.title = 'Drag to reorder';
  handle.setAttribute('aria-label', 'Drag to reorder');
  handle.innerHTML = ICON_GRIP;
  handle.draggable = true;

  handle.addEventListener('dragstart', (e) => {
    dragSource = { key: mod.key, index };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.setDragImage(li, 0, 0);
    li.classList.add('dragging');
  });
  handle.addEventListener('dragend', () => {
    dragSource = null;
    li.classList.remove('dragging');
    Array.from(mod.listEl.children).forEach((el) => el.classList.remove('drag-over'));
  });
  li.addEventListener('dragover', (e) => {
    if (!dragSource || dragSource.key !== mod.key) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    li.classList.add('drag-over');
  });
  li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
  li.addEventListener('drop', (e) => {
    if (!dragSource || dragSource.key !== mod.key) return;
    e.preventDefault();
    const from = dragSource.index;
    li.classList.remove('drag-over');
    if (from !== index) {
      pushUndo();
      mod.moveAt(from, index);
      scheduleSave();
      renderModule(mod);
    }
  });

  return handle;
}

// Click-to-edit: swap the line for an input focused at the end.
function startEdit(mod, index) {
  editing = { key: mod.key, index };
  renderModule(mod);
  const input = mod.listEl.querySelector('.tile-edit');
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function commitEdit(mod, index, value) {
  if (!editing || editing.key !== mod.key || editing.index !== index) return;
  editing = null;
  pushUndo();
  mod.editAt(index, value); // empty value removes the line
  scheduleSave();
  renderModule(mod);
}

function cancelEdit(mod) {
  editing = null;
  renderModule(mod);
}

// Double-click a line (or its delete button) to remove it.
function deleteItem(mod, index) {
  pushUndo();
  mod.removeAt(index);
  scheduleSave();
  renderModule(mod);
}

// Copy every note (one per line) without removing them.
function copyAllNotes() {
  const items = MODULES.notes.getItems();
  if (!items.length) return;
  copyText(items.join('\n'), els.copyAllButton);
}

// Clear all notes.
function clearAllNotes() {
  if (!currentProject) return;
  const items = MODULES.notes.getItems();
  if (!items.length) return;
  pushUndo();
  projects.clearNotes(state, currentProject);
  scheduleSave();
  renderModule(MODULES.notes);
}

// True when the caret sits at the very start of a field, with no selection.
function atStart(field) {
  return field.selectionStart === 0 && field.selectionEnd === 0;
}

// Copy text to the clipboard and briefly confirm on the element. The async
// Clipboard API can silently reject in a side panel if Chrome doesn't consider
// the document focused at that instant; fall back to the older execCommand
// approach (via a throwaway textarea) so the button still works either way.
async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    flash(button);
    return;
  } catch (error) {
    console.error('clipboard.writeText failed, falling back', error);
  }
  if (copyViaExecCommand(text)) flash(button);
}

function copyViaExecCommand(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (error) {
    console.error('execCommand copy fallback failed', error);
  }
  document.body.removeChild(textarea);
  return ok;
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

// Auto-capture the window's reopenable tabs as the project's workspace snapshot,
// debounced so a burst of tab changes coalesces into one write.
function scheduleWorkspaceCapture() {
  clearTimeout(workspaceTimer);
  workspaceTimer = setTimeout(captureWorkspaceNow, SAVE_DELAY);
}

async function captureWorkspaceNow() {
  if (!currentProject) return;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const reopenable = tabs.filter((t) => projects.isReopenable(t.url));
  state.projects[currentProject] = projects.captureWorkspace(
    projects.ensureProject(state, currentProject),
    reopenable,
    Date.now()
  );
  projects.setWorkspaceWindow(state, currentProject, windowId);
  await storage.save(state);
  renderRemoved();
}

// Reopen a removed tab in this window and drop it from the archive.
async function restoreTab(url) {
  await chrome.tabs.create({ url, windowId: Number(windowId) });
  state.projects[currentProject] = projects.unarchiveTab(
    projects.ensureProject(state, currentProject),
    url
  );
  await storage.save(state);
  renderRemoved();
}

// --- Rendering -------------------------------------------------------------

function renderAll() {
  // Reflect the window's project in Chrome's side-panel header. Project name
  // first so it survives truncation in the narrow header; plain 'Sid' when unbound.
  document.title = currentProject ? `${currentProject} — Sid` : 'Sid';
  renderProjectInput();
  renderDayHeader();
  Object.values(MODULES).forEach(renderModule);
  renderRemoved();
}

// The day/date label sits above the schedule.
function renderDayHeader() {
  els.dayDate.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
}

function renderProjectInput() {
  const bound = currentProject !== null;
  els.projectInput.placeholder = bound ? 'Project' : 'Pick or create a project';
  // Don't clobber what the user is typing into the open combobox.
  if (comboOpen && document.activeElement === els.projectInput) return;
  els.projectInput.value = bound ? currentProject : '';
}

// Resize a textarea to fit its content (so writing wraps across lines).
function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
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

// --- Undo ------------------------------------------------------------------

// Snapshot the whole state before a content edit so it can be reverted. Covers
// every list in the panel (notes, schedule, tasks, distractions).
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
