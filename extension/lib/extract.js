/**
 * @file Heuristique locale d'extraction du contenu principal d'une page.
 * Point d'extension unique pour brancher ultérieurement un extracteur distant.
 */

/** @typedef {object} PageContentResult
 * @property {string} content Texte extrait (sélection ou contenu principal).
 * @property {boolean} selection Indique si le contenu provient d'une sélection utilisateur.
 */

const REMOVED_SELECTOR =
  'script, style, nav, header, footer, aside, iframe, [aria-hidden="true"]';

/**
 * Retourne le texte de la sélection courante si elle n'est pas vide.
 * @returns {string|null}
 */
function getSelectionText() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return null;
  }
  const text = selection.toString().trim();
  return text.length > 0 ? text : null;
}

/**
 * Clone le corps du document et retire les éléments non pertinents.
 * @returns {HTMLElement}
 */
function cloneCleanBody() {
  const clone = document.body.cloneNode(true);
  if (!(clone instanceof HTMLElement)) {
    return document.createElement('div');
  }
  clone.querySelectorAll(REMOVED_SELECTOR).forEach((el) => el.remove());
  return clone;
}

/**
 * Sélectionne l'élément le plus dense en paragraphes parmi les candidats.
 * @param {HTMLElement} root
 * @returns {HTMLElement}
 */
function findDensestElement(root) {
  const tagCandidates = root.querySelectorAll('article, main, section, div');
  /** @type {HTMLElement[]} */
  const candidates = tagCandidates.length > 0 ? Array.from(tagCandidates) : [root];

  let best = root;
  let bestScore = -1;

  for (const el of candidates) {
    const paragraphCount = el.querySelectorAll('p').length;
    const textLength = (el.textContent || '').trim().length;
    const score = paragraphCount * 100 + textLength;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  return best;
}

/**
 * Extrait le contenu à envoyer au backend Lygodactylus.
 * Utilise la sélection si présente, sinon le bloc textuel principal de la page.
 * @returns {PageContentResult}
 */
function getPageContent() {
  const selected = getSelectionText();
  if (selected) {
    return { content: selected, selection: true };
  }

  const root = cloneCleanBody();
  const densest = findDensestElement(root);
  const content = (densest.textContent || '').replace(/\s+/g, ' ').trim();

  return { content, selection: false };
}
