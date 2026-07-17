/**
 * @file Page d’options : URL serveur, token extension, langue des réponses.
 * Mêmes clés de stockage que l’extension Firefox « Lygodactylus Web ».
 */

/* global messenger */

const STORAGE_KEYS = {
  serverUrl: 'serverUrl',
  extensionToken: 'extensionToken',
  defaultTargetLang: 'defaultTargetLang',
};

const DEFAULTS = {
  serverUrl: 'http://localhost:19890',
  extensionToken: '',
  defaultTargetLang: 'fr',
};

const form = document.getElementById('options-form');
const serverUrlInput = document.getElementById('server-url');
const extensionTokenInput = document.getElementById('extension-token');
const defaultTargetLangInput = document.getElementById('default-target-lang');
const statusEl = document.getElementById('status');

async function loadOptions() {
  const stored = await messenger.storage.local.get(Object.values(STORAGE_KEYS));
  serverUrlInput.value =
    typeof stored.serverUrl === 'string' ? stored.serverUrl : DEFAULTS.serverUrl;
  extensionTokenInput.value =
    typeof stored.extensionToken === 'string' ? stored.extensionToken : DEFAULTS.extensionToken;
  defaultTargetLangInput.value =
    typeof stored.defaultTargetLang === 'string'
      ? stored.defaultTargetLang
      : DEFAULTS.defaultTargetLang;
}

function setStatus(message) {
  statusEl.textContent = message;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const serverUrl = serverUrlInput.value.trim();
  const extensionToken = extensionTokenInput.value.trim();
  const defaultTargetLang = defaultTargetLangInput.value.trim();

  if (!serverUrl) {
    setStatus('URL du serveur requise.');
    return;
  }
  if (!defaultTargetLang) {
    setStatus('Langue requise.');
    return;
  }

  await messenger.storage.local.set({
    [STORAGE_KEYS.serverUrl]: serverUrl,
    [STORAGE_KEYS.extensionToken]: extensionToken,
    [STORAGE_KEYS.defaultTargetLang]: defaultTargetLang,
  });

  setStatus('Options enregistrées.');
});

void loadOptions();
