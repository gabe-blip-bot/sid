// ui.js
// Wires the side panel DOM to the storage and project modules.
// Owns the in-memory state and the debounced autosave.

import * as storage from './storage.js';
import * as projects from './projects.js';
import { buildMarkdown, downloadMarkdown, fileName } from './export.js';

const SAVE_DELAY = 400; // ms to debounce writes
const DEFAULT_PROJECT = 'Untitled';

const els = {
  windowLabel: document.getElementById('windowLabel'),
  saveStatus: document.getElementById('saveStatus'),
  projectInput: document.getElementById('projectInput'),
  projectList: document.getElementById('projectList'),
  objectiveInput: document.getElementById('objectiveInput'),
  notesInput: document.getElementById('notesInput'),
  scratchpadInput: document.getElementById('scratchpadInput'),
  exportButton: document.getElementById('exportButton')
};

let state = projects.emptyState();
let windowId = null;
let currentProject = null; // name, or null when this window has no project yet
let saveTimer = null;

init().catch((error) => {
  console.error(error);
  setStatus('Error');
});

async function init() {
  const win = await chrome.windows.getCurrent();
  windowId = String(win.id);
  els.windowLabel.textContent = `Window ${windowId}`;

  state = projects.normaliseState(await storage.load());
  currentProject = projects.windowProject(state, windowId);

  renderProjectList();
  renderFields();
  bindEvents();
  setStatus('Saved');

  // Keep this panel in sync when another window edits the shared state.
  storage.onChange((incoming) => {
    state = projects.normaliseState(incoming);
    renderProjectList();
    renderFields({ preserveFocus: true });
  });
}

function bindEvents() {
  els.projectInput.addEventListener('change', () => selectProject(els.projectInput.value));

  els.objectiveInput.addEventListener('input', () => {
    activeProject().objective = els.objectiveInput.value;
    scheduleSave();
  });

  els.notesInput.addEventListener('input', () => {
    activeProject().notes = els.notesInput.value;
    scheduleSave();
  });

  els.scratchpadInput.addEventListener('input', () => {
    state.scratchpad = els.scratchpadInput.value;
    scheduleSave();
  });

  els.exportButton.addEventListener('click', exportMarkdown);
}

// Attach this window to the named project and load its fields.
function selectProject(rawName) {
  const name = projects.normaliseName(rawName);
  if (!name) {
    els.projectInput.value = currentProject || '';
    return;
  }

  currentProject = name;
  projects.attachWindow(state, windowId, name);
  renderProjectList();
  renderFields();
  scheduleSave();
}

// Return the current project's record, creating a default one if this window
// has nothing attached yet (so the first keystroke is never lost).
function activeProject() {
  if (!currentProject) {
    currentProject = DEFAULT_PROJECT;
    projects.attachWindow(state, windowId, currentProject);
    els.projectInput.value = currentProject;
    renderProjectList();
  }
  return projects.ensureProject(state, currentProject);
}

function renderProjectList() {
  els.projectList.innerHTML = '';
  for (const name of projects.projectNames(state)) {
    const option = document.createElement('option');
    option.value = name;
    els.projectList.appendChild(option);
  }
}

// Push state into the inputs. Skip a field the user is actively typing in so a
// remote update never yanks the cursor.
function renderFields({ preserveFocus = false } = {}) {
  const project = projects.getProject(state, currentProject);

  if (document.activeElement !== els.projectInput) {
    els.projectInput.value = currentProject || '';
  }
  if (!(preserveFocus && document.activeElement === els.objectiveInput)) {
    els.objectiveInput.value = project.objective || '';
  }
  if (!(preserveFocus && document.activeElement === els.notesInput)) {
    els.notesInput.value = project.notes || '';
  }
  if (!(preserveFocus && document.activeElement === els.scratchpadInput)) {
    els.scratchpadInput.value = state.scratchpad || '';
  }
}

function scheduleSave() {
  setStatus('Saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await storage.save(state);
    setStatus('Saved');
  }, SAVE_DELAY);
}

function setStatus(text) {
  els.saveStatus.textContent = text;
}

async function exportMarkdown() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const project = projects.getProject(state, currentProject);
  const markdown = buildMarkdown({
    project: currentProject,
    objective: project.objective,
    notes: project.notes,
    scratchpad: state.scratchpad,
    tabs
  });
  downloadMarkdown(fileName(currentProject), markdown);
}
