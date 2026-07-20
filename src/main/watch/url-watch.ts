/**
 * URL content watch helpers: extract text, hash, and truncated unified diff.
 */
import { createHash } from 'node:crypto';
import { createUnifiedDiff, truncateUtf8 } from '../autonomy/unified-diff';
import { WATCH_URL_DIFF_MAX_BYTES } from '../../shared/watch';

/** Storage budget for previous URL text kept in lastState (UTF-8 bytes). */
export const URL_STATE_TEXT_MAX_BYTES = 64 * 1024;

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Rough HTML→text extraction (no DOM dependency).
 * Script/style stripped; tags removed; whitespace collapsed.
 */
export function extractTextFromHtml(html: string): string {
  if (typeof html !== 'string' || !html) {
    return '';
  }
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ');
  return withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractWatchableText(body: string, contentType: string): string {
  const lower = contentType.toLowerCase();
  if (lower.includes('html') || /<html[\s>]/i.test(body) || /<body[\s>]/i.test(body)) {
    return extractTextFromHtml(body);
  }
  return body.replace(/\s+/g, ' ').trim();
}

/**
 * Build a unified diff of extracted URL text, truncated to 8 KiB UTF-8-safe.
 */
export function buildTruncatedUrlDiff(
  url: string,
  oldText: string,
  newText: string,
  maxBytes: number = WATCH_URL_DIFF_MAX_BYTES
): string {
  const filePath = url.replace(/^https?:\/\//i, '');
  const diff = createUnifiedDiff(filePath, oldText, newText);
  return truncateUtf8(diff, maxBytes);
}
