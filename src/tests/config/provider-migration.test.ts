import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../main/config/config-schema';
import { normalizeConfig } from '../../main/config/config-normalizer';
import {
  migrateLegacyConfig,
  migrateLegacyProfileKey,
  migrateLegacyProviderType,
} from '../../main/config/provider-migration';

describe('provider migration', () => {
  it('maps legacy openrouter provider to openai by default', () => {
    expect(migrateLegacyProviderType('openrouter', { model: 'openai/gpt-4.1' })).toBe('openai');
  });

  it('maps legacy openrouter anthropic-prefixed models to anthropic', () => {
    expect(
      migrateLegacyProviderType('openrouter', { model: 'anthropic/claude-sonnet-4-6' })
    ).toBe('anthropic');
  });

  it('maps legacy gemini and ollama providers to openai', () => {
    expect(migrateLegacyProviderType('gemini')).toBe('openai');
    expect(migrateLegacyProviderType('ollama')).toBe('openai');
    expect(migrateLegacyProviderType('vllm')).toBe('openai');
  });

  it('maps legacy profile keys into openai or anthropic profiles', () => {
    expect(migrateLegacyProfileKey('gemini')).toBe('openai');
    expect(migrateLegacyProfileKey('ollama')).toBe('openai');
    expect(migrateLegacyProfileKey('openrouter', { model: 'gpt-4.1' })).toBe('openai');
    expect(
      migrateLegacyProfileKey('openrouter', { model: 'anthropic/claude-sonnet-4-6' })
    ).toBe('anthropic');
  });

  it('migrates flat legacy config fields into the openai profile', () => {
    const migrated = migrateLegacyConfig({
      provider: 'openrouter' as unknown as AppConfig['provider'],
      apiKey: 'sk-or-legacy',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'qwen/qwen3-8b',
      enableThinking: true,
    });

    expect(migrated.provider).toBe('openai');
    expect(migrated.activeProfileKey).toBe('openai');
    expect(migrated.profiles?.openai).toEqual({
      apiKey: 'sk-or-legacy',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'qwen/qwen3-8b',
    });
  });

  it('migrates legacy gemini profile data into the openai profile', () => {
    const migrated = migrateLegacyConfig({
      provider: 'gemini' as unknown as AppConfig['provider'],
      profiles: {
        gemini: {
          apiKey: 'gem-key',
          baseUrl: 'https://generativelanguage.googleapis.com',
          model: 'gemini-2.0-flash',
        },
      } as AppConfig['profiles'],
      activeProfileKey: 'gemini' as unknown as AppConfig['activeProfileKey'],
    });

    expect(migrated.provider).toBe('openai');
    expect(migrated.activeProfileKey).toBe('openai');
    expect(migrated.profiles?.openai).toEqual({
      apiKey: 'gem-key',
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: 'gemini-2.0-flash',
    });
  });

  it('reads claudeCodePath once into agentCliPath without persisting the legacy field', () => {
    const normalized = normalizeConfig({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'qwen3.5:0.8b',
      claudeCodePath: '/usr/bin/claude',
    });

    expect(normalized.agentCliPath).toBe('/usr/bin/claude');
    expect(normalized.claudeCodePath).toBe('');
  });

  it('normalizes legacy config sets to modern provider types', () => {
    const normalized = normalizeConfig({
      provider: 'openai',
      apiKey: '',
      model: '',
      configSets: [
        {
          id: 'default',
          name: 'Default',
          isSystem: true,
          provider: 'openrouter' as unknown as AppConfig['provider'],
          customProtocol: 'openai',
          activeProfileKey: 'openrouter' as unknown as AppConfig['activeProfileKey'],
          profiles: {
            openrouter: {
              apiKey: 'sk-or',
              baseUrl: 'https://openrouter.ai/api/v1',
              model: 'qwen/qwen3-8b',
            },
          } as AppConfig['profiles'],
          enableThinking: false,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      activeConfigSetId: 'default',
    });

    expect(normalized.provider).toBe('openai');
    expect(normalized.configSets[0]?.provider).toBe('openai');
    expect(normalized.configSets[0]?.activeProfileKey).toBe('openai');
    expect(normalized.profiles.openai?.apiKey).toBe('sk-or');
  });
});
