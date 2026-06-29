// ui.js
// Wires the side panel DOM to the storage and project modules.
// Owns the in-memory state and the debounced autosave.

import * as storage from './storage.js';
import * as projects from './projects.js';
import { buildMarkdown, downloadMarkdown, fileName } from './export.js';

const SAVE_DELAY = 400; // ms to debounce autosave writes
const NEW_OPTION = '__new__'; // sentinel value for the "New project" choice

const els = {
  projectSwitch: document.getElementById('projectSwitch'),
  projectName: document.getElementById('projectName'),
  notesInput: document.getElementById('notesInput'),
  scratchpadInput: document.getElementById('scratchpadInput'),
  lastSaved: document.getElementById('lastSaved'),
  saveProjectButton: document.getElementById('saveProjectButton'),
  openProjectButton: document.getElementById('openProjectButton'),
  removedSection: document.getElementById('removedSection'),
  removedSummary: document.getElementById('removedSummary'),
  removedList: document.getElementById('removedList'),
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

  renderAll();
  bindEvents();
  setStatus('Saved');

  // Keep this panel in sync when another window edits the shared state.
  storage.onChange((incoming) => {
    state = projects.normaliseState(incoming);
    currentProject = projects.windowProject(state, windowId) || currentProject;
    renderAll({ preserveFocus: true });
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

  els.saveProjectButton.addEventListener('click', saveProject);
  els.openProjectButton.addEventListener('click', openProject);
  els.exportButton.addEventListener('click', exportMarkdown);
}

// --- Project selection -----------------------------------------------------

// Dropdown: switch to an existing project, or create a fresh one.
function onSwitch() {
  if (els.projectSwitch.value === NEW_OPTION) {
    currentProject = projects.newProjectName(state);
    projects.attachWindow(state, windowId, currentProject);
    renderAll();
    scheduleSave();
    els.projectName.focus();
    els.projectName.select();
    return;
  }

  currentProject = els.projectSwitch.value;
  projects.attachWindow(state, windowId, currentProject);
  renderAll();
  scheduleSave();
}

// Name field: rename the current project (keeping its notes and workspace).
function onRename() {
  const newName = projects.normaliseName(els.projectName.value);
  if (!newName) {
    els.projectName.value = currentProject || '';
    return;
  }

  currentProject = projects.renameProject(state, currentProject, newName);
  projects.attachWindow(state, windowId, currentProject);
  renderAll();
  scheduleSave();
}

// Return the current project's record, creating one if somehow absent.
function activeProject() {
  if (!currentProject) {
    currentProject = projects.newProjectName(state);
    projects.attachWindow(state, windowId, currentProject);
    renderAll();
  }
  return projects.ensureProject(state, currentProject);
}

// --- Workspace -------------------------------------------------------------

// Capture this window's reopenable tabs as the project's workspace snapshot.
// The saving window becomes the project's host window.
async function saveProject() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const reopenable = tabs.filter((t) => projects.isReopenable(t.url));
  const updated = projects.captureWorkspace(activeProject(), reopenable, Date.now());

  state.projects[currentProject] = updated;
  projects.setWorkspaceWindow(state, currentProject, windowId);
  await storage.save(state);
  renderWorkspace();
  renderRemoved();
  setStatus('Saved');
}

// Open the project's saved workspace. If the host window is still open, focus
// it instead of duplicating; otherwise recreate the workspace in a new window.
async function openProject() {
  const hosted = projects.workspaceWindow(state, currentProject);
  if (hosted && (await isWindowOpen(hosted))) {
    await chrome.windows.update(Number(hosted), { focused: true });
    setStatus(hosted === windowId ? 'Already open here' : 'Focused project window');
    return;
  }

  const project = projects.getProject(state, currentProject);
  const urls = ((project.workspace && project.workspace.tabs) || [])
    .map((t) => t.url)
    .filter(projects.isReopenable);

  if (!urls.length) {
    setStatus('Nothing saved to open');
    return;
  }

  const win = await chrome.windows.create({ url: urls });
  projects.attachWindow(state, String(win.id), currentProject);
  projects.setWorkspaceWindow(state, currentProject, win.id);
  await storage.save(state);

  // Best effort: Chrome only allows opening the panel within a live user
  // gesture, which the await above may have spent.
  try {
    await chrome.sidePanel.open({ windowId: win.id });
  } catch (error) {
    // Ignored: the user can open the panel from the toolbar.
  }
}

async function isWindowOpen(id) {
  const open = new Set((await chrome.windows.getAll()).map((w) => String(w.id)));
  return open.has(String(id));
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
  renderProjects();
  renderFields({ preserveFocus });
  renderWorkspace();
  renderRemoved();
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

// Push state into the text fields. Skip a field the user is actively typing in
// so a remote update never yanks the cursor.
function renderFields({ preserveFocus = false } = {}) {
  const project = projects.getProject(state, currentProject);

  if (!(preserveFocus && document.activeElement === els.notesInput)) {
    els.notesInput.value = project.notes || '';
  }
  if (!(preserveFocus && document.activeElement === els.scratchpadInput)) {
    els.scratchpadInput.value = state.scratchpad || '';
  }
}

function renderWorkspace() {
  const workspace = projects.getProject(state, currentProject).workspace;
  els.lastSaved.textContent = workspace
    ? `Last saved ${new Date(workspace.savedAt).toLocaleString()}`
    : 'Not saved yet';
}

function renderRemoved() {
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

// --- Persistence & export --------------------------------------------------

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
  const liveTabs = await chrome.tabs.query({ currentWindow: true });
  const project = projects.getProject(state, currentProject);
  const markdown = buildMarkdown({
    project: currentProject,
    notes: project.notes,
    scratchpad: state.scratchpad,
    liveTabs: liveTabs.map((t) => ({ title: t.title, url: t.url })),
    workspace: project.workspace,
    removedTabs: project.removedTabs || []
  });
  downloadMarkdown(fileName(currentProject), markdown);
}
