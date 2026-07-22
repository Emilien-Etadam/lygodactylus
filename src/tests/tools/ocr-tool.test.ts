import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOcrCustomTools } from '../../main/agent/agent-runner-ocr-tool';

const savedEnv = { ...process.env };

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ocr-tool-'));
  const file = path.join(dir, 'doc.pdf');
  await writeFile(file, '%PDF-1.4 fake', 'utf8');
  return file;
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

type ExecFn = (
  toolCallId: string,
  params: unknown,
  signal?: AbortSignal,
  onUpdate?: (partial: { content: Array<{ text: string }>; details: unknown }) => void
) => Promise<{ content: Array<{ text: string }>; details: unknown }>;

function getTool(): { execute: ExecFn } {
  const tool = buildOcrCustomTools().find((t) => t.name === 'ocr_document');
  if (!tool) throw new Error('ocr_document tool missing');
  // ctx (5th arg) is unused by this tool; narrow to the args the tests drive.
  return { execute: tool.execute as unknown as ExecFn };
}

describe('ocr_document tool', () => {
  beforeEach(() => {
    process.env.LYGO_OCR_URL = 'http://ocr.test:9110';
    process.env.LYGO_OCR_API_KEY = 'secret';
    process.env.LYGO_OCR_POLL_MS = '1';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registers both name aliases with a flat schema', () => {
    const tools = buildOcrCustomTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['OcrDocument', 'ocr_document']);
    const props = (tools[0].parameters as { properties: Record<string, unknown> }).properties;
    // flat schema: every field is a scalar (no nested object/array)
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['file_path', 'force_ocr', 'typo', 'split', 'figures', 'pages'])
    );
  });

  it('submits the file, polls until done, and returns the markdown', async () => {
    const file = await tempFile();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(202, { job_id: 'job1', pages: 3 }))
      .mockResolvedValueOnce(jsonResponse(200, { status: 'running', stage: 'pages', page_done: 1 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'done',
          result: { markdown: '# Titre\n\nDu texte.', pages: 3, stats: { concordant: 2 } },
        })
      );
    vi.stubGlobal('fetch', fetchImpl);

    const updates: string[] = [];
    const result = await getTool().execute(
      'call1',
      { file_path: file, force_ocr: true, typo: true },
      undefined,
      (partial) => updates.push((partial.content[0] as { text: string }).text)
    );

    // submission: POST /parse with the API key header
    const [submitUrl, submitInit] = fetchImpl.mock.calls[0];
    expect(submitUrl).toBe('http://ocr.test:9110/parse');
    expect((submitInit.headers as Record<string, string>)['X-API-Key']).toBe('secret');
    expect(submitInit.method).toBe('POST');
    // polling hits the job endpoint
    expect(fetchImpl.mock.calls[1][0]).toBe('http://ocr.test:9110/jobs/job1');

    expect((result.content[0] as { text: string }).text).toBe('# Titre\n\nDu texte.');
    expect(result.details).toMatchObject({ jobId: 'job1', status: 'done', truncated: false });
    expect(updates.length).toBeGreaterThan(0); // progress reported
  });

  it('throws a clear error when the job fails', async () => {
    const file = await tempFile();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(202, { job_id: 'job2', pages: 1 }))
        .mockResolvedValueOnce(jsonResponse(200, { status: 'error', error: 'boom' }))
    );
    await expect(
      getTool().execute('c', { file_path: file }, undefined, undefined)
    ).rejects.toThrow(/boom/);
  });

  it('throws an actionable error when the service is unreachable', async () => {
    const file = await tempFile();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(
      getTool().execute('c', { file_path: file }, undefined, undefined)
    ).rejects.toThrow(/unreachable[\s\S]*LYGO_OCR_URL/);
  });

  it('rejects a missing file before any network call', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    await expect(
      getTool().execute('c', { file_path: '/no/such/file.pdf' }, undefined, undefined)
    ).rejects.toThrow(/not found/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('truncates an oversized markdown result', async () => {
    const file = await tempFile();
    process.env.LYGO_OCR_MAX_CHARS = '10';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(202, { job_id: 'job3', pages: 1 }))
        .mockResolvedValueOnce(
          jsonResponse(200, { status: 'done', result: { markdown: 'x'.repeat(500) } })
        )
    );
    const result = await getTool().execute('c', { file_path: file }, undefined, undefined);
    expect((result.content[0] as { text: string }).text).toContain('truncated');
    expect(result.details).toMatchObject({ truncated: true });
  });
});
