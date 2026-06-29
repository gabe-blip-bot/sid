// projects.js
// Pure helpers that operate on the in-memory state object. No DOM, no storage.
//
// State shape:
//   {
//     projects:  { [name]: { notes: string } },
//     scratchpad: string,                     // shared across every window
//     windows:    { [windowId]: projectName } // which project each window shows
//   }

export function emptyState() {
  return { projects: {}, scratchpad: '', windows: {} };
}

// Merge a loaded blob onto a fresh state so missing fields are always present.
export function normaliseState(loaded) {
  return { ...emptyState(), ...(loaded || {}) };
}

// Project names, sorted for the switcher.
export function projectNames(state) {
  return Object.keys(state.projects).sort((a, b) => a.localeCompare(b));
}

// Read a project's fields, falling back to empties for an unknown name.
export function getProject(state, name) {
  return state.projects[name] || { notes: '' };
}

// Create the project record if it does not exist yet, then return it.
export function ensureProject(state, name) {
  if (!state.projects[name]) {
    state.projects[name] = { notes: '' };
  }
  return state.projects[name];
}

// Point a window at a project, creating the project if it is new.
export function attachWindow(state, windowId, name) {
  state.windows[windowId] = name;
  ensureProject(state, name);
}

// The project a window is currently attached to, or null.
export function windowProject(state, windowId) {
  return state.windows[windowId] || null;
}

// Rename a project, carrying its notes and repointing every window that was
// attached to it. If the new name already exists, treat it as a switch to that
// project (no clobber). Returns the name now in effect.
export function renameProject(state, oldName, newName) {
  if (!oldName || !newName || newName === oldName) return oldName;
  if (state.projects[newName]) return newName;

  state.projects[newName] = state.projects[oldName] || { notes: '' };
  delete state.projects[oldName];
  for (const win of Object.keys(state.windows)) {
    if (state.windows[win] === oldName) state.windows[win] = newName;
  }
  return newName;
}

// An unused default name: "Untitled", then "Untitled 2", "Untitled 3"...
export function newProjectName(state) {
  if (!state.projects['Untitled']) return 'Untitled';
  let n = 2;
  while (state.projects[`Untitled ${n}`]) n += 1;
  return `Untitled ${n}`;
}

// Collapse stray whitespace so "  My  Project " and "My Project" match.
export function normaliseName(value) {
  return value.trim().replace(/\s+/g, ' ');
}
