/**
 * Filesystem store for run checkpoints (pre-images + journal).
 * No git dependency — plain copy + JSON journal under userData/checkpoints.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { isPathWithinRoot } from '../tools/path-containment';
import { log, logWarn } from '../utils/logger';
import {
  CHECKPOINT_DEFAULT_RETENTION,
  CHECKPOINT_JOURNAL_FILENAME,
  CHECKPOINT_JOURNAL_VERSION,
  CHECKPOINT_MAX_BYTES_PER_RUN,
  CHECKPOINT_PREIMAGES_DIRNAME,
  type CheckpointAction,
  type CheckpointCaptureSource,
  type CheckpointJournal,
  type CheckpointJournalEntry,
  type CheckpointRestoreResult,
  type CheckpointRunSummary,
} from './types';

function getCheckpointsRoot(): string {
  return path.join(app.getPath('userData'), 'checkpoints');
}

function sessionDir(sessionId: string): string {
  return path.join(getCheckpointsRoot(), sanitizeId(sessionId));
}

function runDir(sessionId: string, runId: string): string {
  return path.join(sessionDir(sessionId), sanitizeId(runId));
}

function journalPath(sessionId: string, runId: string): string {
  return path.join(runDir(sessionId, runId), CHECKPOINT_JOURNAL_FILENAME);
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readJournal(sessionId: string, runId: string): CheckpointJournal | null {
  const filePath = journalPath(sessionId, runId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CheckpointJournal;
    if (raw.version !== CHECKPOINT_JOURNAL_VERSION || !Array.isArray(raw.entries)) {
      return null;
    }
    return raw;
  } catch (error) {
    logWarn('[Checkpoints] Failed to read journal:', error);
    return null;
  }
}

function writeJournal(journal: CheckpointJournal): void {
  const dir = runDir(journal.sessionId, journal.runId);
  ensureDir(dir);
  const tmp = journalPath(journal.sessionId, journal.runId) + '.tmp';
  const finalPath = journalPath(journal.sessionId, journal.runId);
  fs.writeFileSync(tmp, JSON.stringify(journal, null, 2), 'utf-8');
  fs.renameSync(tmp, finalPath);
}

function listRunIds(sessionId: string): string[] {
  const dir = sessionDir(sessionId);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function journalToSummary(journal: CheckpointJournal): CheckpointRunSummary {
  return {
    sessionId: journal.sessionId,
    runId: journal.runId,
    createdAt: journal.createdAt,
    endedAt: journal.endedAt,
    partialCoverage: journal.partialCoverage,
    restoredAt: journal.restoredAt,
    messageIds: [...journal.messageIds],
    files: journal.entries.map((entry) => ({ path: entry.path, action: entry.action })),
  };
}

function encodePreImageRelativePath(absolutePath: string): string {
  const hash = Buffer.from(absolutePath, 'utf-8').toString('base64url');
  const base = path.basename(absolutePath).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  return path.join(CHECKPOINT_PREIMAGES_DIRNAME, `${base}.${hash}.bin`);
}

export interface CaptureFileParams {
  sessionId: string;
  runId: string;
  absolutePath: string;
  workspaceRoot: string;
  source: CheckpointCaptureSource;
  maxBytes?: number;
}

export type CaptureFileResult =
  | { status: 'captured'; action: CheckpointAction; partialCoverage: boolean }
  | { status: 'skipped'; reason: 'disabled' | 'already-covered' | 'outside-workspace' | 'partial' }
  | { status: 'partial-stop'; reason: 'budget-exceeded' };

/**
 * Create an empty journal for a new run.
 */
export function createRunJournal(
  sessionId: string,
  runId: string,
  workspaceRoot: string
): CheckpointJournal {
  const journal: CheckpointJournal = {
    version: CHECKPOINT_JOURNAL_VERSION,
    sessionId,
    runId,
    createdAt: Date.now(),
    workspaceRoot,
    partialCoverage: false,
    bytesCaptured: 0,
    entries: [],
    messageIds: [],
  };
  writeJournal(journal);
  return journal;
}

export function finalizeRunJournal(sessionId: string, runId: string): CheckpointJournal | null {
  const journal = readJournal(sessionId, runId);
  if (!journal) {
    return null;
  }
  journal.endedAt = Date.now();
  writeJournal(journal);
  return journal;
}

export function registerMessageId(sessionId: string, runId: string, messageId: string): void {
  const journal = readJournal(sessionId, runId);
  if (!journal) {
    return;
  }
  if (journal.messageIds.includes(messageId)) {
    return;
  }
  journal.messageIds.push(messageId);
  writeJournal(journal);
}

/**
 * Capture a pre-image for the first mutation of `absolutePath` in this run.
 * Subsequent captures for the same path are no-ops.
 */
export function captureFilePreImage(params: CaptureFileParams): CaptureFileResult {
  const {
    sessionId,
    runId,
    absolutePath,
    workspaceRoot,
    source,
    maxBytes = CHECKPOINT_MAX_BYTES_PER_RUN,
  } = params;

  const normalizedPath = path.normalize(absolutePath);
  const caseInsensitive = process.platform === 'win32';
  if (!isPathWithinRoot(normalizedPath, workspaceRoot, caseInsensitive)) {
    return { status: 'skipped', reason: 'outside-workspace' };
  }

  const journal = readJournal(sessionId, runId);
  if (!journal) {
    return { status: 'skipped', reason: 'disabled' };
  }

  if (journal.entries.some((entry) => pathsEqual(entry.path, normalizedPath))) {
    return { status: 'skipped', reason: 'already-covered' };
  }

  if (journal.partialCoverage) {
    return { status: 'skipped', reason: 'partial' };
  }

  const exists = fs.existsSync(normalizedPath);
  if (!exists) {
    const entry: CheckpointJournalEntry = {
      path: normalizedPath,
      action: 'created',
      capturedAt: Date.now(),
      source,
    };
    journal.entries.push(entry);
    writeJournal(journal);
    return { status: 'captured', action: 'created', partialCoverage: false };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(normalizedPath);
  } catch {
    return { status: 'skipped', reason: 'outside-workspace' };
  }
  if (!stat.isFile()) {
    return { status: 'skipped', reason: 'outside-workspace' };
  }

  if (journal.bytesCaptured + stat.size > maxBytes) {
    journal.partialCoverage = true;
    writeJournal(journal);
    log(
      `[Checkpoints] Run ${runId} hit ${maxBytes} byte cap — further capture stopped (partial coverage)`
    );
    return { status: 'partial-stop', reason: 'budget-exceeded' };
  }

  const relativePreImage = encodePreImageRelativePath(normalizedPath);
  const absolutePreImage = path.join(runDir(sessionId, runId), relativePreImage);
  ensureDir(path.dirname(absolutePreImage));
  try {
    fs.copyFileSync(normalizedPath, absolutePreImage);
  } catch (error) {
    logWarn('[Checkpoints] Failed to copy pre-image:', normalizedPath, error);
    return { status: 'skipped', reason: 'outside-workspace' };
  }

  journal.bytesCaptured += stat.size;
  journal.entries.push({
    path: normalizedPath,
    action: 'modified',
    preImagePath: relativePreImage,
    capturedAt: Date.now(),
    source,
  });
  writeJournal(journal);
  return { status: 'captured', action: 'modified', partialCoverage: false };
}

function pathsEqual(a: string, b: string): boolean {
  if (process.platform === 'win32') {
    return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
  }
  return path.normalize(a) === path.normalize(b);
}

export function getRunSummary(sessionId: string, runId: string): CheckpointRunSummary | null {
  const journal = readJournal(sessionId, runId);
  return journal ? journalToSummary(journal) : null;
}

export function findRunForMessage(
  sessionId: string,
  messageId: string
): CheckpointRunSummary | null {
  for (const runId of listRunIds(sessionId)) {
    const journal = readJournal(sessionId, runId);
    if (journal?.messageIds.includes(messageId)) {
      return journalToSummary(journal);
    }
  }
  return null;
}

export function listSessionRunSummaries(sessionId: string): CheckpointRunSummary[] {
  const summaries: CheckpointRunSummary[] = [];
  for (const runId of listRunIds(sessionId)) {
    const journal = readJournal(sessionId, runId);
    if (journal) {
      summaries.push(journalToSummary(journal));
    }
  }
  return summaries.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Restore files from pre-images in reverse journal order.
 * - `modified` → rewrite pre-image contents
 * - `created` → unlink if still present
 */
export function restoreRun(
  sessionId: string,
  runId: string,
  options?: { refuseIfActive?: boolean; isSessionActive?: () => boolean }
): CheckpointRestoreResult {
  if (options?.refuseIfActive && options.isSessionActive?.()) {
    return {
      ok: false,
      error: 'run_in_progress',
      restored: [],
      deleted: [],
      partialCoverage: false,
    };
  }

  const journal = readJournal(sessionId, runId);
  if (!journal) {
    return {
      ok: false,
      error: 'not_found',
      restored: [],
      deleted: [],
      partialCoverage: false,
    };
  }

  const restored: string[] = [];
  const deleted: string[] = [];
  const baseDir = runDir(sessionId, runId);

  for (const entry of [...journal.entries].reverse()) {
    try {
      if (entry.action === 'created') {
        if (fs.existsSync(entry.path)) {
          fs.unlinkSync(entry.path);
          deleted.push(entry.path);
        }
        continue;
      }
      if (!entry.preImagePath) {
        continue;
      }
      const preImage = path.join(baseDir, entry.preImagePath);
      if (!fs.existsSync(preImage)) {
        logWarn('[Checkpoints] Missing pre-image for restore:', entry.path);
        continue;
      }
      ensureDir(path.dirname(entry.path));
      fs.copyFileSync(preImage, entry.path);
      restored.push(entry.path);
    } catch (error) {
      logWarn('[Checkpoints] Restore failed for', entry.path, error);
    }
  }

  journal.restoredAt = Date.now();
  writeJournal(journal);

  return {
    ok: true,
    restored,
    deleted,
    partialCoverage: journal.partialCoverage,
  };
}

/**
 * Keep the N most recent runs for a session; delete older run directories.
 */
export function purgeOldRuns(
  sessionId: string,
  retention: number = CHECKPOINT_DEFAULT_RETENTION
): number {
  const summaries = listSessionRunSummaries(sessionId);
  if (summaries.length <= retention) {
    return 0;
  }
  const toDelete = summaries.slice(retention);
  let purged = 0;
  for (const summary of toDelete) {
    const dir = runDir(sessionId, summary.runId);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      purged += 1;
    } catch (error) {
      logWarn('[Checkpoints] Failed to purge run dir:', dir, error);
    }
  }
  return purged;
}

export function purgeSessionCheckpoints(sessionId: string): void {
  const dir = sessionDir(sessionId);
  if (!fs.existsSync(dir)) {
    return;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    log('[Checkpoints] Purged session checkpoints:', sessionId);
  } catch (error) {
    logWarn('[Checkpoints] Failed to purge session checkpoints:', error);
  }
}

/** Test helpers — expose paths without Electron when overridden. */
export const checkpointStorePaths = {
  getCheckpointsRoot,
  sessionDir,
  runDir,
  journalPath,
  readJournal,
  writeJournal,
};
