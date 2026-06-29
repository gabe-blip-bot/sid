const STORAGE_KEY = 'sidState.v1';
const DEFAULT_PROJECT = 'Untitled';

const els = {
  windowLabel: document.getElementById('windowLabel'),
  saveStatus: document.getElementById('saveStatus'),
  projectInput: document.getElementById('projectInput'),
  projectList: document.getElementById('projectList'),
  objectiveInput: document.getElementById('objectiveInput'),
  notesInput: document.getElementById('notesInput'),
  scratchpadInput: document.getElementById('scratchpadInput'),
  exportButton: document.getElementById('exportButton'),
  connectDriveButton: document.getElementById('connectDriveButton'),
  saveDriveButton: document.getElementById('saveDriveButton')
};

let state = {
  windows: {},
  projects: {},
  scratchpad: '',
  drive: {}
};

let currentWindowId = null;
let currentProjectName = DEFAULT_PROJECT;
let saveTimer = null;

init().catch((error) => {
  console.error(error);
  setStatus('Error');
});

async function init() {
  const currentWindow = await chrome.windows.getCurrent();
  currentWindowId = String(currentWindow.id);
  els.windowLabel.textContent = `Window ${currentWindowId}`;

  state = await loadState();
  currentProjectName = state.windows[currentWindowId]?.projectName || DEFAULT_PROJECT;
  ensureProject(currentProjectName);
  render();
  bindEvents();
  setStatus('Saved');
}

function bindEvents() {
  els.projectInput.addEventListener('change', () => attachProject(els.projectInput.value));
  els.projectInput.addEventListener('blur', () => attachProject(els.projectInput.value));

  els.objectiveInput.addEventListener('input', () => {
    ensureProject(currentProjectName).objective = els.objectiveInput.value;
    scheduleSave();
  });

  els.notesInput.addEventListener('input', () => {
    ensureProject(currentProjectName).notes = els.notesInput.value;
    scheduleSave();
  });

  els.scratchpadInput.addEventListener('input', () => {
    state.scratchpad = els.scratchpadInput.value;
    scheduleSave();
  });

  els.exportButton.addEventListener('click', exportMarkdown);
  els.connectDriveButton.addEventListener('click', connectDrive);
  els.saveDriveButton.addEventListener('click', saveDrive);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const incoming = changes[STORAGE_KEY].newValue;
    if (!incoming) return;
    state = incoming;
    ensureProject(currentProjectName);
    render({ preserveFocus: true });
  });
}

function render(options = {}) {
  els.projectInput.value = currentProjectName;
  els.projectList.innerHTML = '';

  for (const name of Object.keys(state.projects).sort((a, b) => a.localeCompare(b))) {
    const option = document.createElement('option');
    option.value = name;
    els.projectList.appendChild(option);
  }

  const project = ensureProject(currentProjectName);

  if (!(options.preserveFocus && document.activeElement === els.objectiveInput)) {
    els.objectiveInput.value = project.objective || '';
  }

  if (!(options.preserveFocus && document.activeElement === els.notesInput)) {
    els.notesInput.value = project.notes || '';
  }

  if (!(options.preserveFocus && document.activeElement === els.scratchpadInput)) {
    els.scratchpadInput.value = state.scratchpad || '';
  }
}

function attachProject(rawName) {
  const name = normaliseProjectName(rawName);
  if (!name) {
    els.projectInput.value = currentProjectName;
    return;
  }

  currentProjectName = name;
  ensureProject(name);
  state.windows[currentWindowId] = { projectName: name };
  render();
  scheduleSave();
}

function ensureProject(name) {
  if (!state.projects[name]) {
    state.projects[name] = {
      objective: '',
      notes: ''
    };
  }
  if (!state.windows[currentWindowId]) {
    state.windows[currentWindowId] = { projectName: name };
  }
  return state.projects[name];
}

async function loadState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return {
    windows: {},
    projects: {},
    scratchpad: '',
    drive: {},
    ...(data[STORAGE_KEY] || {})
  };
}

function scheduleSave() {
  setStatus('Saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 350);
}

async function saveLocal() {
  state.windows[currentWindowId] = { projectName: currentProjectName };
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  setStatus('Saved');
}

function setStatus(text) {
  els.saveStatus.textContent = text;
}

async function exportMarkdown() {
  await saveLocal();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const project = ensureProject(currentProjectName);
  const markdown = buildProjectMarkdown(currentProjectName, project, tabs, state.scratchpad);
  downloadText(`${safeFileName(currentProjectName)}.md`, markdown);
}

function buildProjectMarkdown(projectName, project, tabs, scratchpad) {
  const tabLines = tabs
    .filter((tab) => tab.url)
    .map((tab) => `- ${tab.title || 'Untitled'}\n  ${tab.url}`)
    .join('\n');

  return `# ${projectName}\n\n## Current objective\n\n${project.objective || ''}\n\n## Notes\n\n${project.notes || ''}\n\n## Open tabs\n\n${tabLines || 'No tabs captured.'}\n\n## Scratchpad\n\n${scratchpad || ''}\n`;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function connectDrive() {
  try {
    setStatus('Connecting Drive');
    await chrome.identity.getAuthToken({ interactive: true });
    setStatus('Drive connected');
  } catch (error) {
    console.error(error);
    setStatus('Drive error');
  }
}

async function saveDrive() {
  // Placeholder for the full Drive API implementation. Local autosave remains active.
  try {
    await chrome.identity.getAuthToken({ interactive: true });
    setStatus('Drive ready');
  } catch (error) {
    console.error(error);
    setStatus('Drive error');
  }
}

function normaliseProjectName(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function safeFileName(value) {
  return normaliseProjectName(value).replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || DEFAULT_PROJECT;
}
