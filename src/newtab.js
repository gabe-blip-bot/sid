// newtab.js
// A standalone, full-page view of Sid's GLOBAL surfaces (day/date, schedule,
// tasks, distractions). It reads and writes the same chrome.storage state as the
// side panel, so the two stay in sync. No project/notes/tabs here.
//
// Rendering largely mirrors the panel's plain-text model (ui.js). Some logic is
// duplicated for this first cut; we'll extract a shared module only if it sticks.

import * as storage from './storage.js';
import * as projects from './projects.js';

const SAVE_DELAY = 400; // ms to debounce autosave writes
const FLASH_MS = 900; // how long a "copied" confirmation shows
const CLICK_DELAY = 220; // ms to wait for a second click before acting

const els = {
  dayDate: document.getElementById('dayDate'),
  scheduleList: document.getElementById('scheduleList'),
  scheduleInput: document.getElementById('scheduleInput'),
  taskList: document.getElementById('taskList'),
  taskInput: document.getElementById('taskInput'),
  distractionInput: document.getElementById('distractionInput'),
  distractionList: document.getElementById('distractionList')
};

let state = projects.emptyState();
let saveTimer = null;
let editingTile = null; // { key, index } of the planner line being edited, or null
let dragSource = null; // { key, index } of the schedule line being dragged, or null

init().catch((error) => console.error(error));

async function init() {
  state = projects.normaliseState(await storage.load());
  renderAll();
  bindEvents();

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
  renderDistractions();
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
    li.className = 'planner-item';

    if (numbered) {
      const num = document.createElement('span');
      num.className = 'planner-num';
      num.textContent = `${i + 1}.`;
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

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.save(state), SAVE_DELAY);
}
