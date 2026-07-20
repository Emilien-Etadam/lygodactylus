import { Type, type TSchema } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { configStore } from '../config/config-store';
import { runWebSearch } from '../../shared/web-search';
import type { WebCitationCounter } from '../../shared/web-citation';
import {
  beginPiiScrubSession,
  piiMaskedDetails,
  scrubQueryForEgress,
  unscrubTextForModel,
} from './pii-scrub-egress';

const webSearchParameters = Type.Object({
  query: Type.String({ description: 'Search query' }),
});

function createWebSearchTool(
  name: string,
  label: string,
  citationCounter?: WebCitationCounter
): ToolDefinition<TSchema, unknown> {
  return {
    name,
    label,
    description:
      'Search the web for up-to-date information. Uses the configured search provider (DuckDuckGo or a self-hosted metasearch engine).',
    parameters: webSearchParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const record =
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
      const query = typeof record.query === 'string' ? record.query : '';
      const config = configStore.get('webSearch');
      const piiSession = beginPiiScrubSession();
      const scrubbedQuery = scrubQueryForEgress(query, piiSession);
      const text = await runWebSearch(scrubbedQuery, config, { citationCounter });
      return {
        content: [{ type: 'text' as const, text: unscrubTextForModel(text, piiSession) }],
        details: piiMaskedDetails(piiSession),
      };
    },
  };
}

export function buildWebSearchCustomTools(
  citationCounter?: WebCitationCounter
): ToolDefinition[] {
  return [
    createWebSearchTool('web_search', 'Web Search', citationCounter),
    createWebSearchTool('websearch', 'Web Search', citationCounter),
    createWebSearchTool('WebSearch', 'Web Search', citationCounter),
  ];
}
