// newtab.js
// A full-page view of Sid's GLOBAL surfaces, laid out as a responsive grid of
// uniform modules: Schedule, Tasks, Scratchpad, and Distractions all share the
// same interaction — a persistent compose line, single-click-to-edit a
// committed line, double-click to delete it, copy/delete buttons revealed on
// hover, and (schedule/tasks) a drag handle to reorder. Tasks alone add a
// leading number that doubles as a done-tick. This is the same model as the
// side panel's lists (see ui.js). Projects is the one exception — click an
// active project's name to rename it, or use its Archive/Restore button.
// Backups is a separate, collapsible utility list below the grid. Reads/writes
// the same chrome.storage state as the side panel, so the two stay in sync.
// No per-project notes or tabs here.

import * as storage from './storage.js';
import * as projects from './projects.js';

const SAVE_DELAY = 400; // ms to debounce autosave writes
const FLASH_MS = 900; // how long a "copied" confirmation shows
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
  dayDate: document.getElementById('dayDate'),
  scheduleList: document.getElementById('scheduleList'),
  scheduleComposeItem: document.getElementById('scheduleComposeItem'),
  scheduleComposeRow: document.getElementById('scheduleComposeRow'),
  taskList: document.getElementById('taskList'),
  taskComposeItem: document.getElementById('taskComposeItem'),
  taskComposeRow: document.getElementById('taskComposeRow'),
  scratchpadList: document.getElementById('scratchpadList'),
  scratchpadComposeItem: document.getElementById('scratchpadComposeItem'),
  scratchpadComposeRow: document.getElementById('scratchpadComposeRow'),
  distractionList: document.getElementById('distractionList'),
  distractionComposeItem: document.getElementById('distractionComposeItem'),
  distractionComposeRow: document.getElementById('distractionComposeRow'),
  projectsSection: document.getElementById('projectsSection'),
  projectsSummary: document.getElementById('projectsSummary'),
  projectsList: document.getElementById('projectsList'),
  backupsSection: document.getElementById('backupsSection'),
  backupsSummary: document.getElementById('backupsSummary'),
  backupsList: document.getElementById('backupsList')
};

// The four "type in, list out" modules, unified: same compose/render/edit/
// delete/copy behaviour, differing only in where they read/write and whether
// their lines are numbered/reorderable (tasks) or reorderable (schedule).
// Schedule/tasks keep the {text, done} tile shape (shared with the side
// panel's own planner).
const MODULES = {
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
  scratchpad: {
    key: 'scratchpad',
    listEl: els.scratchpadList,
    composeItemEl: els.scratchpadComposeItem,
    composeRowEl: els.scratchpadComposeRow,
    placeholder: 'Notes…',
    multiline: true,
    getItems: () => state.notepad || [],
    getText: (item) => item,
    add: (text) => projects.addScratchpadNote(state, text),
    removeAt: (i) => projects.removeScratchpadNote(state, i),
    editAt: (i, text) => projects.editScratchpadNote(state, i, text)
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

let state = projects.emptyState();
let saveTimer = null;
let editing = null; // { key, index } of the line being edited, or null
let dragSource = null; // { key, index } of the line being dragged, or null
let editingProject = null; // name of the project being renamed inline, or null

init().catch((error) => console.error(error));

async function init() {
  state = projects.normaliseState(await storage.load());
  renderAll();
  bindEvents();
  renderBackups();

  // Stay live alongside the side panel (and any other window).
  storage.onChange((incoming) => {
    state = projects.normaliseState(incoming);
    renderAll();
  });
}

function bindEvents() {
  Object.values(MODULES).forEach(bindModule);
}

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
  // an active text selection.
  mod.listEl.addEventListener('click', (e) => {
    if (e.target.closest('.note-item') || e.target === row) return;
    if (window.getSelection().toString()) return;
    row.focus();
    const len = row.value.length;
    row.setSelectionRange(len, len);
  });
}

function renderAll() {
  renderHeader();
  Object.values(MODULES).forEach(renderModule);
  renderProjects();
}

function renderHeader() {
  els.dayDate.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

// True when the caret sits at the very start of a field, with no selection.
function atStart(field) {
  return field.selectionStart === 0 && field.selectionEnd === 0;
}

// Rebuild only the committed rows; the compose row at the end is persistent so
// in-progress text and focus survive a re-render.
function renderModule(mod) {
  const items = mod.getItems();
  mod.composeRowEl.placeholder = items.length ? '' : mod.placeholder;

  mod.listEl.querySelectorAll('.note-item').forEach((el) => el.remove());
  items.forEach((item, i) => {
    mod.listEl.insertBefore(buildRow(mod, item, i), mod.composeItemEl);
  });
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
  mod.removeAt(index);
  scheduleSave();
  renderModule(mod);
}

function commitCompose(mod) {
  const row = mod.composeRowEl;
  if (!row.value.trim()) return;
  mod.add(row.value);
  row.value = '';
  if (mod.multiline) autoGrow(row);
  scheduleSave();
  renderModule(mod);
}

// Backspace at the start of the compose line merges the previous line back in
// (its text + the compose text), caret at the join.
function pullBack(mod, event) {
  const items = mod.getItems();
  if (!items.length) return;
  event.preventDefault();
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

// Resize a textarea to fit its content (so writing wraps across lines).
function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// --- Projects (rename + archive live here, not in the side panel) ----------

// Active projects first (click the name to rename inline), then archived ones
// (Restore brings them back). There's no "current project" on this page — every
// action here names the project explicitly.
function renderProjects() {
  const active = projects.projectNames(state);
  const archived = projects.archivedNames(state);
  els.projectsSection.hidden = active.length + archived.length === 0;

  els.projectsList.innerHTML = '';
  active.forEach((name) => els.projectsList.appendChild(buildProjectRow(name, false)));
  archived.forEach((name) => els.projectsList.appendChild(buildProjectRow(name, true)));
}

function buildProjectRow(name, isArchived) {
  const li = document.createElement('li');
  li.className = 'removed-item';

  const meta = document.createElement('div');
  meta.className = 'removed-meta';

  if (editingProject === name && !isArchived) {
    const input = document.createElement('input');
    input.id = 'projectRenameInput';
    input.className = 'project-rename-edit';
    input.type = 'text';
    input.value = name;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitProjectRename(name, input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        editingProject = null;
        renderProjects();
      }
    });
    input.addEventListener('blur', () => commitProjectRename(name, input.value));
    meta.appendChild(input);
    li.appendChild(meta);
  } else {
    const title = document.createElement('div');
    title.className = `removed-title${isArchived ? ' is-archived' : ' editable'}`;
    title.textContent = name;
    if (!isArchived) {
      title.title = 'Click to rename';
      title.addEventListener('click', () => startProjectRename(name));
    }
    meta.appendChild(title);
    li.appendChild(meta);

    const action = document.createElement('button');
    action.type = 'button';
    if (isArchived) {
      action.textContent = 'Restore';
      action.addEventListener('click', () => {
        projects.restoreProject(state, name);
        scheduleSave();
        renderProjects();
      });
    } else {
      action.textContent = 'Archive';
      action.addEventListener('click', () => {
        projects.archiveProject(state, name);
        scheduleSave();
        renderProjects();
      });
    }
    li.appendChild(action);
  }

  return li;
}

function startProjectRename(name) {
  editingProject = name;
  renderProjects();
  const input = document.getElementById('projectRenameInput');
  if (input) {
    input.focus();
    input.select();
  }
}

function commitProjectRename(oldName, value) {
  editingProject = null;
  const clean = projects.normaliseName(value);
  // renameProject switches to an existing name rather than merging.
  if (clean && clean !== oldName) {
    projects.renameProject(state, oldName, clean);
    scheduleSave();
  }
  renderProjects();
}

// --- Backups -----------------------------------------------------------

// One automatic snapshot per day (see storage.js); each Restore replaces the
// live state with that day's snapshot, which then syncs to every open window.
async function renderBackups() {
  const dates = await storage.listBackups();
  els.backupsSection.hidden = dates.length === 0;
  els.backupsSummary.textContent = `Backups (${dates.length})`;

  els.backupsList.innerHTML = '';
  dates.forEach((date) => {
    const li = document.createElement('li');
    li.className = 'removed-item';

    const meta = document.createElement('div');
    meta.className = 'removed-meta';
    const title = document.createElement('div');
    title.className = 'removed-title';
    title.textContent = date;
    meta.appendChild(title);
    li.appendChild(meta);

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.textContent = 'Restore';
    restore.addEventListener('click', () => {
      const ok = confirm(`Restore the ${date} backup? This replaces everything currently saved.`);
      if (ok) storage.restoreBackup(date);
    });
    li.appendChild(restore);

    els.backupsList.appendChild(li);
  });
}

// Copy text to the clipboard and briefly confirm on the element. The async
// Clipboard API can silently reject if the document isn't considered focused;
// fall back to the older execCommand approach so the button still works.
async function copyText(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    flash(el);
    return;
  } catch (error) {
    console.error('clipboard.writeText failed, falling back', error);
  }
  if (copyViaExecCommand(text)) flash(el);
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

function flash(el) {
  if (el.dataset.flashing) return;
  el.dataset.flashing = '1';
  el.classList.add('copied');
  setTimeout(() => {
    el.classList.remove('copied');
    delete el.dataset.flashing;
  }, FLASH_MS);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.save(state), SAVE_DELAY);
}
