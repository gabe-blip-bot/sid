// projects.js
// Pure helpers that operate on the in-memory state object. No DOM, no storage.
//
// State shape:
//   {
//     projects: {
//       [name]: {
//         notes: string,
//         workspace: { savedAt: number, tabs: [{ title, url }] },   // optional
//         removedTabs: [{ title, url, removedAt, lastSeenAt }]       // optional
//       }
//     },
//     scratchpad:  string,                     // shared across every window
//     windows:     { [windowId]: projectName }, // which project each window shows
//     openWindows: { [projectName]: windowId }  // window hosting a project's workspace
//   }

export function emptyState() {
  return {
    projects: {},
    scratchpad: '',
    windows: {},
    openWindows: {},
    dayThemes: { mon: '', tue: '', wed: '', thu: '' }
  };
}

// Merge a loaded blob onto a fresh state so missing fields are always present,
// and migrate each project's notes to a list of item strings.
export function normaliseState(loaded) {
  const state = { ...emptyState(), ...(loaded || {}) };
  // Ensure all four working-day keys exist so older saved state is upgraded.
  state.dayThemes = { mon: '', tue: '', wed: '', thu: '', ...(state.dayThemes || {}) };
  for (const name of Object.keys(state.projects)) {
    state.projects[name].notes = toNoteList(state.projects[name].notes);
  }
  return state;
}

// Coerce any historical notes shape into an array of non-empty strings:
// a legacy multiline string becomes one item per line.
function toNoteList(notes) {
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (typeof n === 'string' ? n : (n && n.text) || ''))
      .filter((t) => t.trim() !== '');
  }
  if (typeof notes === 'string') {
    return notes.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  }
  return [];
}

// Active (non-archived) project names, sorted for the switcher.
export function projectNames(state) {
  return Object.keys(state.projects)
    .filter((name) => !state.projects[name].archived)
    .sort((a, b) => a.localeCompare(b));
}

// Archived project names, sorted.
export function archivedNames(state) {
  return Object.keys(state.projects)
    .filter((name) => state.projects[name].archived)
    .sort((a, b) => a.localeCompare(b));
}

// Read a project's fields, falling back to empties for an unknown name.
export function getProject(state, name) {
  return state.projects[name] || { notes: [] };
}

// Create the project record if it does not exist yet, then return it.
export function ensureProject(state, name) {
  if (!state.projects[name]) {
    state.projects[name] = { notes: [] };
  }
  return state.projects[name];
}

// --- Notes (a per-project list of short items) -----------------------------

// Append a note item; ignores blank text.
export function addNote(state, name, text) {
  const item = text.trim();
  if (!item) return;
  const project = ensureProject(state, name);
  if (!Array.isArray(project.notes)) project.notes = [];
  project.notes.push(item);
}

// Remove the item at `index` (used when an item is ticked complete).
export function removeNote(state, name, index) {
  const project = state.projects[name];
  if (project && Array.isArray(project.notes)) project.notes.splice(index, 1);
}

// Replace the item at `index`; if the new text is blank, remove it instead.
export function editNote(state, name, index, text) {
  const project = state.projects[name];
  if (!project || !Array.isArray(project.notes)) return;
  if (index < 0 || index >= project.notes.length) return;
  const trimmed = text.trim();
  if (trimmed === '') project.notes.splice(index, 1);
  else project.notes[index] = trimmed;
}

// Clear every item (used by "Complete all").
export function clearNotes(state, name) {
  const project = state.projects[name];
  if (project) project.notes = [];
}

// Set a working-day theme (dayKey is one of mon|tue|wed|thu). Global.
export function setDayTheme(state, dayKey, text) {
  if (!state.dayThemes) state.dayThemes = { mon: '', tue: '', wed: '', thu: '' };
  state.dayThemes[dayKey] = text;
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

// Drop bindings for windows Chrome no longer has open. `openWindowIds` is a Set
// of String(window.id). A browser restart reassigns window IDs, so the old ones
// become dead; clearing them keeps reopened windows from inheriting stale
// projects. Mutates and returns state.
export function pruneWindows(state, openWindowIds) {
  for (const id of Object.keys(state.windows)) {
    if (!openWindowIds.has(id)) delete state.windows[id];
  }
  if (state.openWindows) {
    for (const name of Object.keys(state.openWindows)) {
      if (!openWindowIds.has(String(state.openWindows[name]))) delete state.openWindows[name];
    }
  }
  return state;
}

// Rename a project, carrying its notes and repointing every window that was
// attached to it. If the new name already exists, treat it as a switch to that
// project (no clobber). Returns the name now in effect.
export function renameProject(state, oldName, newName) {
  if (!oldName || !newName || newName === oldName) return oldName;
  if (state.projects[newName]) return newName;

  state.projects[newName] = state.projects[oldName] || { notes: [] };
  delete state.projects[oldName];
  for (const win of Object.keys(state.windows)) {
    if (state.windows[win] === oldName) state.windows[win] = newName;
  }
  if (state.openWindows && oldName in state.openWindows) {
    state.openWindows[newName] = state.openWindows[oldName];
    delete state.openWindows[oldName];
  }
  return newName;
}

// Move every window attached to `name` onto another active project: the first
// active one alphabetically, or a fresh Untitled if none remain.
function reassignWindows(state, name) {
  const attached = Object.keys(state.windows).filter((w) => state.windows[w] === name);
  if (!attached.length) return;

  let target = projectNames(state).find((n) => n !== name);
  if (!target) {
    target = newProjectName(state);
    ensureProject(state, target);
  }
  for (const win of attached) state.windows[win] = target;
}

// Archive a project: hide it from the switcher, move its windows to an active
// project, and drop its workspace-host entry. Notes/workspace are kept.
export function archiveProject(state, name) {
  const project = state.projects[name];
  if (!project) return;
  project.archived = true;
  reassignWindows(state, name);
  if (state.openWindows) delete state.openWindows[name];
}

// Bring an archived project back into the switcher.
export function restoreProject(state, name) {
  if (state.projects[name]) delete state.projects[name].archived;
}

// Permanently delete a project, repointing its windows and clearing any
// windows/openWindows entries that reference it.
export function deleteProject(state, name) {
  if (!state.projects[name]) return;
  delete state.projects[name];
  if (state.openWindows) delete state.openWindows[name];
  reassignWindows(state, name);
}

// The window that currently hosts a project's workspace, or null. Set when the
// project is saved or opened; used to focus rather than duplicate.
export function workspaceWindow(state, name) {
  const id = state.openWindows ? state.openWindows[name] : null;
  return id != null ? String(id) : null;
}

export function setWorkspaceWindow(state, name, windowId) {
  if (!state.openWindows) state.openWindows = {};
  state.openWindows[name] = String(windowId);
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

// Decide what the project combobox should show for the typed text. Pure so the
// select/create logic can be tested without the DOM. Renaming is handled
// separately (the header pencil), not through typed text.
//   - resting (text empty or equal to current): list every project
//   - typed an existing, non-current name: list it + an "already exists" hint
//     (a switch, never a merge)
//   - typed a new name: a single Create row
export function projectMenuRows(names, typedRaw, currentProject) {
  const typed = normaliseName(typedRaw);
  const lower = typed.toLowerCase();
  const currentLower = (currentProject || '').toLowerCase();

  const resting = lower === '' || lower === currentLower;
  const matches = resting ? names.slice() : names.filter((n) => n.toLowerCase().includes(lower));
  const exact = (typed && names.find((n) => n.toLowerCase() === lower)) || null;

  const rows = matches.map((name) => ({ kind: 'project', name }));

  if (!resting) {
    if (exact) {
      rows.push({ kind: 'hint', text: `"${exact}" already exists` });
    } else {
      rows.push({ kind: 'create', name: typed });
    }
  }
  return { rows, exact };
}

// Tabs we can actually reopen later. Browser-internal and extension pages are
// rejected by chrome.windows.create, so we never capture them.
export function isReopenable(url) {
  return /^(https?|file):\/\//i.test(url || '');
}

// Replace a project's workspace snapshot with `tabs` (already filtered to
// reopenable, in window order) taken at `now`, reconciling the removed-tabs
// archive against the previous snapshot:
//   - a previously saved URL that is gone now is archived (keyed by URL, deduped)
//   - an archived URL that reappears is dropped from the archive
// Returns a new project object; does not mutate the input.
export function captureWorkspace(project, tabs, now) {
  const newTabs = tabs.map((t) => ({ title: t.title || '', url: t.url }));
  const newUrls = new Set(newTabs.map((t) => t.url));

  const prevTabs = (project.workspace && project.workspace.tabs) || [];
  const prevSavedAt = project.workspace ? project.workspace.savedAt : null;

  const archive = new Map((project.removedTabs || []).map((r) => [r.url, r]));

  // Reappeared tabs leave the archive.
  for (const url of newUrls) archive.delete(url);

  // Tabs in the previous snapshot but absent now get archived.
  for (const tab of prevTabs) {
    if (newUrls.has(tab.url)) continue;
    const existing = archive.get(tab.url);
    if (existing) {
      existing.removedAt = now;
      existing.lastSeenAt = prevSavedAt;
    } else {
      archive.set(tab.url, {
        title: tab.title,
        url: tab.url,
        removedAt: now,
        lastSeenAt: prevSavedAt
      });
    }
  }

  return {
    ...project,
    workspace: { savedAt: now, tabs: newTabs },
    removedTabs: [...archive.values()]
  };
}

// Drop a URL from a project's removed-tabs archive (used on restore).
export function unarchiveTab(project, url) {
  return {
    ...project,
    removedTabs: (project.removedTabs || []).filter((r) => r.url !== url)
  };
}
