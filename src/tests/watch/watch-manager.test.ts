import { describe, expect, it, vi } from 'vitest';
import { WatchManager } from '../../main/watch/watch-manager';
import type { WatchDetectionResult } from '../../main/watch/watch-detect';
import { createMemoryWatchStore, makeWatcher } from './watch-test-helpers';
import type { SessionManager } from '../../main/session/session-manager';

function createManager(options: {
  detectChanges: (watcher: ReturnType<typeof makeWatcher>) => Promise<WatchDetectionResult>;
  deliverDigest?: ReturnType<typeof vi.fn>;
  sessionManager?: SessionManager | null;
}) {
  const store = createMemoryWatchStore();
  const deliverDigest =
    options.deliverDigest ??
    vi.fn(async () => ({ sessionId: 'sess-1', delivered: true }));
  const manager = new WatchManager({
    store,
    getSessionManager: () => options.sessionManager ?? ({} as SessionManager),
    detectChanges: options.detectChanges as never,
    deliverDigest: deliverDigest as never,
  });
  return { manager, store, deliverDigest };
}

describe('WatchManager digest gating', () => {
  it('sends no digest message when nothing is new', async () => {
    const { manager, store, deliverDigest } = createManager({
      detectChanges: async () => ({
        kind: 'rss',
        hasNews: false,
        baselineOnly: false,
        newItems: [],
        nextState: { kind: 'rss', guids: ['a'] },
      }),
    });

    const created = store.create({
      type: 'rss',
      target: 'https://example.com/feed.xml',
      scheduleConfig: { kind: 'daily', times: ['09:00'] },
      enabled: true,
    });
    store.update(created.id, {
      lastState: { kind: 'rss', guids: ['a'] },
    });

    const result = await manager.tickWatcher(created.id);
    expect(result.digested).toBe(false);
    expect(deliverDigest).not.toHaveBeenCalled();

    const updated = store.get(created.id);
    expect(updated?.lastState).toEqual({ kind: 'rss', guids: ['a'] });
  });

  it('baseline-only first scan stores state without digesting', async () => {
    const { manager, store, deliverDigest } = createManager({
      detectChanges: async () => ({
        kind: 'folder',
        hasNews: false,
        baselineOnly: true,
        changes: { added: [], modified: [], deleted: [] },
        nextState: { kind: 'folder', files: { '/a': 1 } },
      }),
    });

    const created = store.create({
      type: 'folder',
      target: '/tmp/watch-test',
      scheduleConfig: { kind: 'daily', times: ['09:00'] },
    });

    const result = await manager.tickWatcher(created.id);
    expect(result.digested).toBe(false);
    expect(deliverDigest).not.toHaveBeenCalled();
    expect(store.get(created.id)?.lastState).toEqual({
      kind: 'folder',
      files: { '/a': 1 },
    });
  });

  it('delivers a digest when detection reports news', async () => {
    const { manager, store, deliverDigest } = createManager({
      detectChanges: async () => ({
        kind: 'rss',
        hasNews: true,
        baselineOnly: false,
        newItems: [
          {
            title: 'News',
            link: 'https://example.com/n',
            pubDate: '',
            guid: 'g-new',
          },
        ],
        nextState: { kind: 'rss', guids: ['g-new', 'g-old'] },
      }),
    });

    const created = store.create({
      type: 'rss',
      target: 'https://example.com/feed.xml',
      scheduleConfig: { kind: 'daily', times: ['09:00'] },
    });
    store.update(created.id, { lastState: { kind: 'rss', guids: ['g-old'] } });

    const result = await manager.tickWatcher(created.id);
    expect(result.digested).toBe(true);
    expect(deliverDigest).toHaveBeenCalledTimes(1);
    expect(result.sessionId).toBe('sess-1');
  });
});

describe('capRssGuids via detection state', () => {
  it('store normalizes RSS lastState to 200 guids', () => {
    const store = createMemoryWatchStore();
    const created = store.create({
      type: 'rss',
      target: 'https://example.com/feed.xml',
      scheduleConfig: { kind: 'daily', times: ['09:00'] },
    });
    const guids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const updated = store.update(created.id, {
      lastState: { kind: 'rss', guids },
    });
    expect(updated?.lastState?.kind).toBe('rss');
    if (updated?.lastState?.kind === 'rss') {
      expect(updated.lastState.guids).toHaveLength(200);
      expect(updated.lastState.guids[0]).toBe('id-0');
    }
  });
});
