/**
 * @file Fenêtre de résultat : affiche le flux SSE relayé par le service de fond,
 * permet de copier le texte et — en contexte composition — de l'insérer dans
 * l'e-mail. Pour l'action « prompt libre », saisit d'abord la consigne.
 */

/* global messenger */

const params = new URLSearchParams(location.search);
const jobId = params.get('job') || '';
const action = params.get('action') || '';

const ACTION_TITLES = {
  summarize: 'Résumé',
  translate: 'Traduction',
  'analyze-intent': 'Analyse du ton / de l’intention',
  explain: 'Explication',
  'check-errors': 'Vérification des erreurs',
  improve: 'Améliorations suggérées',
  'suggest-reply': 'Réponse suggérée',
  rephrase: 'Reformulation',
  custom: 'Prompt libre',
};

const outputEl = document.getElementById('output');
const statusEl = document.getElementById('status');
const copyBtn = document.getElementById('copy-btn');
const insertBtn = document.getElementById('insert-btn');
const cancelBtn = document.getElementById('cancel-btn');
const promptBox = document.getElementById('prompt-box');
const promptInput = document.getElementById('prompt-input');
const runBtn = document.getElementById('run-btn');
const actionTitleEl = document.getElementById('action-title');
const sourceTitleEl = document.getElementById('source-title');

let text = '';
let done = false;

actionTitleEl.textContent = ACTION_TITLES[action] || 'Lygodactylus Mail';

function showError(message) {
  statusEl.textContent = message;
  statusEl.hidden = false;
  cancelBtn.hidden = true;
}

function setStreaming(active) {
  cancelBtn.hidden = !active;
  copyBtn.disabled = active || !text;
  insertBtn.disabled = active || !text;
}

copyBtn.addEventListener('click', () => {
  void navigator.clipboard.writeText(text);
  copyBtn.textContent = 'Copié';
  setTimeout(() => (copyBtn.textContent = 'Copier'), 1500);
});

insertBtn.addEventListener('click', () => {
  messenger.runtime
    .sendMessage({ type: 'result:insert', jobId, text })
    .then((res) => {
      if (res && res.ok) {
        window.close();
      } else {
        showError((res && res.error) || 'Insertion impossible.');
      }
    })
    .catch(() => showError('Insertion impossible.'));
});

cancelBtn.addEventListener('click', () => {
  messenger.runtime.sendMessage({ type: 'result:cancel', jobId }).catch(() => {});
  setStreaming(false);
});

runBtn.addEventListener('click', () => {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    promptInput.focus();
    return;
  }
  promptBox.hidden = true;
  setStreaming(true);
  messenger.runtime.sendMessage({ type: 'result:runCustom', jobId, prompt }).catch(() => {});
});

messenger.runtime.onMessage.addListener((message) => {
  if (!message || message.jobId !== jobId) {
    return;
  }
  if (message.type === 'result:chunk' && typeof message.text === 'string') {
    text += message.text;
    outputEl.textContent = text;
    outputEl.scrollTop = outputEl.scrollHeight;
  } else if (message.type === 'result:done') {
    done = true;
    setStreaming(false);
  } else if (message.type === 'result:error') {
    showError(message.message || 'Erreur.');
    setStreaming(false);
  }
});

window.addEventListener('unload', () => {
  messenger.runtime.sendMessage({ type: 'result:closed', jobId }).catch(() => {});
});

async function init() {
  let info;
  try {
    info = await messenger.runtime.sendMessage({ type: 'result:ready', jobId });
  } catch {
    showError('Impossible de contacter l’extension.');
    return;
  }
  if (!info || !info.ok) {
    showError((info && info.error) || 'Tâche introuvable.');
    return;
  }

  if (info.title) {
    sourceTitleEl.textContent = info.title;
  }
  if (info.canInsert) {
    insertBtn.hidden = false;
  }
  if (info.immediateError) {
    showError(info.immediateError);
    return;
  }
  if (info.needsPrompt) {
    promptBox.hidden = false;
    promptInput.focus();
    return;
  }
  setStreaming(true);
}

void done;
void init();
