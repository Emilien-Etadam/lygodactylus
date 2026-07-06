/**
 * @module main/chat-lan-server/web-action
 *
 * Browser extension endpoint: translate / summarize / extract / custom via LLM streaming.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import { runPiAiOneShotStream } from '../agent/pi-ai-one-shot';
import { configStore } from '../config/config-store';
import { logError } from '../utils/logger';
import { applyChatLanSecurityHeaders, isWebActionAuthorized } from './chat-lan-auth';
import { applyWebActionCors } from './chat-lan-cors';

export const MAX_WEB_ACTION_CONTENT_CHARS = 200_000;
const MAX_BODY_BYTES = 1024 * 1024;

export type WebActionType = 'translate' | 'summarize' | 'extract' | 'custom';

export interface WebActionRequest {
  action: WebActionType;
  content: string;
  url: string;
  title: string;
  selection: boolean;
  targetLang: string | null;
  prompt: string | null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('request_body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  applyChatLanSecurityHeaders(res);
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeSseError(res: ServerResponse, message: string): void {
  if (res.headersSent) {
    writeSseEvent(res, 'error', { message });
    res.end();
    return;
  }
  applyChatLanSecurityHeaders(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
  });
  writeSseEvent(res, 'error', { message });
  res.end();
}

function parseWebActionRequest(raw: string): WebActionRequest {
  const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  const action = body.action;
  if (
    action !== 'translate' &&
    action !== 'summarize' &&
    action !== 'extract' &&
    action !== 'custom'
  ) {
    throw new Error('invalid_action');
  }

  const content = typeof body.content === 'string' ? body.content : '';
  const pageUrl = typeof body.url === 'string' ? body.url : '';
  const title = typeof body.title === 'string' ? body.title : '';
  const selection = Boolean(body.selection);
  const targetLang =
    body.targetLang === null || typeof body.targetLang === 'string' ? body.targetLang : null;
  const prompt = body.prompt === null || typeof body.prompt === 'string' ? body.prompt : null;

  return {
    action,
    content,
    url: pageUrl,
    title,
    selection,
    targetLang,
    prompt,
  };
}

export function validateWebActionRequest(request: WebActionRequest): string | null {
  if (!request.content.trim()) {
    return 'missing_content';
  }
  if (request.content.length > MAX_WEB_ACTION_CONTENT_CHARS) {
    return 'content_too_large';
  }
  if (request.action === 'translate' && !request.targetLang?.trim()) {
    return 'missing_target_lang';
  }
  if (
    (request.action === 'extract' || request.action === 'custom') &&
    !request.prompt?.trim()
  ) {
    return 'missing_prompt';
  }
  return null;
}

export function buildWebActionSystemPrompt(request: WebActionRequest): string {
  const scope = request.selection ? 'sélection' : 'page entière';
  const meta = `Source : ${request.title || '(sans titre)'} (${request.url || 'URL inconnue'}), ${scope}.`;

  switch (request.action) {
    case 'translate':
      return [
        `Tu traduis fidèlement le contenu fourni vers ${request.targetLang}.`,
        'Préserve la structure (paragraphes, listes).',
        'Réponds uniquement avec le texte traduit, sans commentaire ni métadonnée.',
        meta,
      ].join(' ');
    case 'summarize':
      return [
        'Tu résumes le contenu fourni de façon concise en français.',
        'Mets en avant les points clés.',
        'Réponds uniquement avec le résumé, sans commentaire.',
        meta,
      ].join(' ');
    case 'extract':
      return [
        `Extrais du contenu fourni ce qui suit : ${request.prompt}`,
        'Réponds en Markdown structuré.',
        'N’ajoute pas de commentaire hors extraction.',
        meta,
      ].join(' ');
    case 'custom':
      return [
        `Exécute la consigne suivante sur le contenu fourni : ${request.prompt}`,
        'Réponds uniquement avec le résultat demandé.',
        meta,
      ].join(' ');
  }
}

export function buildWebActionUserPrompt(request: WebActionRequest): string {
  return request.content;
}

export async function handleWebAction(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL
): Promise<void> {
  const method = req.method || 'GET';
  const corsResult = applyWebActionCors(req, res);

  if (method === 'OPTIONS') {
    if (corsResult !== 'allowed') {
      json(res, 403, { error: 'cors_forbidden' });
      return;
    }
    applyChatLanSecurityHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (method !== 'POST') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }

  if (corsResult === 'forbidden') {
    json(res, 403, { error: 'cors_forbidden' });
    return;
  }

  if (!isWebActionAuthorized(req)) {
    json(res, 401, { error: 'unauthorized' });
    return;
  }

  let request: WebActionRequest;
  try {
    const raw = await readBody(req);
    request = parseWebActionRequest(raw);
  } catch (error) {
    if (error instanceof Error && error.message === 'request_body_too_large') {
      json(res, 413, { error: 'request_body_too_large' });
      return;
    }
    json(res, 400, { error: 'invalid_json' });
    return;
  }

  const validationError = validateWebActionRequest(request);
  if (validationError === 'content_too_large') {
    json(res, 413, { error: 'content_too_large' });
    return;
  }
  if (validationError) {
    json(res, 400, { error: validationError });
    return;
  }

  if (!configStore.hasUsableCredentialsForActiveSet()) {
    json(res, 400, { error: 'api_not_configured' });
    return;
  }

  applyChatLanSecurityHeaders(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
  });
  res.write('\n');

  try {
    const systemPrompt = buildWebActionSystemPrompt(request);
    const userPrompt = buildWebActionUserPrompt(request);
    const config = configStore.getAll();

    await runPiAiOneShotStream(
      userPrompt,
      systemPrompt,
      config,
      (delta) => {
        writeSseEvent(res, 'chunk', { text: delta });
      }
    );

    writeSseEvent(res, 'done', {});
    res.end();
  } catch (error) {
    logError('[ChatLan] web-action failed:', error);
    const message = error instanceof Error ? error.message : 'internal_error';
    writeSseError(res, message);
  }
}
