// ui.js
// Wires the side panel DOM to the storage and project modules.
// Owns the in-memory state and the debounced autosave.

import * as storage from './storage.js';
import * as projects from './projects.js';
import { buildMarkdown, downloadMarkdown, fileName } from './export.js';

const SAVE_DELAY = 400; // ms to debounce writes
const NEW_OPTION = '__new__'; // sentinel value for the "New project" choice

const els = {
  projectSwitch: document.getElementById('projectSwitch'),
  projectName: document.getElementById('projectName'),
  notesInput: document.getElementById('notesInput'),
  scratchpadInput: document.getElementById('scratchpadInput'),
  exportButton: document.getElementById('exportButton'),
  saveStatus: document.getElementById('saveStatus')
};

let state = projects.emptyState();
let windowId = null;
let currentProject = null;
let saveTimer = null;

init().catch((error) => {
  console.error(error);
  setStatus('Error');
});

async function init() {
  const win = await chrome.windows.getCurrent();
  windowId = String(win.id);

  state = projects.normaliseState(await storage.load());
  currentProject = projects.windowProject(state, windowId);

  // Every window always shows a project: keep its own, adopt an existing one,
  // or create the first default.
  if (!currentProject) {
    currentProject = projects.projectNames(state)[0] || projects.newProjectName(state);
    projects.attachWindow(state, windowId, currentProject);
    await storage.save(state);
  }

  renderProjects();
  renderFields();
  bindEvents();
  setStatus('Saved');

  // Keep this panel in sync when another window edits the shared state.
  storage.onChange((incoming) => {
    state = projects.normaliseState(incoming);
    currentProject = projects.windowProject(state, windowId) || currentProject;
    renderProjects();
    renderFields({ preserveFocus: true });
  });
}

function bindEvents() {
  els.projectSwitch.addEventListener('change', onSwitch);
  els.projectName.addEventListener('change', onRename);

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

// Dropdown: switch to an existing project, or create a fresh one.
function onSwitch() {
  if (els.projectSwitch.value === NEW_OPTION) {
    currentProject = projects.newProjectName(state);
    projects.attachWindow(state, windowId, currentProject);
    renderProjects();
    renderFields();
    scheduleSave();
    els.projectName.focus();
    els.projectName.select();
    return;
  }

  currentProject = els.projectSwitch.value;
  projects.attachWindow(state, windowId, currentProject);
  renderProjects();
  renderFields();
  scheduleSave();
}

// Name field: rename the current project (keeping its notes).
function onRename() {
  const newName = projects.normaliseName(els.projectName.value);
  if (!newName) {
    els.projectName.value = currentProject || '';
    return;
  }

  currentProject = projects.renameProject(state, currentProject, newName);
  projects.attachWindow(state, windowId, currentProject);
  renderProjects();
  renderFields();
  scheduleSave();
}

// Return the current project's record, creating one if somehow absent.
function activeProject() {
  if (!currentProject) {
    currentProject = projects.newProjectName(state);
    projects.attachWindow(state, windowId, currentProject);
    renderProjects();
  }
  return projects.ensureProject(state, currentProject);
}

function renderProjects() {
  els.projectSwitch.innerHTML = '';
  for (const name of projects.projectNames(state)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    els.projectSwitch.appendChild(option);
  }
  const newOption = document.createElement('option');
  newOption.value = NEW_OPTION;
  newOption.textContent = '+ New project';
  els.projectSwitch.appendChild(newOption);

  els.projectSwitch.value = currentProject || '';
  if (document.activeElement !== els.projectName) {
    els.projectName.value = currentProject || '';
  }
}

// Push state into the fields. Skip a field the user is actively typing in so a
// remote update never yanks the cursor.
function renderFields({ preserveFocus = false } = {}) {
  const project = projects.getProject(state, currentProject);

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
    notes: project.notes,
    scratchpad: state.scratchpad,
    tabs
  });
  downloadMarkdown(fileName(currentProject), markdown);
}
