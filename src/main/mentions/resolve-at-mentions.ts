import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AT_MENTION_FILE_BYTE_LIMIT,
  formatAttachedContextBlock,
  parseAtMentions,
  type ParsedAtMention,
} from '../../shared/at-mentions';
import { executeHttpRequest, formatHttpRequestResult } from '../agent/http-request';
import { mt } from '../i18n';
import { isPathWithinRoot } from '../tools/path-containment';

export interface AttachedContextItem {
  source: string;
  kind: 'file' | 'directory' | 'url';
  body: string;
  ok: boolean;
}

export interface ResolveAtMentionsResult {
  /** Original prompt unchanged (compact mentions). */
  prompt: string;
  /** Blocks to prefix before the user prompt for the model. */
  prefix: string;
  items: AttachedContextItem[];
}

/**
 * Resolve @file / @folder / @url mentions into `<attached_context>` blocks.
 * Failures are silent per mention (short note inside the block).
 */
export async function resolveAtMentions(
  prompt: string,
  workspaceRoot: string | null | undefined
): Promise<ResolveAtMentionsResult> {
  const mentions = parseAtMentions(prompt);
  if (mentions.length === 0) {
    return { prompt, prefix: '', items: [] };
  }

  const items: AttachedContextItem[] = [];
  for (const mention of mentions) {
    items.push(await resolveOneMention(mention, workspaceRoot));
  }

  const prefix = items
    .map((item) => formatAttachedContextBlock(item.source, item.body))
    .join('\n\n');
  return { prompt, prefix, items };
}

async function resolveOneMention(
  mention: ParsedAtMention,
  workspaceRoot: string | null | undefined
): Promise<AttachedContextItem> {
  if (mention.kind === 'url') {
    return resolveUrlMention(mention.value);
  }
  return resolvePathMention(mention.value, workspaceRoot);
}

async function resolveUrlMention(url: string): Promise<AttachedContextItem> {
  const source = url;
  try {
    const result = await executeHttpRequest({ url, method: 'GET', timeoutMs: 20_000 });
    return {
      source,
      kind: 'url',
      body: formatHttpRequestResult(result),
      ok: true,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      source,
      kind: 'url',
      body: mt('atMentionUrlFailed', { url, error: detail }),
      ok: false,
    };
  }
}

async function resolvePathMention(
  relativeOrPath: string,
  workspaceRoot: string | null | undefined
): Promise<AttachedContextItem> {
  const source = relativeOrPath.replace(/\\/g, '/');

  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    return {
      source,
      kind: 'file',
      body: mt('atMentionNoWorkspace'),
      ok: false,
    };
  }

  const root = path.resolve(workspaceRoot);
  const candidate = path.resolve(root, relativeOrPath);

  if (!isPathWithinRoot(candidate, root, process.platform === 'win32')) {
    return {
      source,
      kind: 'file',
      body: mt('atMentionPathEscapesWorkspace', { path: source }),
      ok: false,
    };
  }

  let stats;
  try {
    stats = await fs.stat(candidate);
  } catch {
    return {
      source,
      kind: 'file',
      body: mt('atMentionPathMissing', { path: source }),
      ok: false,
    };
  }

  if (stats.isDirectory()) {
    return resolveDirectoryMention(source, candidate);
  }

  if (!stats.isFile()) {
    return {
      source,
      kind: 'file',
      body: mt('atMentionPathUnsupported', { path: source }),
      ok: false,
    };
  }

  return resolveFileMention(source, candidate, stats.size);
}

async function resolveDirectoryMention(
  source: string,
  absoluteDir: string
): Promise<AttachedContextItem> {
  try {
    const dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
    const lines = dirents
      .filter((entry) => !entry.isSymbolicLink())
      .map((entry) => {
        const suffix = entry.isDirectory() ? '/' : '';
        return `${entry.name}${suffix}`;
      })
      .sort((a, b) => a.localeCompare(b));

    const listing =
      lines.length > 0 ? lines.join('\n') : mt('atMentionDirectoryEmpty', { path: source });

    return {
      source,
      kind: 'directory',
      body: listing,
      ok: true,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      source,
      kind: 'directory',
      body: mt('atMentionDirectoryFailed', { path: source, error: detail }),
      ok: false,
    };
  }
}

async function resolveFileMention(
  source: string,
  absoluteFile: string,
  size: number
): Promise<AttachedContextItem> {
  try {
    const handle = await fs.open(absoluteFile, 'r');
    try {
      const bytesToRead = Math.min(size, AT_MENTION_FILE_BYTE_LIMIT);
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
      let text = buffer.slice(0, bytesRead).toString('utf8');
      // Drop NUL bytes from binary-ish content for cleaner prompts.
      if (text.includes('\0')) {
        text = text.split('\0').join('');
      }
      if (size > AT_MENTION_FILE_BYTE_LIMIT || bytesRead >= AT_MENTION_FILE_BYTE_LIMIT) {
        text = `${text}\n\n${mt('atMentionFileTruncated', {
          limit: AT_MENTION_FILE_BYTE_LIMIT,
          size,
        })}`;
      }
      return {
        source,
        kind: 'file',
        body: text,
        ok: true,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      source,
      kind: 'file',
      body: mt('atMentionFileFailed', { path: source, error: detail }),
      ok: false,
    };
  }
}

export function applyAttachedContextPrefix(prompt: string, prefix: string): string {
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix) {
    return prompt;
  }
  return `${trimmedPrefix}\n\n${prompt}`;
}
