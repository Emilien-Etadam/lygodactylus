import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readProjectFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('html preview wiring', () => {
  it('uses a sandboxed iframe without allow-same-origin', () => {
    const panel = readProjectFile('src/renderer/components/HtmlPreviewPanel.tsx');
    const sandboxMatch = panel.match(/sandbox="([^"]*)"/);
    expect(sandboxMatch?.[1]).toBe('allow-scripts');
    expect(sandboxMatch?.[1]).not.toContain('allow-same-origin');
    expect(panel).toContain('srcDoc={srcdoc}');
  });

  it('opens the dedicated window without a preload bridge', () => {
    const windowSource = readProjectFile('src/main/html-preview-window.ts');
    expect(windowSource).toContain('nodeIntegration: false');
    expect(windowSource).toContain('contextIsolation: true');
    expect(windowSource).toContain('sandbox: true');
    expect(windowSource).not.toMatch(/preload\s*:/);
    expect(windowSource).toContain('isValidPreviewSrcdoc');
  });

  it('exposes openHtmlPreview on the window API', () => {
    const preload = readProjectFile('src/preload/index.ts');
    const ipc = readProjectFile('src/main/ipc/ipc-skills-plugins-window.ts');
    expect(preload).toContain("ipcRenderer.invoke('window.openHtmlPreview'");
    expect(ipc).toContain("ipcMain.handle('window.openHtmlPreview'");
  });
});
