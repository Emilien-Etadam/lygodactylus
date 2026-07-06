/**
 * @file Content script : extraction, remplacement in-place, opérations DOM validées.
 */

/** @typedef {'hide' | 'remove' | 'replaceText'} DomOperationType */

/** @typedef {object} DomOperation
 * @property {DomOperationType} op
 * @property {string} selector
 * @property {string} [text]
 */

/** @typedef {object} DomOperationPlan
 * @property {DomOperation[]} operations
 */

const ALLOWED_OPS = new Set(['hide', 'remove', 'replaceText']);

/** @type {Map<string, { range: Range, text: string }>} */
const undoStore = new Map();

let undoBanner = null;

/**
 * @returns {string}
 */
function createUndoId() {
  return `undo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @param {string} selector
 * @returns {boolean}
 */
function isValidSelector(selector) {
  if (typeof selector !== 'string' || !selector.trim()) {
    return false;
  }
  try {
    document.querySelectorAll(selector);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {value is DomOperationPlan}
 */
function isDomOperationPlan(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const plan = /** @type {DomOperationPlan} */ (value);
  return Array.isArray(plan.operations);
}

/**
 * @param {string} rawText
 * @returns {{ plan: DomOperationPlan | null, warnings: string[] }}
 */
function parseDomOperationPlan(rawText) {
  const warnings = [];
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { plan: null, warnings: ['Réponse vide.'] };
  }

  const jsonCandidate = extractJsonObject(trimmed);
  if (!jsonCandidate) {
    return { plan: null, warnings: [] };
  }

  try {
    const parsed = JSON.parse(jsonCandidate);
    if (!isDomOperationPlan(parsed)) {
      warnings.push('JSON invalide : tableau "operations" attendu.');
      return { plan: null, warnings };
    }
    return { plan: parsed, warnings };
  } catch {
    warnings.push('JSON de modification de page illisible.');
    return { plan: null, warnings };
  }
}

/**
 * @param {string} text
 * @returns {string|null}
 */
function extractJsonObject(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  return candidate.slice(start, end + 1);
}

/**
 * @param {DomOperationPlan} plan
 * @returns {{ applied: number, warnings: string[] }}
 */
function applyDomOperationPlan(plan) {
  const warnings = [];
  let applied = 0;

  for (const operation of plan.operations) {
    if (!operation || typeof operation !== 'object') {
      warnings.push('Opération ignorée : entrée invalide.');
      continue;
    }

    const op = operation.op;
    const selector = operation.selector;

    if (!ALLOWED_OPS.has(op)) {
      warnings.push(`Opération ignorée : "${String(op)}" non autorisée (hide, remove, replaceText uniquement).`);
      continue;
    }

    if (!isValidSelector(selector)) {
      warnings.push(`Sélecteur invalide ignoré : ${String(selector)}`);
      continue;
    }

    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) {
      warnings.push(`Aucun élément pour le sélecteur : ${selector}`);
      continue;
    }

    for (const element of elements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if (op === 'hide') {
        element.style.setProperty('display', 'none', 'important');
        applied += 1;
      } else if (op === 'remove') {
        element.remove();
        applied += 1;
      } else if (op === 'replaceText') {
        if (typeof operation.text !== 'string') {
          warnings.push(`replaceText sans texte ignoré pour : ${selector}`);
          continue;
        }
        element.textContent = operation.text;
        applied += 1;
      }
    }
  }

  return { applied, warnings };
}

/**
 * @param {string} undoId
 */
function undoReplacement(undoId) {
  const entry = undoStore.get(undoId);
  if (!entry) {
    return;
  }

  try {
    const range = entry.range;
    range.deleteContents();
    range.insertNode(document.createTextNode(entry.text));
  } catch {
    // la page a pu changer entre-temps
  }

  undoStore.delete(undoId);
  hideUndoBanner();
}

/**
 * @param {string} undoId
 */
function showUndoBanner(undoId) {
  hideUndoBanner();

  const banner = document.createElement('div');
  banner.id = 'lygo-undo-banner';
  banner.setAttribute('role', 'status');
  banner.innerHTML = `
    <span>Traduction appliquée.</span>
    <button type="button" id="lygo-undo-btn">Annuler</button>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #lygo-undo-banner {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      background: #1e293b;
      color: #f8fafc;
      font: 13px/1.4 system-ui, sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    }
    #lygo-undo-banner button {
      border: none;
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
      background: #f8fafc;
      color: #1e293b;
      font: inherit;
    }
  `;

  document.documentElement.appendChild(style);
  document.body.appendChild(banner);
  undoBanner = banner;

  const button = banner.querySelector('#lygo-undo-btn');
  button?.addEventListener('click', () => undoReplacement(undoId));
}

/**
 */
function hideUndoBanner() {
  undoBanner?.remove();
  undoBanner = null;
}

/**
 * @param {string} translatedText
 * @returns {{ ok: boolean, undoId?: string, error?: string }}
 */
function replaceCurrentSelection(translatedText) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return { ok: false, error: 'Aucune sélection active à remplacer.' };
  }

  const range = selection.getRangeAt(0).cloneRange();
  const originalText = range.toString();
  const undoId = createUndoId();

  undoStore.set(undoId, { range, text: originalText });

  try {
    range.deleteContents();
    range.insertNode(document.createTextNode(translatedText));
    selection.removeAllRanges();
    showUndoBanner(undoId);
    return { ok: true, undoId };
  } catch {
    undoStore.delete(undoId);
    return { ok: false, error: 'Échec du remplacement dans la page.' };
  }
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'getPageContext') {
    const extracted = getPageContent();
    sendResponse({
      content: extracted.content,
      selection: extracted.selection,
      url: window.location.href,
      title: document.title,
    });
    return false;
  }

  if (message.type === 'replaceSelection') {
    const text = message.text;
    if (typeof text !== 'string') {
      sendResponse({ ok: false, error: 'Texte invalide.' });
      return false;
    }
    sendResponse(replaceCurrentSelection(text));
    return false;
  }

  if (message.type === 'applyDomOperations') {
    const rawText = message.rawText;
    if (typeof rawText !== 'string') {
      sendResponse({ ok: false, warnings: ['Texte invalide.'] });
      return false;
    }
    const { plan, warnings: parseWarnings } = parseDomOperationPlan(rawText);
    if (!plan) {
      sendResponse({ ok: false, warnings: parseWarnings, applied: 0 });
      return false;
    }
    const result = applyDomOperationPlan(plan);
    sendResponse({
      ok: result.applied > 0,
      applied: result.applied,
      warnings: [...parseWarnings, ...result.warnings],
    });
    return false;
  }

  return false;
});
