// export.js
// Build and download a Markdown snapshot of the current window's context.

function tabLines(tabs) {
  const items = (tabs || []).filter((t) => t.url);
  if (!items.length) return '_None_';
  return items.map((t) => `- [${t.title || 'Untitled'}](${t.url})`).join('\n');
}

// Compose the Markdown document.
export function buildMarkdown({ project, notes, scratchpad, liveTabs, workspace, removedTabs }) {
  const lines = [
    `# ${project || 'Untitled project'}`,
    '',
    '## Notes',
    '',
    notes || '_None_',
    '',
    '## Scratchpad',
    '',
    scratchpad || '_None_',
    '',
    '## Open tabs (live)',
    '',
    tabLines(liveTabs),
    '',
    '## Saved workspace',
    ''
  ];

  if (workspace && workspace.tabs && workspace.tabs.length) {
    lines.push(`_Saved ${new Date(workspace.savedAt).toLocaleString()}_`, '', tabLines(workspace.tabs));
  } else {
    lines.push('_None_');
  }

  lines.push('', '## Removed tabs', '');
  if (removedTabs && removedTabs.length) {
    lines.push(removedTabs.map((t) => `- [${t.title || 'Untitled'}](${t.url})`).join('\n'));
  } else {
    lines.push('_None_');
  }

  lines.push('');
  return lines.join('\n');
}

// Trigger a file download from the side panel document.
export function downloadMarkdown(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Turn a project name into a filesystem-safe Markdown filename.
export function fileName(project) {
  const safe = (project || 'sid').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
  return `${safe || 'sid'}.md`;
}
