/** Line-block size for workspace file chunking. */
export const SEMANTIC_CHUNK_LINE_COUNT = 60;

/** Overlap between consecutive line chunks. */
export const SEMANTIC_CHUNK_OVERLAP_LINES = 10;

/** Skip files larger than this (bytes). */
export const SEMANTIC_MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Hard cap on indexed files per workspace. */
export const SEMANTIC_MAX_FILES = 5_000;

export const SEMANTIC_DEFAULT_TOP_K = 10;

export const SEMANTIC_MAX_TOP_K = 50;

/** Debounce for chokidar incremental re-embed. */
export const SEMANTIC_WATCH_DEBOUNCE_MS = 400;

/** Excerpt length stored / returned for hits. */
export const SEMANTIC_EXCERPT_MAX_CHARS = 400;

/**
 * Text-file extension allowlist (lowercase, with leading dot).
 * Complements basename allowlist for extension-less text files.
 */
export const SEMANTIC_ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.swift',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.hh',
  '.cs',
  '.php',
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.vue',
  '.svelte',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.r',
  '.lua',
  '.pl',
  '.pm',
  '.scala',
  '.dart',
  '.gradle',
  '.cmake',
  '.graphql',
  '.gql',
  '.proto',
  '.tf',
  '.hcl',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
  '.csv',
  '.tsv',
  '.env',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
  '.nvmrc',
  '.npmrc',
]);

/** Extension-less basenames treated as text. */
export const SEMANTIC_ALLOWED_BASENAMES: ReadonlySet<string> = new Set([
  'makefile',
  'dockerfile',
  'containerfile',
  'license',
  'licence',
  'copying',
  'authors',
  'contributors',
  'changelog',
  'readme',
  'gemfile',
  'rakefile',
  'procfile',
  'vagrantfile',
]);

/** Always ignored directory names (in addition to .gitignore). */
export const SEMANTIC_ALWAYS_IGNORE_DIR_NAMES: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  '.cowork-user-data',
  'dist',
  'dist-electron',
  'coverage',
  '__pycache__',
  '.turbo',
  '.next',
  '.cache',
]);
