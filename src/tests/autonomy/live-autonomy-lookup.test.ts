import { describe, expect, it, vi } from 'vitest';
import { normalizeSessionAutonomy } from '../../shared/session-autonomy';

/**
 * Mirrors the getAutonomy producer in agent-runner-pi-setup:
 * live ctx.getSessionAutonomy(sessionId) with fallback to the prep snapshot.
 */
function makeLiveGetAutonomy(options: {
  sessionId: string;
  prepSnapshot: 'careful' | 'normal' | 'autonomous';
  getSessionAutonomy?: (sessionId: string) => 'careful' | 'normal' | 'autonomous';
}) {
  const { sessionId, prepSnapshot, getSessionAutonomy } = options;
  return () =>
    getSessionAutonomy?.(sessionId) ?? normalizeSessionAutonomy(prepSnapshot);
}

describe('live autonomy lookup (pi-setup producer)', () => {
  it('re-reads store on every call instead of freezing the prep snapshot', () => {
    const store = { autonomy: 'normal' as const };
    const getAutonomy = makeLiveGetAutonomy({
      sessionId: 's1',
      prepSnapshot: 'normal',
      getSessionAutonomy: () => store.autonomy,
    });

    expect(getAutonomy()).toBe('normal');
    // Simulate session.setAutonomy → store update without clearing pi session.
    (store as { autonomy: 'careful' | 'normal' | 'autonomous' }).autonomy = 'careful';
    expect(getAutonomy()).toBe('careful');
    (store as { autonomy: 'careful' | 'normal' | 'autonomous' }).autonomy = 'autonomous';
    expect(getAutonomy()).toBe('autonomous');
  });

  it('falls back to prep snapshot when lookup is unavailable', () => {
    const getAutonomy = makeLiveGetAutonomy({
      sessionId: 's1',
      prepSnapshot: 'careful',
    });
    expect(getAutonomy()).toBe('careful');
  });

  it('autonomous loop decision uses live lookup over run-start snapshot', () => {
    const runStartSnapshot = 'normal' as const;
    const getSessionAutonomy = vi.fn(
      (_sessionId: string): 'careful' | 'normal' | 'autonomous' => 'autonomous'
    );
    const live =
      getSessionAutonomy('s1') ?? normalizeSessionAutonomy(runStartSnapshot);
    expect(live).toBe('autonomous');
    expect(getSessionAutonomy).toHaveBeenCalledWith('s1');
  });
});
