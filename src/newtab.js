// newtab.js
// A full-page view of Sid's GLOBAL surfaces, laid out as a responsive grid of
// uniform modules: Schedule, Tasks (numbered), Scratchpad, Distractions, and
// Projects all share the same design — a persistent compose line, committed
// lines with hover copy/clear buttons, click-anywhere-to-type. Backups is a
// separate, collapsible utility list below the grid. Reads/writes the same
// chrome.storage state as the side panel, so the two stay in sync. No
// per-project notes or tabs here.

import * as storage from './storage.js';
import * as projects from './projects.js';

const SAVE_DELAY = 400; // ms to debounce autosave writes
const FLASH_MS = 900; // how long a "copied" confirmation shows

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const ICON_COPY = `${SVG_OPEN}<path d="M9 9h11v11H9z"/><path d="M5 15H4V4h11v1"/></svg>`;
const ICON_CLEAR = `${SVG_OPEN}<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

const els = {
  dayDate: document.getElementById('dayDate'),
  scheduleSection: document.getElementById('scheduleSection'),
  scheduleList: document.getElementById('scheduleList'),
  scheduleComposeItem: document.getElementById('scheduleComposeItem'),
  scheduleComposeRow: document.getElementById('scheduleComposeRow'),
  taskSection: document.getElementById('taskSection'),
  taskList: document.getElementById('taskList'),
  taskComposeItem: document.getElementById('taskComposeItem'),
  taskComposeRow: document.getElementById('taskComposeRow'),
  scratchpadSection: document.getElementById('scratchpadSection'),
  scratchpadList: document.getElementById('scratchpadList'),
  scratchpadComposeItem: document.getElementById('scratchpadComposeItem'),
  scratchpadComposeRow: document.getElementById('scratchpadComposeRow'),
  distractionSection: document.getElementById('distractionSection'),
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

// The four "type in, list out" modules, unified: same compose/render/hover-
// button behaviour, differing only in where they read/write and whether their
// lines are numbered (tasks). Schedule/tasks keep the {text, done} tile shape
// (shared with the side panel's own planner) but this page ignores `done`.
const MODULES = {
  schedule: {
    sectionEl: els.scheduleSection,
    listEl: els.scheduleList,
    composeItemEl: els.scheduleComposeItem,
    composeRowEl: els.scheduleComposeRow,
    placeholder: 'Schedule…',
    numbered: false,
    getItems: () => state.schedule || [],
    getText: (item) => item.text,
    add: (text) => projects.addToList(state, 'schedule', text),
    removeAt: (i) => projects.removeFromList(state, 'schedule', i)
  },
  tasks: {
    sectionEl: els.taskSection,
    listEl: els.taskList,
    composeItemEl: els.taskComposeItem,
    composeRowEl: els.taskComposeRow,
    placeholder: 'Task…',
    numbered: true,
    getItems: () => state.tasks || [],
    getText: (item) => item.text,
    add: (text) => projects.addToList(state, 'tasks', text),
    removeAt: (i) => projects.removeFromList(state, 'tasks', i)
  },
  scratchpad: {
    sectionEl: els.scratchpadSection,
    listEl: els.scratchpadList,
    composeItemEl: els.scratchpadComposeItem,
    composeRowEl: els.scratchpadComposeRow,
    placeholder: 'Notes…',
    numbered: false,
    getItems: () => state.notepad || [],
    getText: (item) => item,
    add: (text) => projects.addScratchpadNote(state, text),
    removeAt: (i) => projects.removeScratchpadNote(state, i)
  },
  distractions: {
    sectionEl: els.distractionSection,
    listEl: els.distractionList,
    composeItemEl: els.distractionComposeItem,
    composeRowEl: els.distractionComposeRow,
    placeholder: 'Distractions…',
    numbered: false,
    getItems: () => state.distractions || [],
    getText: (item) => item,
    add: (text) => projects.addDistraction(state, text),
    removeAt: (i) => projects.removeDistraction(state, i)
  }
};

let state = projects.emptyState();
let saveTimer = null;
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
  row.addEventListener('input', () => autoGrow(row));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitModule(mod);
    } else if (e.key === 'Backspace' && atStart(row)) {
      pullBackModule(mod, e);
    }
  });
  // Click anywhere in the module (a committed line, or blank space) to start
  // typing, without stealing an active text selection.
  mod.sectionEl.addEventListener('click', (e) => {
    if (e.target.closest('.note-line-btn') || e.target === row) return;
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
    const text = mod.getText(item);
    const li = document.createElement('li');
    li.className = 'note-item';

    const textEl = document.createElement('span');
    textEl.className = 'note-text';
    textEl.textContent = mod.numbered ? `${i + 1}. ${text}` : text;

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
    clearBtn.addEventListener('click', () => {
      mod.removeAt(i);
      scheduleSave();
      renderModule(mod);
    });

    actions.append(copyBtn, clearBtn);
    li.append(textEl, actions);
    mod.listEl.insertBefore(li, mod.composeItemEl);
  });
}

function commitModule(mod) {
  const row = mod.composeRowEl;
  if (!row.value.trim()) return;
  mod.add(row.value);
  row.value = '';
  autoGrow(row);
  scheduleSave();
  renderModule(mod);
}

// Backspace at the start of the compose line merges the previous line back in
// (its text + the compose text), caret at the join.
function pullBackModule(mod, event) {
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
  autoGrow(row);
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
