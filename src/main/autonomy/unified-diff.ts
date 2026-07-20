/**
 * Minimal unified diff (no extra dependency).
 * Good enough for careful-mode whole-file approve/deny — not hunk-level.
 */

const DEFAULT_CONTEXT = 3;

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  // Keep trailing empty line semantics consistent with common diff tools.
  const lines = text.split('\n');
  if (text.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}

/**
 * Longest common subsequence index pairs (simple O(n*m) DP).
 * Caps work for very large files by falling back to a coarse dump.
 */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  // Cap to keep careful-mode responsive (~2k×2k cells).
  if (n * m > 4_000_000) {
    return [];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i]![j] = (dp[i + 1]![j + 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
      }
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

export function createUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
  contextLines: number = DEFAULT_CONTEXT
): string {
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);
  if (oldLines.length === 0 && newLines.length === 0) {
    return `--- a/${filePath}\n+++ b/${filePath}\n`;
  }

  const pairs = lcsPairs(oldLines, newLines);
  if (pairs.length === 0 && oldLines.length * newLines.length > 4_000_000) {
    // Coarse fallback: show file as full replace without line alignment.
    const body = [
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
      ...oldLines.map((line) => `-${line}`),
      ...newLines.map((line) => `+${line}`),
    ];
    return [`--- a/${filePath}`, `+++ b/${filePath}`, ...body].join('\n');
  }

  type Op = { kind: 'equal' | 'del' | 'add'; line: string };
  const ops: Op[] = [];
  let oi = 0;
  let nj = 0;
  for (const [pi, pj] of pairs) {
    while (oi < pi) {
      ops.push({ kind: 'del', line: oldLines[oi]! });
      oi += 1;
    }
    while (nj < pj) {
      ops.push({ kind: 'add', line: newLines[nj]! });
      nj += 1;
    }
    ops.push({ kind: 'equal', line: oldLines[oi]! });
    oi += 1;
    nj += 1;
  }
  while (oi < oldLines.length) {
    ops.push({ kind: 'del', line: oldLines[oi]! });
    oi += 1;
  }
  while (nj < newLines.length) {
    ops.push({ kind: 'add', line: newLines[nj]! });
    nj += 1;
  }

  // Build hunks with context.
  const changeIndexes: number[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i]!.kind !== 'equal') {
      changeIndexes.push(i);
    }
  }
  if (changeIndexes.length === 0) {
    return [`--- a/${filePath}`, `+++ b/${filePath}`].join('\n');
  }

  const hunkRanges: Array<{ start: number; end: number }> = [];
  let rangeStart = Math.max(0, changeIndexes[0]! - contextLines);
  let rangeEnd = Math.min(ops.length, changeIndexes[0]! + 1 + contextLines);
  for (let c = 1; c < changeIndexes.length; c += 1) {
    const idx = changeIndexes[c]!;
    const nextStart = Math.max(0, idx - contextLines);
    if (nextStart <= rangeEnd) {
      rangeEnd = Math.min(ops.length, idx + 1 + contextLines);
    } else {
      hunkRanges.push({ start: rangeStart, end: rangeEnd });
      rangeStart = nextStart;
      rangeEnd = Math.min(ops.length, idx + 1 + contextLines);
    }
  }
  hunkRanges.push({ start: rangeStart, end: rangeEnd });

  const out: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  for (const { start, end } of hunkRanges) {
    let oldCount = 0;
    let newCount = 0;
    let oldStart = 1;
    let newStart = 1;
    let oldSeen = 0;
    let newSeen = 0;
    for (let i = 0; i < start; i += 1) {
      const op = ops[i]!;
      if (op.kind !== 'add') {
        oldSeen += 1;
      }
      if (op.kind !== 'del') {
        newSeen += 1;
      }
    }
    oldStart = oldSeen + 1;
    newStart = newSeen + 1;
    const body: string[] = [];
    for (let i = start; i < end; i += 1) {
      const op = ops[i]!;
      if (op.kind === 'equal') {
        body.push(` ${op.line}`);
        oldCount += 1;
        newCount += 1;
      } else if (op.kind === 'del') {
        body.push(`-${op.line}`);
        oldCount += 1;
      } else {
        body.push(`+${op.line}`);
        newCount += 1;
      }
    }
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    out.push(...body);
  }
  return out.join('\n');
}

/** Truncate a string to at most `maxBytes` UTF-8 bytes, appending a marker. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) {
    return text;
  }
  const marker = '\n…[truncated]';
  const markerBuf = Buffer.from(marker, 'utf8');
  const keep = Math.max(0, maxBytes - markerBuf.length);
  return Buffer.concat([buf.subarray(0, keep), markerBuf]).toString('utf8');
}
