/**
 * @file Prompts e-mail et construction des payloads /api/web-action.
 *
 * Repris et adaptés de aimailsupport (MIT, Yellow Sakura). Chaque action mail
 * est traduite en un appel de l'endpoint Chat LAN existant :
 *   - `translate` → action native `translate` + targetLang ;
 *   - tout le reste → action `custom` avec un prompt construit ici.
 * Aucune modification serveur n'est nécessaire.
 *
 * Exposé en global `LygoMailPrompts` pour le service worker (MV2) et importable
 * en module pour les tests.
 */

(function (root) {
  const IGNORE =
    'Ignore la mise en forme, les en-têtes, pieds de page, signatures, réponses citées et caractères inhabituels.';

  /**
   * Tons proposés pour « reformuler » et « suggérer une réponse ».
   * @type {{ id: string, label: string }[]}
   */
  const TONES = [
    { id: 'standard', label: 'Standard' },
    { id: 'formel', label: 'Formel' },
    { id: 'amical', label: 'Amical' },
    { id: 'concis', label: 'Concis' },
    { id: 'développé', label: 'Développé' },
    { id: 'poli', label: 'Poli' },
  ];

  /**
   * Construit le prompt « custom » pour une action mail donnée.
   * @param {string} action
   * @param {{ language?: string, tone?: string, customPrompt?: string }} opts
   * @returns {string}
   */
  function buildCustomPrompt(action, opts) {
    const language = (opts.language || 'français').trim();
    const tone = (opts.tone || 'standard').trim();

    switch (action) {
      case 'summarize':
        return `Résume cet e-mail en ${language}, de façon courte et claire, en te concentrant uniquement sur le message ou la demande essentielle de l'expéditeur. ${IGNORE}`;
      case 'analyze-intent':
        return `Analyse le ton et l'intention perçue de cet e-mail et fournis l'analyse en ${language} ; décris l'impression qu'il peut donner au destinataire (ton, clarté, impact émotionnel potentiel, cohérence avec le contexte). ${IGNORE}`;
      case 'explain':
        return `Explique le contenu de cet e-mail en ${language}, de manière claire et simple, en préservant le sens d'origine et sans complexité inutile. ${IGNORE}`;
      case 'check-errors':
        return `Vérifie soigneusement cet e-mail en ${language} : fautes d'orthographe, incohérences logiques, inexactitudes, coquilles et autres problèmes ; fournis une analyse détaillée en signalant les problèmes et en proposant des corrections. ${IGNORE}`;
      case 'improve':
        return `Suggère des améliorations au contenu de cet e-mail en ${language}, en te concentrant sur la clarté, le ton et l'efficacité. ${IGNORE}`;
      case 'rephrase':
        return `Reformule le contenu de cet e-mail en ${language} en adoptant un ton ${tone} ; préserve le sens d'origine. Réponds uniquement avec le texte reformulé. ${IGNORE}`;
      case 'suggest-reply':
        return `Rédige une suggestion de réponse à cet e-mail en ${language}, sur un ton ${tone} ; assure-toi qu'elle est claire et pertinente par rapport au message de l'expéditeur. Réponds uniquement avec le corps de la réponse. ${IGNORE}`;
      case 'custom':
        return (opts.customPrompt || '').trim();
      default:
        return (opts.customPrompt || '').trim();
    }
  }

  /**
   * Construit le payload complet pour POST /api/web-action.
   * @param {string} action
   * @param {{ content: string, title?: string, language?: string, tone?: string,
   *           targetLang?: string, customPrompt?: string }} opts
   * @returns {{ action: string, content: string, url: string, title: string,
   *            selection: boolean, targetLang: string|null, prompt: string|null }}
   */
  function buildWebActionPayload(action, opts) {
    const base = {
      content: opts.content || '',
      url: '',
      title: opts.title || '',
      selection: false,
      targetLang: null,
      prompt: null,
    };

    if (action === 'translate') {
      return { ...base, action: 'translate', targetLang: (opts.targetLang || 'fr').trim() };
    }

    return { ...base, action: 'custom', prompt: buildCustomPrompt(action, opts) };
  }

  /** Indique si l'action écrit son résultat dans la fenêtre de composition. */
  function isComposeAction(action) {
    return action === 'suggest-reply' || action === 'rephrase' || action === 'improve';
  }

  const api = { TONES, buildCustomPrompt, buildWebActionPayload, isComposeAction };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.LygoMailPrompts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
