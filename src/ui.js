// ui.js
// Wires the side panel DOM to the storage and project modules.
// Owns the in-memory state, the debounced autosave, and the project combobox.

import * as storage from './storage.js';
import * as projects from './projects.js';
import { buildMarkdown, downloadMarkdown, fileName } from './export.js';

const SAVE_DELAY = 400; // ms to debounce autosave writes

const els = {
  projectInput: document.getElementById('projectInput'),
  projectListbox: document.getElementById('projectListbox'),
  notesInput: document.getElementById('notesInput'),
  scratchpadInput: document.getElementById('scratchpadInput'),
  lastSaved: document.getElementById('lastSaved'),
  saveProjectButton: document.getElementById('saveProjectButton'),
  openProjectButton: document.getElementById('openProjectButton'),
  removedSection: document.getElementById('removedSection'),
  removedSummary: document.getElementById('removedSummary'),
  removedList: document.getElementById('removedList'),
  exportButton: document.getElementById('exportButton')
};

let state = projects.emptyState();
let windowId = null;
let currentProject = null;
let saveTimer = null;

// Combobox state.
let comboOpen = false;
let comboRows = []; // [{ kind:'project'|'create'|'rename'|'hint', name?, text? }]
let highlight = -1; // index into comboRows of the active row

init().catch((error) => {
  console.error(error);
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
      } else if (row.kind === 'rename') {
        li.classList.add('combo-action');
        li.textContent = `Rename "${currentProject}" → "${row.name}"`;
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
  else if (row.kind === 'rename') renameCurrent(row.name);
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
  commitProjectChange();
}

// Rename the current project. The combobox only offers this when `name` is free.
function renameCurrent(name) {
  const clean = projects.normaliseName(name);
  if (!clean || !currentProject) {
    closeCombo();
    return;
  }
  currentProject = projects.renameProject(state, currentProject, clean);
  projects.attachWindow(state, windowId, currentProject);
  commitProjectChange();
}

function commitProjectChange() {
  closeCombo();
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
}

// Open the project's saved workspace. If the host window is still open, focus
// it instead of duplicating; otherwise recreate the workspace in a new window.
async function openProject() {
  const hosted = projects.workspaceWindow(state, currentProject);
  if (hosted && (await isWindowOpen(hosted))) {
    await chrome.windows.update(Number(hosted), { focused: true });
    return;
  }

  const project = projects.getProject(state, currentProject);
  const urls = ((project.workspace && project.workspace.tabs) || [])
    .map((t) => t.url)
    .filter(projects.isReopenable);

  if (!urls.length) return;

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
  renderProjectInput();
  renderFields({ preserveFocus });
  renderWorkspace();
  renderRemoved();
}

function renderProjectInput() {
  // Don't clobber what the user is typing into the open combobox.
  if (comboOpen && document.activeElement === els.projectInput) return;
  els.projectInput.value = currentProject || '';
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
  // Nothing to reopen until the project has a snapshot.
  els.openProjectButton.disabled = !(workspace && workspace.tabs && workspace.tabs.length);
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
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.save(state), SAVE_DELAY);
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
