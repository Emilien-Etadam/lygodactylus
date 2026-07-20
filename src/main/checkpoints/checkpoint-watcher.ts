/**
 * Best-effort chokidar watcher for bash (and other non-interceptable) mutations.
 *
 * Known race window: between the filesystem mutation and the first chokidar
 * notification, another writer may further change the file. We capture the
 * content observed at notification time if the path is not already covered by
 * write/edit capture — so bash coverage is best-effort, not transactional.
 */
import chokidar, { type FSWatcher } from 'chokidar';
import * as path from 'node:path';
import { log, logWarn } from '../utils/logger';
import { captureFilePreImage } from './checkpoint-store';

export interface CheckpointWatcherHandle {
  stop: () => Promise<void>;
}

const IGNORED_BASENAMES = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
  '.lygodactylus',
]);

export function startCheckpointWatcher(options: {
  sessionId: string;
  runId: string;
  workspaceRoot: string;
  /** Injected for tests. */
  watchFn?: typeof chokidar.watch;
}): CheckpointWatcherHandle {
  const watch = options.watchFn ?? chokidar.watch;
  const root = path.normalize(options.workspaceRoot);

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(root, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 40 },
      ignored: (watchedPath: string) => {
        const parts = watchedPath.split(/[/\\]/);
        return parts.some((part) => IGNORED_BASENAMES.has(part));
      },
      depth: 12,
    });
  } catch (error) {
    logWarn('[Checkpoints] Failed to start workspace watcher:', error);
    return { stop: async () => undefined };
  }

  const onFsEvent = (eventPath: string): void => {
    try {
      captureFilePreImage({
        sessionId: options.sessionId,
        runId: options.runId,
        absolutePath: path.normalize(eventPath),
        workspaceRoot: root,
        source: 'watcher',
      });
    } catch (error) {
      logWarn('[Checkpoints] Watcher capture failed:', error);
    }
  };

  watcher.on('add', onFsEvent);
  watcher.on('change', onFsEvent);
  watcher.on('unlink', onFsEvent);

  log(`[Checkpoints] Watcher started for run ${options.runId} under ${root}`);

  return {
    stop: async () => {
      if (!watcher) {
        return;
      }
      try {
        await watcher.close();
      } catch (error) {
        logWarn('[Checkpoints] Watcher stop failed:', error);
      } finally {
        watcher = null;
      }
    },
  };
}
