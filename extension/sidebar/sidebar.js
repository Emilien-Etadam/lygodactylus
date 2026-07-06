/**
 * @file Panneau latéral natif Firefox : actions, prompt libre, affichage streaming.
 */

/** @typedef {'translate' | 'summarize' | 'extract' | 'custom'} WebActionType */

/** @typedef {object} StoredSettings
 * @property {string} serverUrl
 * @property {string} extensionToken
 * @property {string} defaultTargetLang
 */

/** @type {WebActionType} */
let selectedAction = 'summarize';

/** @type {number|null} */
let activeTabId = null;

/** @type {number|null} */
let activeStreamId = null;

/** @type {string} */
let streamedText = '';

/** @type {StoredSettings} */
let settings = {
  serverUrl: 'http://localhost:19890',
  extensionToken: '',
  defaultTargetLang: 'fr',
};

const el = {
  targetLangSection: document.getElementById('target-lang-section'),
  targetLang: /** @type {HTMLInputElement} */ (document.getElementById('target-lang')),
  promptSection: document.getElementById('prompt-section'),
  promptLabel: document.getElementById('prompt-label'),
  promptInput: /** @type {HTMLTextAreaElement} */ (document.getElementById('prompt-input')),
  runAction: /** @type {HTMLButtonElement} */ (document.getElementById('run-action')),
  cancelAction: /** @type {HTMLButtonElement} */ (document.getElementById('cancel-action')),
  copyResult: /** @type {HTMLButtonElement} */ (document.getElementById('copy-result')),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  warnings: document.getElementById('warnings'),
  openOptions: /** @type {HTMLButtonElement} */ (document.getElementById('open-options')),
  actionButtons: Array.from(document.querySelectorAll('[data-action]')),
};

/**
 * @param {WebActionType} action
 */
function selectAction(action) {
  selectedAction = action;
  for (const button of el.actionButtons) {
    button.classList.toggle('active', button.dataset.action === action);
  }

  const needsLang = action === 'translate';
  const needsPrompt = action === 'extract' || action === 'custom';

  el.targetLangSection.classList.toggle('hidden', !needsLang);
  el.promptSection.classList.toggle('hidden', !needsPrompt);

  if (action === 'extract') {
    el.promptLabel.textContent = 'Extraction demandée';
    el.promptInput.placeholder = 'Ex. : toutes les dates et montants mentionnés';
  } else if (action === 'custom') {
    el.promptLabel.textContent = 'Prompt libre';
    el.promptInput.placeholder = 'Ex. : masque les images de cette page';
  }
}

/**
 * @param {string} message
 */
function setStatusWithOptionsLink(message) {
  el.status.classList.add('error');
  el.status.innerHTML = '';
  el.status.appendChild(document.createTextNode(`${message} `));
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'Ouvrir les options';
  link.addEventListener('click', (event) => {
    event.preventDefault();
    void browser.runtime.sendMessage({ type: 'openOptions' });
  });
  el.status.appendChild(link);
}

/**
 * @param {string} message
 * @param {'info' | 'error'} [kind]
 */
function setStatus(message, kind = 'info') {
  el.status.textContent = '';
  el.status.classList.toggle('error', kind === 'error');

  if (kind === 'error' && message.includes('options')) {
    el.status.innerHTML = '';
    const text = document.createTextNode(message.replace(/\s*options\.?\s*$/i, '').trim() + ' ');
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'Ouvrir les options';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void browser.runtime.sendMessage({ type: 'openOptions' });
    });
    el.status.appendChild(text);
    el.status.appendChild(link);
    el.status.classList.add('error');
    return;
  }

  el.status.textContent = message;
}

/**
 * @param {string[]} items
 */
function setWarnings(items) {
  if (items.length === 0) {
    el.warnings.classList.add('hidden');
    el.warnings.innerHTML = '';
    return;
  }
  el.warnings.classList.remove('hidden');
  el.warnings.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    el.warnings.appendChild(li);
  }
}

/**
 */
function resetResult() {
  streamedText = '';
  el.result.textContent = '';
  el.copyResult.disabled = true;
  setWarnings([]);
}

/**
 * @param {boolean} streaming
 */
function setStreamingState(streaming) {
  el.runAction.disabled = streaming;
  el.cancelAction.disabled = !streaming;
  for (const button of el.actionButtons) {
    button.disabled = streaming;
  }
}

/**
 * @returns {Promise<number|null>}
 */
async function resolveActiveTabId() {
  if (typeof activeTabId === 'number') {
    return activeTabId;
  }
  const response = await browser.runtime.sendMessage({ type: 'getActiveTabId' });
  activeTabId = typeof response?.tabId === 'number' ? response.tabId : null;
  return activeTabId;
}

/**
 * @returns {Promise<void>}
 */
async function loadSettings() {
  const response = await browser.runtime.sendMessage({ type: 'getSettings' });
  if (response?.settings) {
    settings = response.settings;
    el.targetLang.value = settings.defaultTargetLang || 'fr';
  }
}

/**
 * @returns {Promise<void>}
 */
async function runSelectedAction() {
  const tabId = await resolveActiveTabId();
  if (tabId === null) {
    setStatus('Aucun onglet actif.', 'error');
    return;
  }

  resetResult();
  setStreamingState(true);
  setStatus('Connexion au serveur…');

  const streamId = Date.now();
  activeStreamId = streamId;

  const payload = {
    type: 'startWebAction',
    streamId,
    tabId,
    action: selectedAction,
    targetLang: el.targetLang.value.trim(),
    prompt: el.promptInput.value.trim(),
  };

  const started = await browser.runtime.sendMessage(payload);
  if (!started?.ok) {
    setStreamingState(false);
    setStatus(started?.error || 'Impossible de démarrer l’action.', 'error');
    activeStreamId = null;
  }
}

/**
 * @param {number} streamId
 * @returns {Promise<void>}
 */
async function finishStream(streamId) {
  if (streamId !== activeStreamId) {
    return;
  }

  setStreamingState(false);
  activeStreamId = null;
  el.copyResult.disabled = streamedText.trim().length === 0;
  setStatus('Terminé.');

  const tabId = await resolveActiveTabId();
  if (tabId === null) {
    return;
  }

  if (selectedAction === 'translate' && streamedText.trim()) {
    const applied = await browser.runtime.sendMessage({
      type: 'applyTranslation',
      tabId,
      text: streamedText,
    });
    if (applied?.ok) {
      setStatus('Traduction appliquée dans la page. Utilisez « Annuler » sur la page pour restaurer.');
    } else {
      setStatus(applied?.error || 'Traduction reçue mais non appliquée.', 'error');
    }
    return;
  }

  if (selectedAction === 'custom' && streamedText.trim()) {
    const domResult = await browser.runtime.sendMessage({
      type: 'applyDomOperations',
      tabId,
      rawText: streamedText,
    });
    if (domResult?.warnings?.length) {
      setWarnings(domResult.warnings);
    }
    if (domResult?.ok) {
      setStatus(`Modification appliquée (${domResult.applied ?? 0} élément(s)).`);
      return;
    }
    if (domResult?.warnings?.length && !domResult.ok) {
      setStatus('Réponse affichée (aucune opération DOM valide détectée).');
      return;
    }
  }
}

/**
 * @param {object} message
 */
function handleStreamMessage(message) {
  if (!message || typeof message.streamId !== 'number') {
    return;
  }
  if (message.streamId !== activeStreamId) {
    return;
  }

  if (message.type === 'streamStart') {
    resetResult();
    setStatus('Réception du flux…');
    return;
  }

  if (message.type === 'streamChunk' && typeof message.text === 'string') {
    streamedText += message.text;
    el.result.textContent = streamedText;
    el.copyResult.disabled = false;
    return;
  }

  if (message.type === 'streamDone') {
    void finishStream(message.streamId);
    return;
  }

  if (message.type === 'streamError') {
    setStreamingState(false);
    activeStreamId = null;
    const errorType = message.errorType;
    const text = typeof message.message === 'string' ? message.message : 'Erreur inconnue.';
    if (errorType === 'auth' || errorType === 'config' || errorType === 'network') {
      setStatusWithOptionsLink(text);
      return;
    }
    setStatus(text, 'error');
  }
}

/**
 * @returns {Promise<void>}
 */
async function consumePendingIntent() {
  const response = await browser.runtime.sendMessage({ type: 'getPendingSidebarIntent' });
  const intent = response?.intent;
  if (!intent || typeof intent.action !== 'string') {
    return;
  }
  activeTabId = typeof intent.tabId === 'number' ? intent.tabId : null;
  selectAction(intent.action);
  el.promptInput.focus();
}

el.actionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'translate' || action === 'summarize' || action === 'extract' || action === 'custom') {
      selectAction(action);
    }
  });
});

el.runAction.addEventListener('click', () => {
  void runSelectedAction();
});

el.cancelAction.addEventListener('click', () => {
  if (activeStreamId !== null) {
    void browser.runtime.sendMessage({ type: 'cancelWebAction', streamId: activeStreamId });
    setStreamingState(false);
    setStatus('Annulé.');
    activeStreamId = null;
  }
});

el.copyResult.addEventListener('click', async () => {
  if (!streamedText) {
    return;
  }
  try {
    await navigator.clipboard.writeText(streamedText);
    setStatus('Copié dans le presse-papiers.');
  } catch {
    setStatus('Impossible de copier.', 'error');
  }
});

el.openOptions.addEventListener('click', () => {
  void browser.runtime.sendMessage({ type: 'openOptions' });
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === 'sidebarIntent') {
    activeTabId = typeof message.tabId === 'number' ? message.tabId : null;
    if (message.action === 'extract' || message.action === 'custom') {
      selectAction(message.action);
      el.promptInput.focus();
    }
    return;
  }
  handleStreamMessage(message);
});

selectAction('summarize');
void loadSettings().then(() => consumePendingIntent());
