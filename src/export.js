// export.js
// Build and download a Markdown snapshot of the current window's context.

// Compose the Markdown document. `tabs` is an array of { title, url }.
export function buildMarkdown({ project, objective, notes, scratchpad, tabs }) {
  const openTabs = tabs
    .filter((tab) => tab.url)
    .map((tab) => `- [${tab.title || 'Untitled'}](${tab.url})`)
    .join('\n');

  return [
    `# ${project || 'Untitled project'}`,
    '',
    '## Current objective',
    '',
    objective || '_None_',
    '',
    '## Notes',
    '',
    notes || '_None_',
    '',
    '## Scratchpad',
    '',
    scratchpad || '_None_',
    '',
    '## Open tabs',
    '',
    openTabs || '_None_',
    ''
  ].join('\n');
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
