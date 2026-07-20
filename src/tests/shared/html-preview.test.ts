import { describe, expect, it } from 'vitest';
import {
  PREVIEW_CSP,
  buildPreviewSrcdoc,
  collectPreviewArtifacts,
  isPreviewableCodeBlock,
  resolvePreviewVersionIndex,
  versionsOfKind,
  type PreviewMessageLike,
} from '../../shared/html-preview';

describe('isPreviewableCodeBlock', () => {
  it('accepts a complete html document', () => {
    const source = '<!DOCTYPE html><html><body><h1>Hi</h1></body></html>';
    expect(isPreviewableCodeBlock('html', source)).toBe(true);
  });

  it('rejects an html fragment without a document root', () => {
    expect(isPreviewableCodeBlock('html', '<div class="card">Hello</div>')).toBe(false);
  });

  it('accepts a complete svg root', () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="10"/></svg>';
    expect(isPreviewableCodeBlock('svg', source)).toBe(true);
  });

  it('rejects typescript fences even with html-looking text', () => {
    const source = 'const html = "<html><body>x</body></html>";';
    expect(isPreviewableCodeBlock('ts', source)).toBe(false);
    expect(isPreviewableCodeBlock('typescript', source)).toBe(false);
  });

  it('accepts html language with an <html root', () => {
    expect(isPreviewableCodeBlock('HTML', '<html lang="fr"><body>ok</body></html>')).toBe(true);
  });
});

describe('buildPreviewSrcdoc', () => {
  it('injects a network-blocking CSP (snapshot)', () => {
    const source =
      '<!DOCTYPE html><html><head><title>Demo</title></head><body><p>Hi</p></body></html>';
    const srcdoc = buildPreviewSrcdoc(source, 'html');
    expect(srcdoc).toMatchSnapshot();
    expect(srcdoc).toContain('Content-Security-Policy');
    expect(srcdoc).toContain(PREVIEW_CSP);
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain("script-src 'unsafe-inline'");
    expect(srcdoc).toContain("style-src 'unsafe-inline'");
    expect(srcdoc).toContain("connect-src 'none'");
  });

  it('wraps bare svg with CSP shell', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const srcdoc = buildPreviewSrcdoc(source, 'svg');
    expect(srcdoc).toContain('Content-Security-Policy');
    expect(srcdoc).toContain(source);
    expect(srcdoc.startsWith('<!DOCTYPE html>')).toBe(true);
  });
});

describe('collectPreviewArtifacts versions', () => {
  const messages: PreviewMessageLike[] = [
    {
      id: 'm1',
      role: 'user',
      content: [{ type: 'text', text: '```html\n<html><body>ignore</body></html>\n```' }],
    },
    {
      id: 'm2',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: ['First', '```html', '<html><body>v1</body></html>', '```'].join('\n'),
        },
      ],
    },
    {
      id: 'm3',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: [
            'SVG then HTML',
            '```svg',
            '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>',
            '```',
            '```html',
            '<!DOCTYPE html><html><body>v2</body></html>',
            '```',
          ].join('\n'),
        },
      ],
    },
    {
      id: 'm4',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: [
            'Fragment ignored',
            '```html',
            '<div>nope</div>',
            '```',
            '```ts',
            'const x = 1;',
            '```',
          ].join('\n'),
        },
      ],
    },
  ];

  it('orders versions by arrival and scopes them by kind', () => {
    const artifacts = collectPreviewArtifacts(messages);
    const htmlVersions = versionsOfKind(artifacts, 'html');
    const svgVersions = versionsOfKind(artifacts, 'svg');

    expect(htmlVersions.map((a) => a.version)).toEqual([1, 2]);
    expect(htmlVersions.map((a) => a.source)).toEqual([
      '<html><body>v1</body></html>',
      '<!DOCTYPE html><html><body>v2</body></html>',
    ]);
    expect(svgVersions.map((a) => a.version)).toEqual([1]);
    expect(svgVersions[0]?.id).toBe('svg-1');
    expect(htmlVersions[1]?.id).toBe('html-2');
  });

  it('resolves the latest matching source index', () => {
    const artifacts = collectPreviewArtifacts(messages);
    const index = resolvePreviewVersionIndex(
      artifacts,
      'html',
      '<!DOCTYPE html><html><body>v2</body></html>'
    );
    expect(index).toBe(1);
  });
});
