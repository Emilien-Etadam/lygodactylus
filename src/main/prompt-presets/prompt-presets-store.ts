/**
 * @module main/prompt-presets/prompt-presets-store
 *
 * Local library of reusable prompt presets (encrypted electron-store in userData).
 */
import { randomUUID } from 'node:crypto';
import Store from 'electron-store';
import { createAppEncryptedStore } from '../utils/app-store';
import {
  detectTemplateVariables,
  type PromptPreset,
  type PromptPresetCreateInput,
  type PromptPresetUpdateInput,
} from '../../shared/prompt-presets';

interface PromptPresetsStoreData extends Record<string, unknown> {
  presets: PromptPreset[];
}

function normalizeName(name: string): string {
  return name.trim();
}

function normalizeOptionalText(value: string | null | undefined): string {
  if (value == null) return '';
  return value.trim();
}

export class PromptPresetsStore {
  private store: Store<PromptPresetsStoreData>;

  constructor() {
    this.store = createAppEncryptedStore<PromptPresetsStoreData>({
      name: 'prompt-presets',
      defaults: {
        presets: [],
      },
      logPrefix: '[PromptPresetsStore]',
    }) as Store<PromptPresetsStoreData>;
  }

  list(): PromptPreset[] {
    return [...this.store.get('presets', [])].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): PromptPreset | undefined {
    return this.store.get('presets', []).find((preset) => preset.id === id);
  }

  getByName(name: string): PromptPreset | undefined {
    const needle = normalizeName(name).toLowerCase();
    if (!needle) return undefined;
    return this.store.get('presets', []).find((preset) => preset.name.toLowerCase() === needle);
  }

  create(input: PromptPresetCreateInput): PromptPreset {
    const name = normalizeName(input.name);
    if (!name) {
      throw new Error('Preset name is required');
    }
    const text = input.text ?? '';
    const description = normalizeOptionalText(input.description);
    const systemPrompt = normalizeOptionalText(input.systemPrompt);
    const now = Date.now();
    const preset: PromptPreset = {
      id: randomUUID(),
      name,
      description,
      text,
      systemPrompt,
      variables: detectTemplateVariables(text, systemPrompt),
      createdAt: now,
      updatedAt: now,
    };

    const presets = this.store.get('presets', []);
    presets.push(preset);
    this.store.set('presets', presets);
    return preset;
  }

  update(id: string, updates: PromptPresetUpdateInput): PromptPreset | null {
    const presets = this.store.get('presets', []);
    const index = presets.findIndex((preset) => preset.id === id);
    if (index < 0) {
      return null;
    }

    const current = presets[index];
    const name =
      updates.name === undefined ? current.name : normalizeName(updates.name);
    if (!name) {
      throw new Error('Preset name is required');
    }

    const text = updates.text === undefined ? current.text : updates.text;
    const description =
      updates.description === undefined
        ? current.description
        : normalizeOptionalText(updates.description);
    const systemPrompt =
      updates.systemPrompt === undefined
        ? current.systemPrompt
        : normalizeOptionalText(updates.systemPrompt);

    const next: PromptPreset = {
      ...current,
      name,
      description,
      text,
      systemPrompt,
      variables: detectTemplateVariables(text, systemPrompt),
      updatedAt: Date.now(),
    };

    presets[index] = next;
    this.store.set('presets', presets);
    return next;
  }

  /** Upsert helper used by settings UI (create when id absent). */
  save(preset: PromptPreset): PromptPreset {
    const presets = this.store.get('presets', []);
    const index = presets.findIndex((item) => item.id === preset.id);
    const normalized: PromptPreset = {
      ...preset,
      name: normalizeName(preset.name),
      description: normalizeOptionalText(preset.description),
      systemPrompt: normalizeOptionalText(preset.systemPrompt),
      variables: detectTemplateVariables(preset.text, preset.systemPrompt),
      updatedAt: Date.now(),
    };
    if (!normalized.name) {
      throw new Error('Preset name is required');
    }

    if (index >= 0) {
      normalized.createdAt = presets[index].createdAt;
      presets[index] = normalized;
    } else {
      normalized.createdAt = preset.createdAt || Date.now();
      presets.push(normalized);
    }
    this.store.set('presets', presets);
    return normalized;
  }

  delete(id: string): boolean {
    const presets = this.store.get('presets', []);
    const next = presets.filter((preset) => preset.id !== id);
    if (next.length === presets.length) {
      return false;
    }
    this.store.set('presets', next);
    return true;
  }
}

export const promptPresetsStore = new PromptPresetsStore();
