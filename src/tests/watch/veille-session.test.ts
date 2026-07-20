import { describe, expect, it } from 'vitest';
import {
  VEILLE_SESSION_TITLE,
  findVeilleSession,
  resolveVeilleSessionAction,
  isVeilleSessionTitle,
} from '../../shared/watch';

describe('Veille session identity', () => {
  it('recognizes the internal title', () => {
    expect(isVeilleSessionTitle(VEILLE_SESSION_TITLE)).toBe(true);
    expect(isVeilleSessionTitle('Other')).toBe(false);
  });

  it('reuses an existing Veille session like Quick Ask', () => {
    const sessions = [
      { id: '1', title: 'Chat' },
      { id: '2', title: VEILLE_SESSION_TITLE },
    ];
    expect(findVeilleSession(sessions)?.id).toBe('2');
    expect(resolveVeilleSessionAction(sessions)).toEqual({
      action: 'reuse',
      sessionId: '2',
    });
    expect(resolveVeilleSessionAction([{ id: '1', title: 'Chat' }])).toEqual({
      action: 'create',
    });
  });
});
