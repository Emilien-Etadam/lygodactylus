import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Type, type TSchema } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

/**
 * OCR pipeline tool — submits a local document to a self-hosted ocr_vllm
 * `/parse` service (MinerU + PaddleOCR consensus, Qwen arbiter) and returns
 * the reconstructed markdown.
 *
 * Configuration is read from the environment so the tool degrades cleanly
 * when unset (default URL points at the reference deployment; the tool
 * throws a clear, actionable error when the service is unreachable):
 *   - LYGO_OCR_URL          base URL of the /parse service (default below)
 *   - LYGO_OCR_API_KEY      X-API-Key sent with every request (optional)
 *   - LYGO_OCR_MAX_WAIT_MS  give up polling after this delay (default 30 min)
 *   - LYGO_OCR_MAX_CHARS    truncate the returned markdown past this size
 *
 * Schema stays flat (scalar fields only) for reliable tool calling across
 * LiteLLM → vLLM → Qwen.
 */

const DEFAULT_OCR_URL = 'http://192.168.30.121:9110';
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_WAIT_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_CHARS = 120_000;
const SUBMIT_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 30_000;

interface OcrConfig {
  url: string;
  apiKey: string;
  maxWaitMs: number;
  maxChars: number;
  pollMs: number;
}

function positiveEnvInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function readOcrConfig(): OcrConfig {
  const url = (process.env.LYGO_OCR_URL || DEFAULT_OCR_URL).trim().replace(/\/+$/, '');
  return {
    url,
    apiKey: (process.env.LYGO_OCR_API_KEY || '').trim(),
    maxWaitMs: positiveEnvInt('LYGO_OCR_MAX_WAIT_MS', DEFAULT_MAX_WAIT_MS),
    maxChars: positiveEnvInt('LYGO_OCR_MAX_CHARS', DEFAULT_MAX_CHARS),
    pollMs: positiveEnvInt('LYGO_OCR_POLL_MS', DEFAULT_POLL_INTERVAL_MS),
  };
}

function authHeaders(config: OcrConfig): Record<string, string> {
  return config.apiKey ? { 'X-API-Key': config.apiKey } : {};
}

const ocrParameters = Type.Object({
  file_path: Type.String({
    description: 'Absolute path to a local PDF or image file to OCR.',
  }),
  force_ocr: Type.Optional(
    Type.Boolean({
      description:
        'Ignore any embedded text layer and force full OCR (for scans whose embedded OCR is poor). Default false.',
    })
  ),
  typo: Type.Optional(
    Type.Boolean({
      description:
        'Typographic fidelity pass: restore italics/bold/bullets from the page image (slower). Default false.',
    })
  ),
  split: Type.Optional(
    Type.Boolean({
      description: 'Split double-page (landscape) scans into two pages before OCR. Default false.',
    })
  ),
  figures: Type.Optional(
    Type.Boolean({
      description: 'Embed detected illustrations as images in the returned markdown. Default false.',
    })
  ),
  pages: Type.Optional(
    Type.String({
      description: 'Page selection, e.g. "1-10,15". Empty means all pages.',
    })
  ),
});

interface OcrParams {
  file_path: string;
  force_ocr?: boolean;
  typo?: boolean;
  split?: boolean;
  figures?: boolean;
  pages?: string;
}

function coerceParams(raw: unknown): OcrParams {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const filePath = typeof record.file_path === 'string' ? record.file_path.trim() : '';
  if (!filePath) {
    throw new Error('file_path is required (absolute path to a local PDF or image).');
  }
  return {
    file_path: filePath,
    force_ocr: record.force_ocr === true,
    typo: record.typo === true,
    split: record.split === true,
    figures: record.figures === true,
    pages: typeof record.pages === 'string' ? record.pages.trim() : '',
  };
}

function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('OCR polling aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('OCR polling aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  outerSignal: AbortSignal | undefined,
  what: string
): Promise<{ status: number; ok: boolean; body: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    return { status: response.status, ok: response.ok, body, text };
  } catch (error) {
    if (outerSignal?.aborted) {
      throw new Error('OCR request aborted');
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OCR service unreachable while ${what} (${url}): ${reason}. ` +
        'Check that the /parse service is running and set LYGO_OCR_URL / LYGO_OCR_API_KEY.'
    );
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onOuterAbort);
  }
}

function errorDetail(body: unknown, fallbackText: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const detail = record.detail ?? record.error;
    if (typeof detail === 'string' && detail) {
      return detail;
    }
  }
  return fallbackText.slice(0, 300);
}

async function submitDocument(
  config: OcrConfig,
  params: OcrParams,
  fileBytes: Buffer,
  signal: AbortSignal | undefined
): Promise<{ jobId: string; pages: number }> {
  const form = new FormData();
  // Copy into a plain Uint8Array: Buffer's ArrayBufferLike union is not a
  // valid BlobPart under strict lib types.
  form.append('file', new Blob([new Uint8Array(fileBytes)]), basename(params.file_path));
  form.append('force_ocr', params.force_ocr ? 'true' : 'false');
  form.append('typo', params.typo ? 'true' : 'false');
  form.append('split', params.split ? 'true' : 'false');
  form.append('figures', params.figures ? 'true' : 'false');
  if (params.pages) {
    form.append('pages', params.pages);
  }

  const result = await fetchJson(
    `${config.url}/parse`,
    { method: 'POST', headers: authHeaders(config), body: form },
    SUBMIT_TIMEOUT_MS,
    signal,
    'submitting the document'
  );
  if (!result.ok) {
    throw new Error(`OCR submission rejected (${result.status}): ${errorDetail(result.body, result.text)}`);
  }
  const record =
    result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>) : {};
  const jobId = typeof record.job_id === 'string' ? record.job_id : '';
  if (!jobId) {
    throw new Error('OCR service did not return a job_id.');
  }
  const pages = typeof record.pages === 'number' ? record.pages : 0;
  return { jobId, pages };
}

function progressLine(record: Record<string, unknown>, pages: number): string {
  const stage = typeof record.stage === 'string' ? record.stage : '';
  const message = typeof record.message === 'string' ? record.message : '';
  if (message) {
    return message;
  }
  const done = typeof record.page_done === 'number' ? record.page_done : 0;
  if (stage === 'pages' && pages > 0) {
    return `OCR page ${done}/${pages}…`;
  }
  return stage ? `${stage}…` : 'processing…';
}

function capMarkdown(markdown: string, maxChars: number): { text: string; truncated: boolean } {
  if (markdown.length <= maxChars) {
    return { text: markdown, truncated: false };
  }
  return {
    text: `${markdown.slice(0, maxChars)}\n\n…[markdown truncated at ${maxChars} characters — full result available server-side]`,
    truncated: true,
  };
}

function createOcrDocumentTool(name: string, label: string): ToolDefinition<TSchema, unknown> {
  return {
    name,
    label,
    description:
      'OCR a local PDF or image via the self-hosted ocr_vllm pipeline (MinerU + PaddleOCR consensus, Qwen visual arbiter) and return the reconstructed markdown. Submits the file, waits for the job, and returns the text. Use for scanned documents or books whose text needs high-fidelity extraction.',
    parameters: ocrParameters,
    async execute(_toolCallId, rawParams, signal, onUpdate) {
      const config = readOcrConfig();
      const params = coerceParams(rawParams);

      let fileStat;
      try {
        fileStat = await stat(params.file_path);
      } catch {
        throw new Error(`file_path not found: ${params.file_path}`);
      }
      if (!fileStat.isFile()) {
        throw new Error(`file_path is not a file: ${params.file_path}`);
      }
      const fileBytes = await readFile(params.file_path);

      const { jobId, pages } = await submitDocument(config, params, fileBytes, signal);
      onUpdate?.({
        content: [
          {
            type: 'text',
            text: `Job ${jobId} queued${pages > 0 ? ` (${pages} pages)` : ''}…`,
          },
        ],
        details: { jobId, pages, status: 'queued' },
      });

      const deadline = Date.now() + config.maxWaitMs;
      while (Date.now() < deadline) {
        if (signal?.aborted) {
          return {
            content: [
              {
                type: 'text',
                text: `OCR cancelled. Job ${jobId} may still be processing server-side.`,
              },
            ],
            details: { jobId, status: 'cancelled' },
          };
        }
        await abortableDelay(config.pollMs, signal);

        const status = await fetchJson(
          `${config.url}/jobs/${jobId}`,
          { method: 'GET', headers: authHeaders(config) },
          STATUS_TIMEOUT_MS,
          signal,
          'checking the job status'
        );
        if (!status.ok) {
          throw new Error(
            `OCR status check failed (${status.status}): ${errorDetail(status.body, status.text)}`
          );
        }
        const record =
          status.body && typeof status.body === 'object'
            ? (status.body as Record<string, unknown>)
            : {};
        const jobStatus = typeof record.status === 'string' ? record.status : 'running';

        if (jobStatus === 'done') {
          const result =
            record.result && typeof record.result === 'object'
              ? (record.result as Record<string, unknown>)
              : {};
          const markdown = typeof result.markdown === 'string' ? result.markdown : '';
          const { text, truncated } = capMarkdown(markdown, config.maxChars);
          return {
            content: [{ type: 'text', text: text || '(the OCR result is empty)' }],
            details: {
              jobId,
              status: 'done',
              pages: typeof result.pages === 'number' ? result.pages : pages,
              stats: result.stats,
              truncated,
            },
          };
        }
        if (jobStatus === 'error') {
          throw new Error(`OCR job failed: ${typeof record.error === 'string' ? record.error : 'unknown error'}`);
        }
        if (jobStatus === 'cancelled') {
          return {
            content: [{ type: 'text', text: `OCR job ${jobId} was cancelled.` }],
            details: { jobId, status: 'cancelled' },
          };
        }
        onUpdate?.({
          content: [{ type: 'text', text: progressLine(record, pages) }],
          details: { jobId, status: jobStatus },
        });
      }

      return {
        content: [
          {
            type: 'text',
            text:
              `OCR job ${jobId} is still running after ${Math.round(config.maxWaitMs / 60_000)} min. ` +
              'It continues server-side — check the ocr_vllm web UI for the result, or raise LYGO_OCR_MAX_WAIT_MS.',
          },
        ],
        details: { jobId, status: 'timeout' },
      };
    },
  };
}

/** OCR pipeline tools registered on the agent (name aliases for tool-call robustness). */
export function buildOcrCustomTools(): ToolDefinition[] {
  return [
    createOcrDocumentTool('ocr_document', 'OCR Document'),
    createOcrDocumentTool('OcrDocument', 'OCR Document'),
  ];
}
