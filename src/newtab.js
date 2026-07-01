// newtab.js
// A standalone, full-page view of Sid's GLOBAL surfaces (day/date, schedule,
// tasks, a scratchpad, distractions), plus project management (rename/archive)
// and backups. It reads and writes the same chrome.storage state as the side
// panel, so the two stay in sync. No per-project notes or tabs here.
//
// Rendering largely mirrors the panel's plain-text model (ui.js). Some logic is
// duplicated for this first cut; we'll extract a shared module only if it sticks.

import * as storage from './storage.js';
import * as projects from './projects.js';

const SAVE_DELAY = 400; // ms to debounce autosave writes
const FLASH_MS = 900; // how long a "copied" confirmation shows
const CLICK_DELAY = 220; // ms to wait for a second click before acting

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const ICON_COPY = `${SVG_OPEN}<path d="M9 9h11v11H9z"/><path d="M5 15H4V4h11v1"/></svg>`;
const ICON_CLEAR = `${SVG_OPEN}<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const ICON_TICK = `${SVG_OPEN}<path d="M20 6 9 17l-5-5"/></svg>`;

const els = {
  dayDate: document.getElementById('dayDate'),
  scheduleList: document.getElementById('scheduleList'),
  scheduleInput: document.getElementById('scheduleInput'),
  taskList: document.getElementById('taskList'),
  taskInput: document.getElementById('taskInput'),
  scratchpadSection: document.getElementById('scratchpadSection'),
  scratchpadList: document.getElementById('scratchpadList'),
  scratchpadComposeItem: document.getElementById('scratchpadComposeItem'),
  scratchpadComposeRow: document.getElementById('scratchpadComposeRow'),
  distractionInput: document.getElementById('distractionInput'),
  distractionList: document.getElementById('distractionList'),
  projectsSection: document.getElementById('projectsSection'),
  projectsSummary: document.getElementById('projectsSummary'),
  projectsList: document.getElementById('projectsList'),
  backupsSection: document.getElementById('backupsSection'),
  backupsSummary: document.getElementById('backupsSummary'),
  backupsList: document.getElementById('backupsList')
};

let state = projects.emptyState();
let saveTimer = null;
let editingTile = null; // { key, index } of the planner line being edited, or null
let dragSource = null; // { key, index } of the schedule line being dragged, or null
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
  // Schedule + tasks: type on the trailing line, Enter adds. On the schedule
  // line, Backspace at the start pulls the previous item back to edit.
  els.scheduleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && atStart(els.scheduleInput)) {
      pullBackListItem(e, els.scheduleInput, 'schedule');
    } else {
      addOnEnter(e, els.scheduleInput, 'schedule');
    }
  });
  els.taskInput.addEventListener('keydown', (e) => addOnEnter(e, els.taskInput, 'tasks'));

  // Scratchpad: same raw-notepad model as the side panel's notes, but global.
  els.scratchpadComposeRow.addEventListener('input', () => autoGrow(els.scratchpadComposeRow));
  els.scratchpadComposeRow.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitScratchpad();
    } else if (e.key === 'Backspace' && atStart(els.scratchpadComposeRow)) {
      pullBackScratchpad(e);
    }
  });
  // Click anywhere in the scratchpad (a committed line, or blank space) to
  // start typing, without stealing an active text selection.
  els.scratchpadSection.addEventListener('click', (e) => {
    if (e.target.closest('.note-line-btn') || e.target === els.scratchpadComposeRow) return;
    if (window.getSelection().toString()) return;
    els.scratchpadComposeRow.focus();
    const len = els.scratchpadComposeRow.value.length;
    els.scratchpadComposeRow.setSelectionRange(len, len);
  });

  // Distractions: always shown on this full page (no toggle) — Enter adds.
  els.distractionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (els.distractionInput.value.trim()) {
        projects.addDistraction(state, els.distractionInput.value);
        els.distractionInput.value = '';
        scheduleSave();
        renderDistractions();
      }
    }
  });
}

function renderAll() {
  renderHeader();
  renderPlanner();
  renderScratchpad();
  renderDistractions();
  renderProjects();
}

function renderHeader() {
  els.dayDate.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

// Add an item to a global list on Enter; the input stays as the next empty line.
function addOnEnter(event, input, key) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (!input.value.trim()) return;
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
  const prev = items[items.length - 1].text;
  projects.removeFromList(state, key, items.length - 1);
  input.value = prev + input.value;
  scheduleSave();
  renderPlanner();
  input.focus();
  input.setSelectionRange(prev.length, prev.length);
}

// True when the caret sits at the very start of a field, with no selection.
function atStart(field) {
  return field.selectionStart === 0 && field.selectionEnd === 0;
}

// Planner: schedule (left, plain) and tasks (right, numbered) — same behaviour as
// the side panel. Single-click a line edits it in place, double-click deletes,
// and lines can be dragged to reorder within their own column.
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
  const numbered = key === 'tasks';
  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = `planner-item${numbered && item.done ? ' done' : ''}`;

    if (numbered) {
      // The number doubles as a tick: click it to toggle done (immediate),
      // independent of the text's own click-to-edit.
      const num = document.createElement('span');
      num.className = 'planner-num';
      if (item.done) num.innerHTML = ICON_TICK;
      else num.textContent = `${i + 1}.`;
      num.title = item.done ? 'Mark not done' : 'Mark done';
      num.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTask(i);
      });
      li.appendChild(num);
    }

    if (editingTile && editingTile.key === key && editingTile.index === i) {
      const input = document.createElement('input');
      input.id = 'tileEditInput';
      input.className = 'tile-edit';
      input.type = 'text';
      input.value = item.text;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
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
      const text = document.createElement('span');
      text.className = 'planner-text';
      text.textContent = item.text;
      li.appendChild(text);
      li.title = 'Click to edit, double-click to delete';

      // Disambiguate single (edit) from double (delete) with a short timer.
      let clickTimer = null;
      li.addEventListener('click', () => {
        if (clickTimer) return; // second click handled by dblclick
        clickTimer = setTimeout(() => {
          clickTimer = null;
          startTileEdit(key, i);
        }, CLICK_DELAY);
      });
      li.addEventListener('dblclick', () => {
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = null;
        }
        deleteTile(key, i);
      });

      attachTileDrag(li, key, i);
    }

    listEl.appendChild(li);
  });
}

// The list element for a planner column, so drag handlers can clear highlights
// across the whole column regardless of which line they're attached to.
function listElFor(key) {
  return key === 'tasks' ? els.taskList : els.scheduleList;
}

// Click-to-edit: swap the line for an input focused at the end.
function startTileEdit(key, index) {
  editingTile = { key, index };
  renderPlanner();
  const input = document.getElementById('tileEditInput');
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function commitTileEdit(key, index, value) {
  if (!editingTile || editingTile.key !== key || editingTile.index !== index) return;
  editingTile = null;
  projects.editListItem(state, key, index, value); // empty value removes the line
  scheduleSave();
  renderPlanner();
}

function cancelTileEdit() {
  editingTile = null;
  renderPlanner();
}

// Double-click a line to delete it.
function deleteTile(key, index) {
  projects.removeFromList(state, key, index);
  scheduleSave();
  renderPlanner();
}

// Click a task's number to toggle its done/strikethrough state in place.
function toggleTask(index) {
  projects.toggleListItem(state, 'tasks', index);
  scheduleSave();
  renderPlanner();
}

// Drag-and-drop reorder for planner lines (schedule or tasks, each within its
// own column only).
function attachTileDrag(li, key, index) {
  li.draggable = true;
  li.addEventListener('dragstart', (e) => {
    dragSource = { key, index };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => {
    dragSource = null;
    li.classList.remove('dragging');
    Array.from(listElFor(key).children).forEach((el) => el.classList.remove('drag-over'));
  });
  li.addEventListener('dragover', (e) => {
    if (!dragSource || dragSource.key !== key) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    li.classList.add('drag-over');
  });
  li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
  li.addEventListener('drop', (e) => {
    if (!dragSource || dragSource.key !== key) return;
    e.preventDefault();
    const from = dragSource.index;
    li.classList.remove('drag-over');
    if (from !== index) {
      projects.moveListItem(state, key, from, index);
      scheduleSave();
      renderPlanner();
    }
  });
}

// --- Scratchpad (global raw notepad, same model as the side panel's notes) --

// Rebuild only the committed rows; the compose row at the end is persistent so
// in-progress text and focus survive a re-render.
function renderScratchpad() {
  const items = state.notepad || [];
  els.scratchpadComposeRow.placeholder = items.length ? '' : 'Notes…';

  els.scratchpadList.querySelectorAll('.note-item').forEach((el) => el.remove());
  items.forEach((text, i) => {
    const item = document.createElement('li');
    item.className = 'note-item';

    const textEl = document.createElement('span');
    textEl.className = 'note-text';
    textEl.textContent = text;

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
    clearBtn.addEventListener('click', () => deleteScratchpadNote(i));

    actions.append(copyBtn, clearBtn);
    item.append(textEl, actions);
    els.scratchpadList.insertBefore(item, els.scratchpadComposeItem);
  });
}

function commitScratchpad() {
  if (!els.scratchpadComposeRow.value.trim()) return;
  projects.addScratchpadNote(state, els.scratchpadComposeRow.value);
  els.scratchpadComposeRow.value = '';
  autoGrow(els.scratchpadComposeRow);
  scheduleSave();
  renderScratchpad();
}

function deleteScratchpadNote(index) {
  projects.removeScratchpadNote(state, index);
  scheduleSave();
  renderScratchpad();
}

// Backspace at the start of the compose line merges the previous line back in
// (its text + the compose text), caret at the join.
function pullBackScratchpad(event) {
  const items = state.notepad || [];
  if (!items.length) return;
  event.preventDefault();
  const prev = items[items.length - 1];
  projects.removeScratchpadNote(state, items.length - 1);
  const combined = prev + els.scratchpadComposeRow.value;
  scheduleSave();
  renderScratchpad();
  els.scratchpadComposeRow.value = combined;
  autoGrow(els.scratchpadComposeRow);
  els.scratchpadComposeRow.focus();
  els.scratchpadComposeRow.setSelectionRange(prev.length, prev.length);
}

// Resize a textarea to fit its content (so writing wraps across lines).
function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// Always visible on this full page — no toggle, just an add line and the list.
function renderDistractions() {
  const items = state.distractions || [];
  els.distractionInput.placeholder = items.length ? '' : 'Distractions…';

  els.distractionList.innerHTML = '';
  items.forEach((text, i) => {
    const li = document.createElement('li');
    li.className = 'planner-item';
    li.textContent = text;
    li.title = 'Click to copy, double-click to delete';

    let clickTimer = null;
    li.addEventListener('click', () => {
      if (clickTimer) return;
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
      removeDistraction(i);
    });

    els.distractionList.appendChild(li);
  });
}

function removeDistraction(index) {
  projects.removeDistraction(state, index);
  scheduleSave();
  renderDistractions();
}

// Copy text to the clipboard and briefly confirm on the element.
async function copyText(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    flash(el);
  } catch (error) {
    console.error(error);
  }
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

// --- Projects (rename + archive live here, not in the side panel) ----------

// Active projects first (click the name to rename inline), then archived ones
// (Restore brings them back). There's no "current project" on this page — every
// action here names the project explicitly.
function renderProjects() {
  const active = projects.projectNames(state);
  const archived = projects.archivedNames(state);
  els.projectsSection.hidden = active.length + archived.length === 0;
  els.projectsSummary.textContent = `Projects (${active.length})`;

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

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.save(state), SAVE_DELAY);
}
