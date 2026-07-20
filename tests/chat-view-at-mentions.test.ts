import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');
const chatViewContent = readFileSync(chatViewPath, 'utf8');
const preloadPath = path.resolve(process.cwd(), 'src/preload/index.ts');
const preloadContent = readFileSync(preloadPath, 'utf8');
const ipcPath = path.resolve(process.cwd(), 'src/main/ipc/ipc-client-shell.ts');
const ipcContent = readFileSync(ipcPath, 'utf8');

describe('ChatView @-mention autocomplete wiring', () => {
  it('renders a mention menu while typing @', () => {
    expect(chatViewContent).toContain('MentionMenu');
    expect(chatViewContent).toContain('getAtMentionQuery(prompt)');
    expect(chatViewContent).toContain('workspace.searchPaths');
  });

  it('supports keyboard navigation for mention suggestions', () => {
    expect(chatViewContent).toContain('showMentionMenu');
    expect(chatViewContent).toContain('setMentionHighlightIndex');
    expect(chatViewContent).toContain('applyMentionSuggestion');
  });

  it('exposes workspace.searchPaths through preload and IPC', () => {
    expect(preloadContent).toContain("ipcRenderer.invoke('workspace.searchPaths'");
    expect(ipcContent).toContain("'workspace.searchPaths'");
    expect(ipcContent).toContain('searchWorkspacePaths');
  });
});
