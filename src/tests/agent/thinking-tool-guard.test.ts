import { describe, expect, it } from 'vitest';
import {
  disableThinkingWhenToolsPresent,
  payloadHasTools,
} from '../../main/agent/thinking-tool-guard';

describe('thinking-tool-guard', () => {
  describe('payloadHasTools', () => {
    it('is true when tools is a non-empty array', () => {
      expect(payloadHasTools({ tools: [{ type: 'function' }] })).toBe(true);
    });

    it('is false for empty / missing / non-array tools and non-objects', () => {
      expect(payloadHasTools({ tools: [] })).toBe(false);
      expect(payloadHasTools({})).toBe(false);
      expect(payloadHasTools({ tools: 'nope' })).toBe(false);
      expect(payloadHasTools(null)).toBe(false);
      expect(payloadHasTools([{ tools: [1] }])).toBe(false);
    });
  });

  describe('disableThinkingWhenToolsPresent', () => {
    it('forces enable_thinking=false when tools are present, keeping sibling kwargs', () => {
      const out = disableThinkingWhenToolsPresent({
        model: 'qwen3.6-27b',
        tools: [{ type: 'function', function: { name: 'get_weather' } }],
        chat_template_kwargs: { enable_thinking: true, preserve_thinking: true },
      });
      expect(out.chat_template_kwargs).toEqual({
        enable_thinking: false,
        preserve_thinking: true,
      });
      expect(out.model).toBe('qwen3.6-27b');
      expect(out.tools).toEqual([{ type: 'function', function: { name: 'get_weather' } }]);
    });

    it('adds chat_template_kwargs when absent (overrides a server-side default)', () => {
      const out = disableThinkingWhenToolsPresent({ tools: [{ type: 'function' }] });
      expect(out.chat_template_kwargs).toEqual({ enable_thinking: false });
    });

    it('returns the same reference (no-op) when there are no tools', () => {
      const input = { model: 'x', chat_template_kwargs: { enable_thinking: true } };
      expect(disableThinkingWhenToolsPresent(input)).toBe(input);
    });

    it('returns the same reference (no-op) when thinking is already disabled', () => {
      const input = {
        tools: [{ type: 'function' }],
        chat_template_kwargs: { enable_thinking: false },
      };
      expect(disableThinkingWhenToolsPresent(input)).toBe(input);
    });

    it('does not mutate the input payload', () => {
      const input = {
        tools: [{ type: 'function' }],
        chat_template_kwargs: { enable_thinking: true },
      };
      disableThinkingWhenToolsPresent(input);
      expect(input.chat_template_kwargs.enable_thinking).toBe(true);
    });
  });
});
