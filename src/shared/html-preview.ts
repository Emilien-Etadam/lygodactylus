/**
 * HTML/SVG code-block preview helpers (detection, CSP srcdoc, session versions).
 * Zero dependencies — shared by renderer and main.
 */

export type PreviewKind = 'html' | 'svg';

export interface PreviewArtifact {
  /** Stable id within the session collection order: `${kind}-${n}` (1-based). */
  id: string;
  kind: PreviewKind;
  language: string;
  source: string;
  messageId: string;
  /** 1-based version index among artifacts of the same kind. */
  version: number;
}

export interface PreviewTextBlock {
  type: 'text';
  text: string;
}

export interface PreviewMessageLike {
  id: string;
  role: string;
  content: Array<{ type: string; text?: string }>;
}

/** Restrictive CSP: no network; inline script/style allowed for local demos. */
export const PREVIEW_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; " +
  "img-src data:; font-src data:; media-src 'none'; object-src 'none'; " +
  "connect-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";

const PREVIEW_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;

const PREVIEWABLE_ROOT_RE = /<!doctype\b|<html\b|<svg\b/i;
const FENCED_BLOCK_RE = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g;

/** Max srcdoc length accepted by the dedicated preview window IPC. */
export const HTML_PREVIEW_MAX_SRCDOC_CHARS = 2_000_000;

export function normalizePreviewLanguage(language: string): PreviewKind | null {
  const lang = language.trim().toLowerCase();
  if (lang === 'html' || lang === 'htm' || lang === 'xhtml') {
    return 'html';
  }
  if (lang === 'svg') {
    return 'svg';
  }
  return null;
}

export function hasPreviewableRoot(source: string): boolean {
  return PREVIEWABLE_ROOT_RE.test(source);
}

/**
 * True when a fenced code block is eligible for the Preview button:
 * language is html/svg and the body contains a plausible document root.
 */
export function isPreviewableCodeBlock(language: string, source: string): boolean {
  if (!normalizePreviewLanguage(language)) {
    return false;
  }
  return hasPreviewableRoot(source);
}

export interface FencedCodeBlock {
  language: string;
  code: string;
}

export function extractFencedCodeBlocks(markdown: string): FencedCodeBlock[] {
  const blocks: FencedCodeBlock[] = [];
  const re = new RegExp(FENCED_BLOCK_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const language = (match[1] || '').trim();
    const code = match[2] ?? '';
    blocks.push({ language, code: code.replace(/\n$/, '') });
  }
  return blocks;
}

function injectCspIntoHtml(html: string): string {
  if (/http-equiv\s*=\s*["']?Content-Security-Policy/i.test(html)) {
    // Replace existing CSP with our restrictive policy.
    return html.replace(
      /<meta\b[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/i,
      PREVIEW_CSP_META
    );
  }
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (open) => `${open}\n${PREVIEW_CSP_META}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(
      /<html\b[^>]*>/i,
      (open) => `${open}\n<head>\n<meta charset="utf-8">\n${PREVIEW_CSP_META}\n</head>`
    );
  }
  if (/<!doctype\b/i.test(html)) {
    return (
      html.replace(
        /<!doctype[^>]*>/i,
        (doctype) =>
          `${doctype}\n<html>\n<head>\n<meta charset="utf-8">\n${PREVIEW_CSP_META}\n</head>\n<body>`
      ) + '\n</body>\n</html>'
    );
  }
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8">${PREVIEW_CSP_META}</head>` +
    `<body>${html}</body></html>`
  );
}

function wrapSvgAsHtml(svgSource: string): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8">${PREVIEW_CSP_META}` +
    `<style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff}</style>` +
    `</head><body>${svgSource}</body></html>`
  );
}

/**
 * Build a complete HTML document for iframe srcdoc / dedicated window,
 * with an injected CSP that forbids all network requests.
 */
export function buildPreviewSrcdoc(source: string, kind: PreviewKind): string {
  const trimmed = source.trim();
  if (kind === 'svg' && /<svg\b/i.test(trimmed) && !/<html\b/i.test(trimmed)) {
    return wrapSvgAsHtml(trimmed);
  }
  if (/<!doctype\b|<html\b/i.test(trimmed)) {
    return injectCspIntoHtml(trimmed);
  }
  if (kind === 'svg' || /<svg\b/i.test(trimmed)) {
    return wrapSvgAsHtml(trimmed);
  }
  return injectCspIntoHtml(trimmed);
}

/**
 * Collect previewable HTML/SVG fences from assistant messages, in arrival order.
 * Successive blocks of the same kind become versions (v1, v2, …).
 */
export function collectPreviewArtifacts(messages: PreviewMessageLike[]): PreviewArtifact[] {
  const artifacts: PreviewArtifact[] = [];
  const versionByKind: Record<PreviewKind, number> = { html: 0, svg: 0 };

  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    for (const block of message.content) {
      if (block.type !== 'text' || typeof block.text !== 'string') {
        continue;
      }
      for (const fence of extractFencedCodeBlocks(block.text)) {
        const kind = normalizePreviewLanguage(fence.language);
        if (!kind || !hasPreviewableRoot(fence.code)) {
          continue;
        }
        versionByKind[kind] += 1;
        const version = versionByKind[kind];
        artifacts.push({
          id: `${kind}-${version}`,
          kind,
          language: fence.language.trim().toLowerCase() || kind,
          source: fence.code,
          messageId: message.id,
          version,
        });
      }
    }
  }

  return artifacts;
}

export function versionsOfKind(artifacts: PreviewArtifact[], kind: PreviewKind): PreviewArtifact[] {
  return artifacts.filter((artifact) => artifact.kind === kind);
}

/**
 * Resolve the version index (0-based) for a source among same-kind artifacts.
 * Prefers the last exact match (most recent duplicate).
 */
export function resolvePreviewVersionIndex(
  artifacts: PreviewArtifact[],
  kind: PreviewKind,
  source: string
): number {
  const versions = versionsOfKind(artifacts, kind);
  if (versions.length === 0) {
    return 0;
  }
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    if (versions[i]?.source === source) {
      return i;
    }
  }
  return versions.length - 1;
}

export function isValidPreviewSrcdoc(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= HTML_PREVIEW_MAX_SRCDOC_CHARS &&
    value.includes('Content-Security-Policy')
  );
}
