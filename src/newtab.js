// newtab.js
// A standalone, full-page view of Sid's GLOBAL surfaces (day/date + theme,
// schedule, tasks, distractions). It reads and writes the same chrome.storage
// state as the side panel, so the two stay in sync. No project/notes/tabs here.
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
  dayThemeInput: document.getElementById('dayThemeInput'),
  scheduleList: document.getElementById('scheduleList'),
  scheduleInput: document.getElementById('scheduleInput'),
  taskList: document.getElementById('taskList'),
  taskInput: document.getElementById('taskInput'),
  distractionInput: document.getElementById('distractionInput'),
  distractionToggle: document.getElementById('distractionToggle'),
  distractionCount: document.getElementById('distractionCount'),
  distractionList: document.getElementById('distractionList')
};

let state = projects.emptyState();
let saveTimer = null;
let distractionsOpen = false; // whether the captured-distractions list is expanded

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
  // Theme: a single day-agnostic label, autosaved.
  els.dayThemeInput.addEventListener('input', () => {
    projects.setTheme(state, els.dayThemeInput.value);
    scheduleSave();
  });

  // Schedule + tasks: type on the trailing line, Enter adds.
  els.scheduleInput.addEventListener('keydown', (e) => addOnEnter(e, els.scheduleInput, 'schedule'));
  els.taskInput.addEventListener('keydown', (e) => addOnEnter(e, els.taskInput, 'tasks'));

  // Distractions: capture-and-hide; the chevron expands the review list.
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
  els.distractionToggle.addEventListener('click', () => {
    distractionsOpen = !distractionsOpen;
    renderDistractions();
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
  if (document.activeElement !== els.dayThemeInput) {
    els.dayThemeInput.value = state.theme || '';
  }
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

function renderPlanner() {
  renderColumn(els.scheduleList, state.schedule || [], 'schedule');
  renderColumn(els.taskList, state.tasks || [], 'tasks');
}

// Schedule: single-click copies. Tasks: single-click toggles done (in place).
// Both: double-click deletes.
function renderColumn(listEl, items, key) {
  listEl.innerHTML = '';
  const isTasks = key === 'tasks';
  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'planner-item';
    if (isTasks && item.done) li.classList.add('done');

    if (isTasks) {
      const num = document.createElement('span');
      num.className = 'planner-num';
      num.textContent = `${i + 1}.`;
      li.appendChild(num);
    }
    const text = document.createElement('span');
    text.className = 'planner-text';
    text.textContent = item.text;
    li.appendChild(text);

    li.title = isTasks
      ? 'Click to complete, double-click to delete'
      : 'Click to copy, double-click to delete';

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
      removeItem(key, i);
    });

    listEl.appendChild(li);
  });
}

function toggleTask(index) {
  projects.toggleListItem(state, 'tasks', index);
  scheduleSave();
  renderPlanner();
}

function removeItem(key, index) {
  projects.removeFromList(state, key, index);
  scheduleSave();
  renderPlanner();
}

function renderDistractions() {
  const items = state.distractions || [];
  const has = items.length > 0;
  if (!has) distractionsOpen = false;

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
