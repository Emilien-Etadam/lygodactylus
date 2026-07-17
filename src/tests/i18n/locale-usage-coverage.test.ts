import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import en from '../../renderer/i18n/locales/en.json';

type JsonObject = Record<string, unknown>;

function flattenKeys(obj: JsonObject, prefix = '', out: Set<string> = new Set()): Set<string> {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenKeys(value as JsonObject, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

const enKeys = flattenKeys(en as unknown as JsonObject);

const PLURAL_SUFFIXES = ['_one', '_other', '_zero', '_two', '_few', '_many', '_plural'] as const;

function keyExists(key: string): boolean {
  if (enKeys.has(key)) return true;
  return PLURAL_SUFFIXES.some((suffix) => enKeys.has(`${key}${suffix}`));
}

const STATIC_KEY_PATTERN =
  /(?:^|[^\w.])(?:i18n\.)?t\(\s*['"]([a-zA-Z][a-zA-Z0-9_.]*)['"]/g;
const I18N_KEY_ATTR_PATTERN = /i18nKey=['"]([a-zA-Z][a-zA-Z0-9_.]*)['"]/g;

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'locales') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, out);
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('renderer i18n key coverage', () => {
  it('every static t()/i18nKey reference exists in en.json (including plural forms)', () => {
    const root = join(__dirname, '../../renderer');
    const missing: string[] = [];

    for (const file of walkSourceFiles(root)) {
      const text = readFileSync(file, 'utf8');
      const keys = new Set<string>();
      for (const match of text.matchAll(STATIC_KEY_PATTERN)) {
        keys.add(match[1]);
      }
      for (const match of text.matchAll(I18N_KEY_ATTR_PATTERN)) {
        keys.add(match[1]);
      }
      for (const key of keys) {
        if (!keyExists(key)) {
          missing.push(`${file.replace(/\\/g, '/').split('/src/renderer/').pop()}: ${key}`);
        }
      }
    }

    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('covers known dynamic diagnostic fix codes used by the backend', () => {
    const requiredFixCodes = [
      'dns_resolve_failed',
      'tcp_connect_failed',
      'tls_handshake_failed',
      'missing_api_key',
      'auth_invalid_key',
      'auth_request_failed',
      'auth_probe_deferred',
      'models_list_not_supported',
      'model_network_error',
      'model_rate_limited',
      'model_request_failed',
      'model_unavailable',
      'ollama_no_models_loaded',
      'ollama_model_not_listed',
      'ollama_model_loading',
      'model_cold_start',
      'auth_endpoint_not_found',
    ];

    const missing = requiredFixCodes
      .map((code) => `api.diagnostic.fix.${code}`)
      .filter((key) => !enKeys.has(key));

    expect(missing).toEqual([]);
  });
});
