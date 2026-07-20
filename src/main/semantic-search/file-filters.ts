import path from 'node:path';
import {
  SEMANTIC_ALLOWED_BASENAMES,
  SEMANTIC_ALLOWED_EXTENSIONS,
  SEMANTIC_MAX_FILE_BYTES,
  SEMANTIC_MAX_FILES,
} from './constants';

/** True when the relative path matches the text-file allowlist. */
export function isAllowedTextFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const base = path.posix.basename(normalized).toLowerCase();
  if (SEMANTIC_ALLOWED_BASENAMES.has(base)) {
    return true;
  }
  // Dotenv variants: `.env`, `.env.local`, `.env.example`
  if (base === '.env' || base.startsWith('.env.')) {
    return true;
  }
  // Multi-dot names like `file.d.ts` (ends with an allowlisted extension)
  for (const ext of SEMANTIC_ALLOWED_EXTENSIONS) {
    if (base.endsWith(ext)) {
      return true;
    }
  }
  const ext = path.posix.extname(base);
  return Boolean(ext && SEMANTIC_ALLOWED_EXTENSIONS.has(ext));
}

export function isWithinFileSizeLimit(sizeBytes: number): boolean {
  return Number.isFinite(sizeBytes) && sizeBytes >= 0 && sizeBytes <= SEMANTIC_MAX_FILE_BYTES;
}

/** Keep discovery order; truncate to the hard file cap. */
export function clampFileList(files: string[], maxFiles = SEMANTIC_MAX_FILES): string[] {
  if (files.length <= maxFiles) {
    return files;
  }
  return files.slice(0, maxFiles);
}

export function getSemanticMaxFileBytes(): number {
  return SEMANTIC_MAX_FILE_BYTES;
}

export function getSemanticMaxFiles(): number {
  return SEMANTIC_MAX_FILES;
}
