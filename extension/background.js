/**
 * @file Service worker : menus contextuels, appels réseau /api/web-action, relais SSE.
 */

/** @typedef {'translate' | 'summarize' | 'extract' | 'custom'} WebActionType */

/** @typedef {object} WebActionPayload
 * @property {WebActionType} action
 * @property {string} content
 * @property {string} url
 * @property {string} title
 * @property {boolean} selection
 * @property {string|null} targetLang
 * @property {string|null} prompt
 */

/** @typedef {object} StoredSettings
 * @property {string} serverUrl
 * @property {string} extensionToken
 * @property {string} defaultTargetLang
 */

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

/** @type {Map<number, AbortController>} */
const activeStreams = new Map();

/** @type {{ action: WebActionType, tabId: number } | null} */
let pendingSidebarIntent = null;

const DOM_MODIFICATION_HINT =
  'Si la consigne demande une modification visuelle de la page web (masquer, supprimer ou remplacer du texte dans le DOM), réponds UNIQUEMENT avec un JSON valide de la forme {"operations":[{"op":"hide"|"remove"|"replaceText","selector":"<sélecteur CSS>","text":"..."}]} sans markdown ni commentaire. Pour toute autre consigne, réponds en texte libre.';

/**
 * @returns {Promise<StoredSettings>}
 */
async function loadSettings() {
  const stored = await browser.storage.local.get(Object.values(STORAGE_KEYS));
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

/**
 * @param {string} serverUrl
 * @returns {string}
 */
function normalizeServerUrl(serverUrl) {
  return serverUrl.trim().replace(/\/+$/, '');
}

/**
 * @param {number} tabId
 * @returns {Promise<{ content: string, selection: boolean, url: string, title: string }>}
 */
async function collectPageContext(tabId) {
  const response = await browser.tabs.sendMessage(tabId, { type: 'getPageContext' });
  if (!response || typeof response.content !== 'string') {
    throw new Error('Impossible de lire le contenu de la page.');
  }
  return {
    content: response.content,
    selection: Boolean(response.selection),
    url: typeof response.url === 'string' ? response.url : '',
    title: typeof response.title === 'string' ? response.title : '',
  };
}

/**
 * @param {WebActionType} action
 * @param {string|null|undefined} prompt
 * @returns {string|null}
 */
function buildPromptForAction(action, prompt) {
  const trimmed = typeof prompt === 'string' ? prompt.trim() : '';
  if (action !== 'custom' || !trimmed) {
    return trimmed || null;
  }
  return `${trimmed}\n\n${DOM_MODIFICATION_HINT}`;
}

/**
 * @param {Response} response
 * @returns {Promise<string>}
 */
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

/**
 * @param {number} streamId
 * @param {WebActionPayload} payload
 * @returns {Promise<void>}
 */
async function runWebActionStream(streamId, payload) {
  const settings = await loadSettings();
  const token = settings.extensionToken.trim();
  const serverUrl = normalizeServerUrl(settings.serverUrl);

  if (!serverUrl) {
    broadcastStreamEvent(streamId, {
      type: 'streamError',
      streamId,
      errorType: 'config',
      message: 'URL du serveur non configurée.',
    });
    return;
  }

  if (!token) {
    broadcastStreamEvent(streamId, {
      type: 'streamError',
      streamId,
      errorType: 'config',
      message: 'Token extension manquant. Configurez l’extension dans les options.',
    });
    return;
  }

  const controller = new AbortController();
  activeStreams.set(streamId, controller);

  let response;
  try {
    response = await fetch(`${serverUrl}/api/web-action`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Requête annulée.'
        : 'Erreur réseau : impossible de joindre le serveur Lygodactylus.';
    broadcastStreamEvent(streamId, {
      type: 'streamError',
      streamId,
      errorType: 'network',
      message,
    });
    activeStreams.delete(streamId);
    return;
  }

  if (response.status === 401) {
    broadcastStreamEvent(streamId, {
      type: 'streamError',
      streamId,
      errorType: 'auth',
      message:
        'Authentification refusée (401). Utilisez le token extension (Réglages → Chat LAN → Token extension), pas le token global du chat LAN.',
    });
    activeStreams.delete(streamId);
    return;
  }

  if (!response.ok) {
    const detail = await readErrorBody(response);
    broadcastStreamEvent(streamId, {
      type: 'streamError',
      streamId,
      errorType: 'http',
      message: `Erreur serveur (${response.status}) : ${detail}`,
    });
    activeStreams.delete(streamId);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    broadcastStreamEvent(streamId, {
      type: 'streamError',
      streamId,
      errorType: 'network',
      message: 'Réponse streaming invalide du serveur.',
    });
    activeStreams.delete(streamId);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = consumeSseBuffer(buffer, streamId);
    }
    buffer += decoder.decode();
    consumeSseBuffer(buffer, streamId, true);
    broadcastStreamEvent(streamId, { type: 'streamDone', streamId });
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) {
      broadcastStreamEvent(streamId, {
        type: 'streamError',
        streamId,
        errorType: 'network',
        message: error instanceof Error ? error.message : 'Erreur de lecture du flux.',
      });
    }
  } finally {
    activeStreams.delete(streamId);
  }
}

/**
 * @param {string} buffer
 * @param {number} streamId
 * @param {boolean} [flush]
 * @returns {string}
 */
function consumeSseBuffer(buffer, streamId, flush = false) {
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
        broadcastStreamEvent(streamId, { type: 'streamChunk', streamId, text: data.text });
      } else if (eventName === 'error') {
        broadcastStreamEvent(streamId, {
          type: 'streamError',
          streamId,
          errorType: 'sse',
          message: typeof data.message === 'string' ? data.message : 'Erreur du serveur.',
        });
      }
    } catch {
      // bloc SSE mal formé ignoré
    }
  }

  return remainder;
}

/**
 * @param {number} streamId
 * @param {object} message
 */
function broadcastStreamEvent(streamId, message) {
  browser.runtime.sendMessage(message).catch(() => {
    // la sidebar peut être fermée
  });
}

/**
 * @returns {Promise<browser.tabs.Tab|null>}
 */
async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

/**
 * @param {number} tabId
 */
async function openSidebarForTab(tabId) {
  await browser.sidebarAction.setPanel({ tabId, panel: 'sidebar/sidebar.html' });
  await browser.sidebarAction.open();
  // Laisse le panneau latéral enregistrer son listener avant le premier événement SSE.
  await new Promise((resolve) => setTimeout(resolve, 200));
}

/**
 * @param {number} streamId
 * @param {number} tabId
 * @param {WebActionType} action
 * @param {{ targetLang?: string, prompt?: string }} [options]
 */
async function startActionForTab(streamId, tabId, action, options = {}) {
  const settings = await loadSettings();
  const page = await collectPageContext(tabId);

  /** @type {WebActionPayload} */
  const payload = {
    action,
    content: page.content,
    url: page.url,
    title: page.title,
    selection: page.selection,
    targetLang: action === 'translate' ? options.targetLang || settings.defaultTargetLang : null,
    prompt:
      action === 'extract' || action === 'custom'
        ? buildPromptForAction(action, options.prompt ?? '')
        : null,
  };

  if (action === 'translate' && !payload.targetLang?.trim()) {
    broadcastStreamEvent(streamId, {
      type: 'streamError',
      streamId,
      errorType: 'validation',
      message: 'Langue cible requise pour la traduction.',
    });
    return;
  }

  if ((action === 'extract' || action === 'custom') && !payload.prompt?.trim()) {
    broadcastStreamEvent(streamId, {
      type: 'streamError',
      streamId,
      errorType: 'validation',
      message: 'Prompt requis pour cette action.',
    });
    return;
  }

  broadcastStreamEvent(streamId, { type: 'streamStart', streamId, action, tabId });
  void runWebActionStream(streamId, payload);
}

function registerContextMenus() {
  browser.contextMenus.removeAll().then(() => {
    browser.contextMenus.create({
      id: 'lygo-translate',
      title: 'Traduire la sélection',
      contexts: ['selection'],
    });
    browser.contextMenus.create({
      id: 'lygo-summarize',
      title: 'Résumer la page',
      contexts: ['page'],
    });
    browser.contextMenus.create({
      id: 'lygo-extract',
      title: 'Extraire…',
      contexts: ['page', 'selection'],
    });
    browser.contextMenus.create({
      id: 'lygo-custom',
      title: 'Prompt libre…',
      contexts: ['page', 'selection'],
    });
  });
}

browser.runtime.onInstalled.addListener(() => {
  registerContextMenus();
});

browser.runtime.onStartup.addListener(() => {
  registerContextMenus();
});

registerContextMenus();

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) {
    return;
  }

  const tabId = tab.id;
  const streamId = Date.now();

  if (info.menuItemId === 'lygo-translate') {
    await openSidebarForTab(tabId);
    await startActionForTab(streamId, tabId, 'translate', {});
    return;
  }

  if (info.menuItemId === 'lygo-summarize') {
    await openSidebarForTab(tabId);
    await startActionForTab(streamId, tabId, 'summarize');
    return;
  }

  if (info.menuItemId === 'lygo-extract') {
    pendingSidebarIntent = { action: 'extract', tabId };
    await openSidebarForTab(tabId);
    browser.runtime.sendMessage({ type: 'sidebarIntent', action: 'extract', tabId }).catch(() => {});
    return;
  }

  if (info.menuItemId === 'lygo-custom') {
    pendingSidebarIntent = { action: 'custom', tabId };
    await openSidebarForTab(tabId);
    browser.runtime.sendMessage({ type: 'sidebarIntent', action: 'custom', tabId }).catch(() => {});
  }
});

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'getSettings') {
    loadSettings().then((settings) => sendResponse({ settings }));
    return true;
  }

  if (message.type === 'getPendingSidebarIntent') {
    sendResponse({ intent: pendingSidebarIntent });
    pendingSidebarIntent = null;
    return false;
  }

  if (message.type === 'getActiveTabId') {
    getActiveTab().then((tab) => sendResponse({ tabId: tab?.id ?? null }));
    return true;
  }

  if (message.type === 'startWebAction') {
    const streamId = typeof message.streamId === 'number' ? message.streamId : Date.now();
    const tabId = message.tabId;
    const action = message.action;
    if (typeof tabId !== 'number' || typeof action !== 'string') {
      sendResponse({ ok: false, error: 'Paramètres invalides.' });
      return false;
    }
    startActionForTab(streamId, tabId, action, {
      targetLang: message.targetLang,
      prompt: message.prompt,
    })
      .then(() => sendResponse({ ok: true, streamId }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Échec du démarrage.',
        })
      );
    return true;
  }

  if (message.type === 'cancelWebAction') {
    const streamId = message.streamId;
    if (typeof streamId === 'number') {
      const controller = activeStreams.get(streamId);
      controller?.abort();
      activeStreams.delete(streamId);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'applyTranslation') {
    const tabId = message.tabId;
    const text = message.text;
    if (typeof tabId !== 'number' || typeof text !== 'string') {
      sendResponse({ ok: false });
      return false;
    }
    browser.tabs
      .sendMessage(tabId, { type: 'replaceSelection', text })
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: 'Impossible de modifier la page.' }));
    return true;
  }

  if (message.type === 'applyDomOperations') {
    const tabId = message.tabId;
    const rawText = message.rawText;
    if (typeof tabId !== 'number' || typeof rawText !== 'string') {
      sendResponse({ ok: false, warnings: ['Paramètres invalides.'] });
      return false;
    }
    browser.tabs
      .sendMessage(tabId, { type: 'applyDomOperations', rawText })
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, warnings: ['Impossible d’accéder à la page.'] }));
    return true;
  }

  if (message.type === 'openOptions') {
    browser.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
