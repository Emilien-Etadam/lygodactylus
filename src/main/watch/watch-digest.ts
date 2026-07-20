/**
 * Send a Veille digest into the dedicated plan-mode session (create or reuse).
 */
import {
  VEILLE_SESSION_TITLE,
  resolveVeilleSessionAction,
  type Watcher,
} from '../../shared/watch';
import type { SessionManager } from '../session/session-manager';
import { log, logError } from '../utils/logger';
import { formatDetectionMaterial, type WatchDetectionResult } from './watch-detect';

export interface DigestDeliveryResult {
  sessionId: string;
  delivered: boolean;
}

export function buildDigestPrompt(
  results: Array<{ watcher: Watcher; result: WatchDetectionResult }>
): string {
  const stamp = new Date().toISOString();
  const sections = results.map(({ watcher, result }) =>
    formatDetectionMaterial(watcher, result)
  );
  return [
    `[Veille digest — ${stamp}]`,
    '',
    'New material detected from watched sources. Summarize only what is new below.',
    'Do not invent items. Do not perform write actions.',
    '',
    ...sections,
  ].join('\n');
}

/**
 * Deliver one digest message into the Veille session (plan mode).
 * Creates the session on first use; reuses by internal title afterwards.
 */
export async function deliverVeilleDigest(options: {
  sessionManager: SessionManager;
  results: Array<{ watcher: Watcher; result: WatchDetectionResult }>;
  sendSessionUpdate?: (sessionId: string, session: unknown) => void;
}): Promise<DigestDeliveryResult> {
  if (options.results.length === 0) {
    return { sessionId: '', delivered: false };
  }

  const prompt = buildDigestPrompt(options.results);
  const sessions = options.sessionManager.listSessions();
  const action = resolveVeilleSessionAction(sessions);

  try {
    if (action.action === 'create') {
      const started = await options.sessionManager.startSession(
        VEILLE_SESSION_TITLE,
        prompt,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'plan'
      );
      options.sendSessionUpdate?.(started.id, started);
      log('[Veille] Digest delivered to new session', started.id);
      return { sessionId: started.id, delivered: true };
    }

    const sessionId = action.sessionId;
    try {
      options.sessionManager.setSessionMode(sessionId, 'plan');
    } catch (error) {
      // If a run is in progress, still enqueue — mode stays whatever it was;
      // next idle digest will re-assert plan. Prefer not to drop the digest.
      logError('[Veille] Could not force plan mode before digest:', error);
    }
    await options.sessionManager.continueSession(sessionId, prompt);
    log('[Veille] Digest delivered to existing session', sessionId);
    return { sessionId, delivered: true };
  } catch (error) {
    logError('[Veille] Failed to deliver digest:', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}
