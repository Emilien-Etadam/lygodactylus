import { describe, expect, it } from 'vitest';
import {
  clampFileList,
  getSemanticMaxFileBytes,
  getSemanticMaxFiles,
  isAllowedTextFile,
  isWithinFileSizeLimit,
} from '../../main/semantic-search/file-filters';
import { SEMANTIC_MAX_FILE_BYTES, SEMANTIC_MAX_FILES } from '../../main/semantic-search/constants';

describe('semantic file filters', () => {
  it('allowlists common text/code extensions', () => {
    expect(isAllowedTextFile('src/app.ts')).toBe(true);
    expect(isAllowedTextFile('README.md')).toBe(true);
    expect(isAllowedTextFile('config.yaml')).toBe(true);
    expect(isAllowedTextFile('Makefile')).toBe(true);
    expect(isAllowedTextFile('.env.local')).toBe(true);
    expect(isAllowedTextFile('types.d.ts')).toBe(true);
  });

  it('rejects binaries and unknown extensions', () => {
    expect(isAllowedTextFile('photo.png')).toBe(false);
    expect(isAllowedTextFile('archive.zip')).toBe(false);
    expect(isAllowedTextFile('model.gguf')).toBe(false);
    expect(isAllowedTextFile('blob')).toBe(false);
  });

  it('enforces the 2 MiB size ceiling', () => {
    expect(getSemanticMaxFileBytes()).toBe(SEMANTIC_MAX_FILE_BYTES);
    expect(isWithinFileSizeLimit(0)).toBe(true);
    expect(isWithinFileSizeLimit(SEMANTIC_MAX_FILE_BYTES)).toBe(true);
    expect(isWithinFileSizeLimit(SEMANTIC_MAX_FILE_BYTES + 1)).toBe(false);
    expect(isWithinFileSizeLimit(-1)).toBe(false);
  });

  it('clamps file lists to the 5000-file cap', () => {
    expect(getSemanticMaxFiles()).toBe(SEMANTIC_MAX_FILES);
    const files = Array.from({ length: SEMANTIC_MAX_FILES + 10 }, (_, i) => `f${i}.ts`);
    const clamped = clampFileList(files);
    expect(clamped).toHaveLength(SEMANTIC_MAX_FILES);
    expect(clamped[0]).toBe('f0.ts');
    expect(clamped[clamped.length - 1]).toBe(`f${SEMANTIC_MAX_FILES - 1}.ts`);
  });
});
