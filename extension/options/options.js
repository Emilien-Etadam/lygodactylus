/**
 * @file Page d’options : URL serveur, token extension, langue cible par défaut.
 */

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

const form = /** @type {HTMLFormElement} */ (document.getElementById('options-form'));
const serverUrlInput = /** @type {HTMLInputElement} */ (document.getElementById('server-url'));
const extensionTokenInput = /** @type {HTMLInputElement} */ (
  document.getElementById('extension-token')
);
const defaultTargetLangInput = /** @type {HTMLInputElement} */ (
  document.getElementById('default-target-lang')
);
const statusEl = document.getElementById('status');

/**
 * @returns {Promise<void>}
 */
async function loadOptions() {
  const stored = await browser.storage.local.get(Object.values(STORAGE_KEYS));
  serverUrlInput.value =
    typeof stored.serverUrl === 'string' ? stored.serverUrl : DEFAULTS.serverUrl;
  extensionTokenInput.value =
    typeof stored.extensionToken === 'string' ? stored.extensionToken : DEFAULTS.extensionToken;
  defaultTargetLangInput.value =
    typeof stored.defaultTargetLang === 'string'
      ? stored.defaultTargetLang
      : DEFAULTS.defaultTargetLang;
}

/**
 * @param {string} message
 */
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
    setStatus('Langue cible requise.');
    return;
  }

  await browser.storage.local.set({
    [STORAGE_KEYS.serverUrl]: serverUrl,
    [STORAGE_KEYS.extensionToken]: extensionToken,
    [STORAGE_KEYS.defaultTargetLang]: defaultTargetLang,
  });

  setStatus('Options enregistrées.');
});

void loadOptions();
