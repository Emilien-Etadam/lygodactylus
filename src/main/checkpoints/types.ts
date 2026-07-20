/**
 * Checkpoint / pre-image types for « Annuler les changements de ce run ».
 * Storage layout: userData/checkpoints/<sessionId>/<runId>/
 */

export type CheckpointAction = 'modified' | 'created';

export type CheckpointCaptureSource = 'write' | 'edit' | 'watcher';

export interface CheckpointJournalEntry {
  /** Absolute path of the workspace file. */
  path: string;
  action: CheckpointAction;
  /** Relative path under the run directory (pre-images/…). Absent when action is `created`. */
  preImagePath?: string;
  capturedAt: number;
  source: CheckpointCaptureSource;
}

export interface CheckpointJournal {
  version: 1;
  sessionId: string;
  runId: string;
  createdAt: number;
  endedAt?: number;
  workspaceRoot: string;
  /** True when the 50 MiB cap stopped further pre-image capture. */
  partialCoverage: boolean;
  bytesCaptured: number;
  entries: CheckpointJournalEntry[];
  /** Assistant message ids produced during this run (for UI association). */
  messageIds: string[];
  restoredAt?: number;
}

export interface CheckpointRunSummary {
  sessionId: string;
  runId: string;
  createdAt: number;
  endedAt?: number;
  partialCoverage: boolean;
  restoredAt?: number;
  messageIds: string[];
  files: Array<{ path: string; action: CheckpointAction }>;
}

export interface CheckpointRestoreResult {
  ok: boolean;
  error?: string;
  restored: string[];
  deleted: string[];
  partialCoverage: boolean;
}

export const CHECKPOINT_JOURNAL_VERSION = 1 as const;
export const CHECKPOINT_MAX_BYTES_PER_RUN = 50 * 1024 * 1024;
export const CHECKPOINT_DEFAULT_RETENTION = 10;
export const CHECKPOINT_JOURNAL_FILENAME = 'journal.json';
export const CHECKPOINT_PREIMAGES_DIRNAME = 'pre-images';
