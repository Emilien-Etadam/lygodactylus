import { describe, expect, it } from 'vitest';
import type { Message, TraceStep } from '../../renderer/types';
import {
  collectWebSourcesForAssistantMessage,
  getTurnMessages,
} from '../../renderer/utils/web-citation-sources';
import { WEB_CITATION_INDEX_PREFIX } from '../../shared/web-citation';

function msg(
  partial: Pick<Message, 'id' | 'role'> & Partial<Message> & { content?: Message['content'] }
): Message {
  return {
    sessionId: 'sess-1',
    timestamp: Date.now(),
    content: partial.content ?? [],
    ...partial,
  };
}

describe('collectWebSourcesForAssistantMessage', () => {
  it('extracts sources from web_search tool_results in the current turn', () => {
    const user = msg({
      id: 'u1',
      role: 'user',
      content: [{ type: 'text', text: 'cherche' }],
    });
    const toolUse = msg({
      id: 'a1',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call-1', name: 'web_search', input: { query: 'q' } }],
    });
    const toolResult = msg({
      id: 'a2',
      role: 'assistant',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'call-1',
          content: `${WEB_CITATION_INDEX_PREFIX}
[1] Alpha — https://alpha.test
[2] Beta — https://beta.test

Query: q`,
        },
      ],
    });
    const answer = msg({
      id: 'a3',
      role: 'assistant',
      content: [{ type: 'text', text: 'Réponse avec [1].' }],
    });

    const sources = collectWebSourcesForAssistantMessage(
      [user, toolUse, toolResult, answer],
      answer,
      []
    );
    expect(sources).toEqual([
      { index: 1, title: 'Alpha', url: 'https://alpha.test' },
      { index: 2, title: 'Beta', url: 'https://beta.test' },
    ]);
  });

  it('falls back to trace steps when message tool_results lack an index', () => {
    const user = msg({
      id: 'u1',
      role: 'user',
      content: [{ type: 'text', text: 'fetch' }],
    });
    const toolUse = msg({
      id: 'a1',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'call-f', name: 'web_fetch', input: { url: 'https://ex.test' } },
      ],
    });
    const answer = msg({
      id: 'a2',
      role: 'assistant',
      content: [{ type: 'text', text: 'Voir [1].' }],
    });
    const steps: TraceStep[] = [
      {
        id: 'call-f',
        type: 'tool_call',
        status: 'completed',
        title: 'Web Fetch',
        toolName: 'web_fetch',
        toolOutput: `${WEB_CITATION_INDEX_PREFIX}
[1] ex.test — https://ex.test

URL: https://ex.test`,
        timestamp: Date.now(),
      },
    ];

    expect(collectWebSourcesForAssistantMessage([user, toolUse, answer], answer, steps)).toEqual([
      { index: 1, title: 'ex.test', url: 'https://ex.test' },
    ]);
  });

  it('does not leak sources from a previous turn', () => {
    const prevUser = msg({ id: 'u0', role: 'user', content: [{ type: 'text', text: 'old' }] });
    const prevTool = msg({
      id: 'a0',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'old-call', name: 'web_search', input: {} },
        {
          type: 'tool_result',
          toolUseId: 'old-call',
          content: `${WEB_CITATION_INDEX_PREFIX}
[1] Old — https://old.test`,
        },
      ],
    });
    const user = msg({ id: 'u1', role: 'user', content: [{ type: 'text', text: 'new' }] });
    const answer = msg({
      id: 'a1',
      role: 'assistant',
      content: [{ type: 'text', text: 'Pas de web.' }],
    });

    expect(
      collectWebSourcesForAssistantMessage([prevUser, prevTool, user, answer], answer, [])
    ).toEqual([]);
    expect(getTurnMessages([prevUser, prevTool, user, answer], answer).map((m) => m.id)).toEqual([
      'u1',
      'a1',
    ]);
  });
});
