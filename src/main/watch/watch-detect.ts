/**
 * Per-watcher novelty detection (folder / RSS / URL).
 */
import { executeHttpRequest } from '../agent/http-request';
import {
  WATCH_RSS_GUID_LIMIT,
  capRssGuids,
  type FolderWatcherState,
  type RssWatcherState,
  type UrlWatcherState,
  type Watcher,
  type WatcherLastState,
} from '../../shared/watch';
import { parseRssOrAtom, type RssFeedItem } from './rss-parser';
import {
  diffFolderSnapshots,
  hasFolderChanges,
  scanFolderSnapshot,
  type FolderChangeSet,
} from './folder-scan';
import {
  buildTruncatedUrlDiff,
  extractWatchableText,
  hashText,
  URL_STATE_TEXT_MAX_BYTES,
} from './url-watch';
import { truncateUtf8 } from '../autonomy/unified-diff';

export interface FolderDetectionResult {
  kind: 'folder';
  hasNews: boolean;
  baselineOnly: boolean;
  changes: FolderChangeSet;
  nextState: FolderWatcherState;
}

export interface RssDetectionResult {
  kind: 'rss';
  hasNews: boolean;
  baselineOnly: boolean;
  newItems: RssFeedItem[];
  nextState: RssWatcherState;
}

export interface UrlDetectionResult {
  kind: 'url';
  hasNews: boolean;
  baselineOnly: boolean;
  diff: string;
  nextState: UrlWatcherState;
}

export type WatchDetectionResult =
  | FolderDetectionResult
  | RssDetectionResult
  | UrlDetectionResult;

export async function detectWatcherChanges(
  watcher: Watcher
): Promise<WatchDetectionResult> {
  if (watcher.type === 'folder') {
    return detectFolderChanges(watcher);
  }
  if (watcher.type === 'rss') {
    return detectRssChanges(watcher);
  }
  return detectUrlChanges(watcher);
}

async function detectFolderChanges(watcher: Watcher): Promise<FolderDetectionResult> {
  const snapshot = await scanFolderSnapshot(watcher.target);
  const nextState: FolderWatcherState = { kind: 'folder', files: snapshot.files };
  const previous =
    watcher.lastState?.kind === 'folder' ? watcher.lastState.files : null;

  if (previous === null) {
    return {
      kind: 'folder',
      hasNews: false,
      baselineOnly: true,
      changes: { added: [], modified: [], deleted: [] },
      nextState,
    };
  }

  const changes = diffFolderSnapshots(previous, snapshot.files);
  return {
    kind: 'folder',
    hasNews: hasFolderChanges(changes),
    baselineOnly: false,
    changes,
    nextState,
  };
}

async function detectRssChanges(watcher: Watcher): Promise<RssDetectionResult> {
  const response = await executeHttpRequest({
    url: watcher.target,
    method: 'GET',
    timeoutMs: 20_000,
  });
  const items = parseRssOrAtom(response.body);
  const currentGuids = items.map((item) => item.guid).filter(Boolean);
  const previousGuids =
    watcher.lastState?.kind === 'rss' ? watcher.lastState.guids : null;

  const nextState: RssWatcherState = {
    kind: 'rss',
    guids: capRssGuids(
      [...currentGuids, ...(previousGuids ?? [])],
      WATCH_RSS_GUID_LIMIT
    ),
  };

  if (previousGuids === null) {
    return {
      kind: 'rss',
      hasNews: false,
      baselineOnly: true,
      newItems: [],
      nextState: { kind: 'rss', guids: capRssGuids(currentGuids, WATCH_RSS_GUID_LIMIT) },
    };
  }

  const seen = new Set(previousGuids);
  const newItems = items.filter((item) => item.guid && !seen.has(item.guid));
  return {
    kind: 'rss',
    hasNews: newItems.length > 0,
    baselineOnly: false,
    newItems,
    nextState,
  };
}

async function detectUrlChanges(watcher: Watcher): Promise<UrlDetectionResult> {
  const response = await executeHttpRequest({
    url: watcher.target,
    method: 'GET',
    timeoutMs: 20_000,
  });
  const text = extractWatchableText(response.body, response.contentType);
  const hash = hashText(text);
  const storedText = truncateUtf8(text, URL_STATE_TEXT_MAX_BYTES);
  const nextState: UrlWatcherState = { kind: 'url', hash, text: storedText };

  const previous = watcher.lastState?.kind === 'url' ? watcher.lastState : null;
  if (previous === null) {
    return {
      kind: 'url',
      hasNews: false,
      baselineOnly: true,
      diff: '',
      nextState,
    };
  }

  if (previous.hash === hash) {
    return {
      kind: 'url',
      hasNews: false,
      baselineOnly: false,
      diff: '',
      nextState: previous,
    };
  }

  const diff = buildTruncatedUrlDiff(watcher.target, previous.text, text);
  return {
    kind: 'url',
    hasNews: true,
    baselineOnly: false,
    diff,
    nextState,
  };
}

export function formatDetectionMaterial(
  watcher: Watcher,
  result: WatchDetectionResult
): string {
  const header = `### ${watcher.type}: ${watcher.label || watcher.target}`;
  if (result.kind === 'folder') {
    const lines = [header];
    if (result.changes.added.length > 0) {
      lines.push('Added:');
      for (const file of result.changes.added.slice(0, 50)) {
        lines.push(`- ${file}`);
      }
    }
    if (result.changes.modified.length > 0) {
      lines.push('Modified:');
      for (const file of result.changes.modified.slice(0, 50)) {
        lines.push(`- ${file}`);
      }
    }
    if (result.changes.deleted.length > 0) {
      lines.push('Deleted:');
      for (const file of result.changes.deleted.slice(0, 50)) {
        lines.push(`- ${file}`);
      }
    }
    return lines.join('\n');
  }
  if (result.kind === 'rss') {
    const lines = [header, 'New items:'];
    for (const item of result.newItems.slice(0, 30)) {
      const title = item.title || '(untitled)';
      const link = item.link ? ` — ${item.link}` : '';
      const date = item.pubDate ? ` (${item.pubDate})` : '';
      lines.push(`- ${title}${link}${date}`);
    }
    return lines.join('\n');
  }
  return `${header}\n\`\`\`diff\n${result.diff}\n\`\`\``;
}

/** Type guard helper for tests / callers updating lastState. */
export function asWatcherLastState(state: WatcherLastState): WatcherLastState {
  return state;
}
