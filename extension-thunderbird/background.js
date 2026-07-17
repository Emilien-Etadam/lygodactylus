/**
 * @file Service de fond : menus (message affiché + composition), extraction du
 * texte de l'e-mail, appel streaming à /api/web-action du Chat LAN, insertion du
 * résultat dans la fenêtre de composition.
 *
 * Réutilise le mécanisme SSE de l'extension Firefox « Lygodactylus Web ».
 */

/* global messenger, LygoMailPrompts */

const STORAGE_KEYS = {
  serverUrl: 'serverUrl',
  extensionToken: 'extensionToken',
  defaultTargetLang: 'defaultTargetLang',
};

const DEFAULT_SETTINGS = {
  serverUrl: 'http://localhost:19890',
  extensionToken: '',
  defaultTargetLang: 'fr',
};

/** @typedef {object} Job
 * @property {string} action
 * @property {object} payload
 * @property {number|null} composeTabId
 * @property {string} title
 * @property {number|null} windowId
 * @property {AbortController|null} controller
 */

/** @type {Map<string, Job>} */
const jobs = new Map();

async function loadSettings() {
  const stored = await messenger.storage.local.get(Object.values(STORAGE_KEYS));
  return {
    serverUrl: typeof stored.serverUrl === 'string' ? stored.serverUrl : DEFAULT_SETTINGS.serverUrl,
    extensionToken:
      typeof stored.extensionToken === 'string'
        ? stored.extensionToken
        : DEFAULT_SETTINGS.extensionToken,
    defaultTargetLang:
      typeof stored.defaultTargetLang === 'string'
        ? stored.defaultTargetLang
        : DEFAULT_SETTINGS.defaultTargetLang,
  };
}

function normalizeServerUrl(serverUrl) {
  return serverUrl.trim().replace(/\/+$/, '');
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Recursively pull readable text out of a getFull() MIME part tree, preferring
 * text/plain and falling back to stripped text/html.
 * @param {object} part
 * @returns {string}
 */
function extractBodyFromPart(part) {
  if (!part) {
    return '';
  }
  if (Array.isArray(part.parts) && part.parts.length > 0) {
    const plains = [];
    const htmls = [];
    for (const child of part.parts) {
      const text = extractBodyFromPart(child);
      if (!text) {
        continue;
      }
      if ((child.contentType || '').startsWith('text/html')) {
        htmls.push(text);
      } else {
        plains.push(text);
      }
    }
    if (plains.length > 0) {
      return plains.join('\n\n');
    }
    return htmls.join('\n\n');
  }
  if (typeof part.body === 'string') {
    return (part.contentType || '').startsWith('text/html') ? stripHtml(part.body) : part.body;
  }
  return '';
}

/**
 * @param {number} tabId
 * @returns {Promise<{ content: string, title: string }>}
 */
async function collectDisplayedMessage(tabId) {
  const message = await messenger.messageDisplay.getDisplayedMessage(tabId);
  if (!message) {
    throw new Error('Aucun e-mail affiché.');
  }
  const full = await messenger.messages.getFull(message.id);
  const content = extractBodyFromPart(full).trim();
  if (!content) {
    throw new Error("Impossible de lire le contenu de l'e-mail.");
  }
  return { content, title: message.subject || '' };
}

/**
 * @param {number} tabId
 * @returns {Promise<{ content: string, title: string, isPlainText: boolean }>}
 */
async function collectComposeBody(tabId) {
  const details = await messenger.compose.getComposeDetails(tabId);
  const isPlainText = Boolean(details.isPlainText);
  const raw = isPlainText ? details.plainTextBody || '' : stripHtml(details.body || '');
  return { content: raw.trim(), title: details.subject || '', isPlainText };
}

// --- Menus -----------------------------------------------------------------

const READ_ACTIONS = [
  { id: 'summarize', title: 'Résumer' },
  { id: 'translate', title: 'Traduire' },
  { id: 'analyze-intent', title: 'Analyser le ton / l’intention' },
  { id: 'explain', title: 'Expliquer' },
  { id: 'check-errors', title: 'Vérifier les erreurs' },
  { id: 'custom', title: 'Prompt libre…' },
];

const COMPOSE_SIMPLE_ACTIONS = [
  { id: 'improve', title: 'Suggérer des améliorations' },
  { id: 'check-errors', title: 'Vérifier les erreurs' },
  { id: 'custom', title: 'Prompt libre…' },
];

const COMPOSE_TONE_ACTIONS = [
  { id: 'suggest-reply', title: 'Suggérer une réponse' },
  { id: 'rephrase', title: 'Reformuler' },
];

function registerMenus() {
  messenger.menus.removeAll().then(() => {
    for (const action of READ_ACTIONS) {
      messenger.menus.create({
        id: `mdisp:${action.id}`,
        title: action.title,
        contexts: ['message_display_action_menu'],
      });
    }

    for (const parent of COMPOSE_TONE_ACTIONS) {
      const parentId = `comp-parent:${parent.id}`;
      messenger.menus.create({
        id: parentId,
        title: parent.title,
        contexts: ['compose_action_menu'],
      });
      for (const tone of LygoMailPrompts.TONES) {
        messenger.menus.create({
          id: `comp:${parent.id}:${tone.id}`,
          parentId,
          title: tone.label,
          contexts: ['compose_action_menu'],
        });
      }
    }

    for (const action of COMPOSE_SIMPLE_ACTIONS) {
      messenger.menus.create({
        id: `comp:${action.id}:`,
        title: action.title,
        contexts: ['compose_action_menu'],
      });
    }
  });
}

messenger.runtime.onInstalled.addListener(registerMenus);
messenger.runtime.onStartup.addListener(registerMenus);
registerMenus();

messenger.menus.onClicked.addListener(async (info, tab) => {
  const menuId = String(info.menuItemId);
  let action = 'custom';
  try {
    if (menuId.startsWith('mdisp:')) {
      action = menuId.slice('mdisp:'.length);
      await startReadAction(action, tab.id);
    } else if (menuId.startsWith('comp:')) {
      const rest = menuId.slice('comp:'.length);
      const sep = rest.indexOf(':');
      action = sep >= 0 ? rest.slice(0, sep) : rest;
      const tone = sep >= 0 ? rest.slice(sep + 1) : '';
      await startComposeAction(action, tone, tab.id);
    }
  } catch (error) {
    await openResultWindow({
      action,
      payload: null,
      composeTabId: null,
      title: '',
      immediateError: error instanceof Error ? error.message : 'Action impossible.',
    });
  }
});

// --- Action launchers ------------------------------------------------------

function newJobId() {
  return `job-${Date.now()}-${Math.floor(performance.now())}`;
}

async function promptForCustom() {
  // Compose/message windows have no prompt(); ask via a lightweight window is
  // overkill, so custom prompt is entered in the result window itself.
  return '';
}

async function startReadAction(action, tabId) {
  const settings = await loadSettings();
  const { content, title } = await collectDisplayedMessage(tabId);
  const payload = LygoMailPrompts.buildWebActionPayload(action, {
    content,
    title,
    language: settings.defaultTargetLang,
    targetLang: settings.defaultTargetLang,
  });
  await openResultWindow({ action, payload, composeTabId: null, title });
}

async function startComposeAction(action, tone, tabId) {
  const settings = await loadSettings();
  const { content, title } = await collectComposeBody(tabId);
  if (!content) {
    throw new Error('La fenêtre de composition est vide.');
  }
  const payload = LygoMailPrompts.buildWebActionPayload(action, {
    content,
    title,
    language: settings.defaultTargetLang,
    tone,
  });
  await openResultWindow({
    action,
    payload,
    composeTabId: LygoMailPrompts.isComposeAction(action) ? tabId : null,
    title,
  });
}

/**
 * @param {{ action: string, payload: object|null, composeTabId: number|null,
 *           title: string, immediateError?: string }} spec
 */
async function openResultWindow(spec) {
  const jobId = newJobId();
  jobs.set(jobId, {
    action: spec.action,
    payload: spec.payload,
    composeTabId: spec.composeTabId,
    title: spec.title,
    windowId: null,
    controller: null,
    immediateError: spec.immediateError || null,
  });

  const url =
    messenger.runtime.getURL('result/result.html') +
    `?job=${encodeURIComponent(jobId)}` +
    `&action=${encodeURIComponent(spec.action)}` +
    `&insert=${spec.composeTabId != null ? '1' : '0'}`;

  const win = await messenger.windows.create({
    url,
    type: 'popup',
    width: 520,
    height: 620,
    allowScriptsToClose: true,
  });
  const job = jobs.get(jobId);
  if (job) {
    job.windowId = win.id ?? null;
  }
}

// --- Streaming (SSE) -------------------------------------------------------

function send(message) {
  messenger.runtime.sendMessage(message).catch(() => {
    // result window may have been closed
  });
}

async function readErrorBody(response) {
  try {
    const data = await response.json();
    if (data && typeof data.error === 'string') {
      return data.error;
    }
  } catch {
    // ignore
  }
  return response.statusText || 'Erreur HTTP';
}

async function runStream(jobId) {
  const job = jobs.get(jobId);
  if (!job || !job.payload) {
    return;
  }
  const settings = await loadSettings();
  const token = settings.extensionToken.trim();
  const serverUrl = normalizeServerUrl(settings.serverUrl);

  if (!serverUrl) {
    send({ type: 'result:error', jobId, message: 'URL du serveur non configurée (options).' });
    return;
  }
  if (!token) {
    send({ type: 'result:error', jobId, message: 'Token extension manquant (options).' });
    return;
  }

  const controller = new AbortController();
  job.controller = controller;

  let response;
  try {
    response = await fetch(`${serverUrl}/api/web-action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(job.payload),
      signal: controller.signal,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Requête annulée.'
        : 'Erreur réseau : impossible de joindre le serveur Lygodactylus.';
    send({ type: 'result:error', jobId, message });
    return;
  }

  if (response.status === 401) {
    send({
      type: 'result:error',
      jobId,
      message:
        'Authentification refusée (401). Utilisez le token extension (Réglages → Chat LAN), pas le token global.',
    });
    return;
  }
  if (!response.ok) {
    const detail = await readErrorBody(response);
    send({ type: 'result:error', jobId, message: `Erreur serveur (${response.status}) : ${detail}` });
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    send({ type: 'result:error', jobId, message: 'Réponse streaming invalide du serveur.' });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = consumeSse(buffer, jobId);
    }
    buffer += decoder.decode();
    consumeSse(buffer, jobId, true);
    send({ type: 'result:done', jobId });
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) {
      send({
        type: 'result:error',
        jobId,
        message: error instanceof Error ? error.message : 'Erreur de lecture du flux.',
      });
    }
  }
}

function consumeSse(buffer, jobId, flush = false) {
  const blocks = buffer.split('\n\n');
  const remainder = flush ? '' : blocks.pop() || '';
  for (const block of blocks) {
    if (!block.trim()) {
      continue;
    }
    let eventName = 'message';
    let dataLine = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLine = line.slice(5).trim();
      }
    }
    if (!dataLine) {
      continue;
    }
    try {
      const data = JSON.parse(dataLine);
      if (eventName === 'chunk' && typeof data.text === 'string') {
        send({ type: 'result:chunk', jobId, text: data.text });
      } else if (eventName === 'error') {
        send({
          type: 'result:error',
          jobId,
          message: typeof data.message === 'string' ? data.message : 'Erreur du serveur.',
        });
      }
    } catch {
      // malformed SSE block ignored
    }
  }
  return remainder;
}

// --- Messaging from the result window --------------------------------------

messenger.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'result:ready') {
    const job = jobs.get(message.jobId);
    if (!job) {
      sendResponse({ ok: false, error: 'Tâche introuvable.' });
      return false;
    }
    const needsPrompt = job.action === 'custom' && !(job.payload && job.payload.prompt);
    sendResponse({
      ok: true,
      action: job.action,
      title: job.title,
      canInsert: job.composeTabId != null,
      needsPrompt,
      immediateError: job.immediateError,
    });
    if (!job.immediateError && job.payload && !needsPrompt) {
      void runStream(message.jobId);
    }
    return false;
  }

  if (message.type === 'result:runCustom') {
    const job = jobs.get(message.jobId);
    if (!job) {
      sendResponse({ ok: false });
      return false;
    }
    // Fill the custom prompt entered in the result window, then start.
    if (job.payload && typeof message.prompt === 'string') {
      job.payload.prompt = message.prompt.trim();
      void runStream(message.jobId);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'result:insert') {
    const job = jobs.get(message.jobId);
    if (!job || job.composeTabId == null || typeof message.text !== 'string') {
      sendResponse({ ok: false });
      return false;
    }
    applyToCompose(job.composeTabId, message.text)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Échec.' })
      );
    return true;
  }

  if (message.type === 'result:cancel') {
    const job = jobs.get(message.jobId);
    job?.controller?.abort();
    return false;
  }

  if (message.type === 'result:closed') {
    const job = jobs.get(message.jobId);
    job?.controller?.abort();
    jobs.delete(message.jobId);
    return false;
  }

  return false;
});

/**
 * @param {number} composeTabId
 * @param {string} text
 */
async function applyToCompose(composeTabId, text) {
  const details = await messenger.compose.getComposeDetails(composeTabId);
  if (details.isPlainText) {
    const body = details.plainTextBody || '';
    const next = body.trim() ? `${text}\n\n${body}` : text;
    await messenger.compose.setComposeDetails(composeTabId, { plainTextBody: next });
  } else {
    const html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paragraphs = html
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
    const next = `${paragraphs}${details.body || ''}`;
    await messenger.compose.setComposeDetails(composeTabId, { body: next });
  }
}

// Abort the stream if the result window is closed by the user.
messenger.windows.onRemoved.addListener((windowId) => {
  for (const [jobId, job] of jobs) {
    if (job.windowId === windowId) {
      job.controller?.abort();
      jobs.delete(jobId);
    }
  }
});

void promptForCustom;
