# Prompts Cursor — lot veille 2026-07

> **Workflow** : un prompt = une branche = une feature. Copie-colle le prompt dans Cursor,
> laisse-le coder, puis reviens voir Claude avec le nom de la branche pour vérification
> (« vérifie la branche cursor/xxx »). Ne lance pas deux prompts sur la même branche.
>
> **Ordre conseillé** (du plus simple au plus délicat) :
> 1. TTS lecture vocale → 2. Mémoire freshness/confiance → 3. Latence (keep-alive)
> → 4. Plan/Act → 5. Quick-Ask launcher → 6. Constrained output → 7. Reranker local.

## Règles communes (à coller en tête de CHAQUE prompt)

```text
CONTEXTE PROJET (à lire avant de coder) :
- App : Lygodactylus, agent IA desktop Electron + Vite + React + TypeScript strict, 100% local
  (endpoints OpenAI-compatible / Anthropic-compatible, Ollama/vLLM/llama.cpp, modèles Qwen etc.).
- Agent basé sur @earendil-works/pi-ai / pi-coding-agent. Outils natifs déclarés en TypeBox
  (schémas PLATS, compat LiteLLM→vLLM→Qwen — ne pas introduire de schémas imbriqués exotiques).
- Tests : vitest (src/tests/**), ~1000+ tests existants doivent rester verts.
- i18n : TOUTE chaîne UI nouvelle doit être ajoutée dans LES 12 fichiers
  src/renderer/i18n/locales/{fr,en,zh,es,de,it,uk,pl,sv,no,nl,ro}.json ;
  chaînes backend (erreurs/dialogues) dans src/main/i18n/catalog.ts.
- Style : suivre l'existant (ESLint/Prettier du repo). Commits en français, style conventionnel
  (feat/fix/docs(scope): …), comme l'historique git.

RÈGLES STRICTES :
- Crée une branche dédiée `cursor/<slug-feature>` depuis main. Ne touche PAS aux autres branches.
- AUCUNE nouvelle dépendance npm sans justification écrite dans la description du commit.
- Ne refactore RIEN d'autre que ce qui est demandé. Pas de renommages opportunistes.
- Ne modifie pas ROADMAP.md, CHANGELOG.md ni la config CI.
- Toute nouvelle capacité doit être optionnelle et dégrader proprement (fallback silencieux
  vers le comportement actuel si l'endpoint ne supporte pas la fonctionnalité).
- Avant de terminer : `npm run typecheck` puis `npm run lint` puis `npx vitest run` → tout vert.
- Termine par un résumé : fichiers modifiés, choix faits, ce qui reste hors périmètre.
```

---

## Prompt 1 — Lecture vocale (TTS) des réponses  `cursor/tts-read-aloud`

```text
[coller ici les Règles communes]

TÂCHE : Ajouter la lecture vocale des réponses de l'assistant, 100% offline, via l'API
speechSynthesis intégrée à Chromium (AUCUNE dépendance, AUCUN appel réseau).

SPÉCIFICATION :
1. Un bouton haut-parleur dans la barre d'actions au survol des messages assistant
   (src/renderer/components/MessageCard.tsx — suivre le pattern des boutons existants,
   ex. copier). Clic = lire ce message ; re-clic ou lecture d'un autre message = stop
   (une seule lecture à la fois, état global léger, ex. store zustand existant).
2. Créer un util `src/renderer/utils/speakable-text.ts` : convertit le markdown d'un message
   en texte "parlable" — supprime les blocs de code (remplacés par rien ou « [code] »),
   les tableaux, les formules KaTeX, les URLs brutes ; garde le texte des liens ; conserve
   la ponctuation pour le rythme.
3. Choisir la voix : langue du message si détectable simplement, sinon langue de l'UI
   (i18next). Utiliser speechSynthesis.getVoices() ; si aucune voix pour la langue → voix
   par défaut du système. Pas de réglage de voix avancé pour l'instant.
4. Réglage on/off « Lecture vocale » dans Réglages (section appropriée existante) ;
   OFF par défaut. Si off, le bouton n'apparaît pas.
5. Arrêter toute lecture quand la session change ou qu'un nouveau stream démarre.

HORS PÉRIMÈTRE : endpoints TTS externes (Piper/Kokoro), lecture auto des réponses,
réglages de vitesse/timbre.

TESTS ATTENDUS (vitest) : src/tests/renderer/speakable-text.test.ts — markdown avec code
fence → code retiré ; lien markdown → texte du lien ; formule $x^2$ → retirée ; texte
simple → inchangé. Les composants React n'ont pas besoin de tests de rendu complets.
```

---

## Prompt 2 — Mémoire : freshness decay + confiance  `cursor/memory-freshness-confidence`

```text
[coller ici les Règles communes]

TÂCHE : Améliorer le classement des souvenirs injectés en ajoutant (a) une décroissance
de fraîcheur (recency decay) et (b) un score de confiance optionnel, dans le ranker
mémoire existant. Amélioration self-contained : PAS de nouveau sous-système.

FICHIERS À LIRE D'ABORD : src/main/memory/memory-ranker.ts, memory-types.ts,
memory-retriever.ts, et les tests src/tests/memory/memory-ranker.test.ts.

SPÉCIFICATION :
1. Freshness : utiliser les timestamps DÉJÀ stockés (createdAt / timestamp selon le type
   d'entrée — vérifier dans memory-types.ts). Décroissance exponentielle avec demi-vie
   configurable (constante par défaut : 30 jours) et un PLANCHER (ex. 0.35) pour qu'un
   souvenir ancien mais très pertinent ne soit jamais éliminé par l'âge seul.
   Entrée sans timestamp → facteur neutre 1.0 (rétro-compatibilité totale).
2. Confidence : champ optionnel `confidence?: number` (0..1) sur les types d'entrée
   mémoire ; défaut 1.0 quand absent. Ne PAS modifier le schéma SQLite si un champ méta
   existant peut le porter ; sinon migration additive douce (colonne nullable).
3. Score final = score_actuel × freshnessFactor × confidence. Intégrer dans le point
   unique du ranker où le score est calculé — ne pas dupliquer la logique.
4. Exposer les constantes (demi-vie, plancher) dans un objet de config interne du module
   (pas de réglage UI pour l'instant).

HORS PÉRIMÈTRE : UI de réglage, extraction/écriture du champ confidence par le LLM
(viendra plus tard), toute refonte du retriever.

TESTS ATTENDUS : compléter src/tests/memory/memory-ranker.test.ts —
(1) à pertinence égale, récent > ancien ; (2) le plancher empêche le score de tomber
sous X% ; (3) entrée sans timestamp inchangée vs avant ; (4) confidence 0.5 divise le
score par 2 ; (5) confidence absente = neutre. Tous les tests existants restent verts.
```

---

## Prompt 3 — Latence locale : keep-alive + stabilité du préfixe  `cursor/local-latency`

```text
[coller ici les Règles communes]

TÂCHE : Réduire la latence perçue avec les modèles locaux via (a) le contrôle keep-alive
d'Ollama et (b) un audit de stabilité du préfixe de prompt pour maximiser les hits de
cache KV (llama.cpp cache_prompt / vLLM prefix caching).

FICHIERS À LIRE D'ABORD : src/main/config/ollama-api.ts, config-schema.ts,
src/main/agent/agent-runner-pi-setup.ts, agent-runner-history.ts, context-budget.ts.

SPÉCIFICATION :
1. keep_alive : quand l'endpoint est détecté comme Ollama (détection existante dans
   ollama-api.ts), envoyer `keep_alive` avec une durée configurable (défaut "30m").
   Ajouter le champ dans config-schema.ts avec valeur par défaut + migration douce.
   Si l'injection du paramètre dans les requêtes chat passe par pi-ai et n'est pas
   possible proprement, LIMITER la feature à un warm-up ping : au démarrage de session,
   requête légère (/api/generate avec prompt vide + keep_alive) pour charger le modèle.
   Documenter le choix retenu dans le résumé final.
2. Warm-up : au moment où l'utilisateur ouvre une session ou change de modèle, déclencher
   le ping de préchargement en tâche de fond (ne jamais bloquer l'UI ; timeout court 5s ;
   échec silencieux loggé en debug).
3. Audit préfixe stable : vérifier que le system prompt assemblé pour une même session
   est BYTE-IDENTIQUE d'un tour à l'autre (pas de timestamp, pas d'ordre non déterministe
   d'items — skills, MCP, mémoire injectée en préfixe). Corriger toute source
   d'instabilité trouvée (ex. tri déterministe des listes). Si la mémoire injectée varie
   par tour, s'assurer qu'elle est APRÈS la partie stable du préfixe, pas avant.
4. Réglage UI minimal : durée keep-alive dans Réglages (section modèle/API), avec les
   traductions dans les 12 locales.

HORS PÉRIMÈTRE : speculative decoding, gestion multi-modèles chargés, /api/ps UI.

TESTS ATTENDUS : (1) mapping du paramètre keep_alive (unité → payload) ;
(2) test de déterminisme : construire deux fois le préfixe système avec les mêmes
entrées → chaînes strictement égales ; (3) warm-up : échec réseau → pas d'exception
propagée.
```

---

## Prompt 4 — Mode Plan / Act  `cursor/plan-act-mode`

```text
[coller ici les Règles communes]

TÂCHE : Ajouter un mode « Plan » par session : l'agent explore et propose un plan en
LECTURE SEULE (aucune écriture fichier, aucune commande, aucun accès réseau sortant
d'action), puis l'utilisateur bascule en « Act » pour exécuter. Simple : un toggle +
un gating d'outils + un ajustement de prompt. PAS d'orchestration multi-agent.

FICHIERS À LIRE D'ABORD : src/main/agent/agent-runner-pi-setup.ts (où les outils sont
exposés à la session pi), src/main/tools/ (registre des outils natifs),
src/main/session/ (état de session), et le composant d'input du chat côté renderer.

SPÉCIFICATION :
1. État `mode: 'plan' | 'act'` par session (défaut 'act' — comportement actuel inchangé).
   Persisté avec la session. IPC pour lire/changer le mode.
2. En mode plan, filtrer la liste d'outils fournie à la session pi : AUTORISÉS = lecture
   (read/glob/grep/list…), web_search, web_fetch, ask_user_question, todo_write.
   BLOQUÉS = write/edit fichiers, bash/commandes, http_request, et tout outil MCP marqué
   non-lecture (si aucune métadonnée MCP ne l'indique : bloquer TOUS les outils MCP en
   mode plan, choix conservateur, le documenter).
   Le filtrage doit vivre à UN endroit (là où le toolset est assemblé), pas éparpillé.
3. En mode plan, ajouter au system prompt une consigne courte : « mode planification :
   explore, pose des questions si besoin, produis un plan d'action numéroté ; n'exécute
   rien ». Cette consigne ne doit PAS casser la stabilité du préfixe entre tours du même
   mode (chaîne constante).
4. UI : toggle Plan/Act visible près de la zone de saisie (pattern des toggles existants),
   badge clair du mode actif, i18n 12 locales. Quand l'agent termine en mode plan,
   afficher un bouton « Passer en Act » qui bascule le mode (le plan reste dans
   l'historique de conversation, donc accessible à l'agent — rien d'autre à injecter).
5. Changement de mode interdit pendant qu'un run est en cours (désactiver le toggle).

HORS PÉRIMÈTRE : approbation formelle du plan, plans structurés/persistés, sous-agents.

TESTS ATTENDUS : (1) le filtre de toolset en mode plan exclut write/bash/http_request et
inclut glob/grep/web_search ; (2) mode par défaut = act, comportement identique à avant
(snapshot du toolset inchangé) ; (3) IPC set/get du mode ; (4) MCP bloqués en plan.
```

---

## Prompt 5 — Quick-Ask global (launcher)  `cursor/quick-ask-launcher`

```text
[coller ici les Règles communes]

TÂCHE : Fenêtre « quick ask » système : un raccourci clavier GLOBAL ouvre une petite
fenêtre frameless au-dessus de tout, l'utilisateur tape une question, la réponse streame
dedans, avec un bouton « Ouvrir dans l'app ». Phase 1 uniquement (pas de capture du texte
sélectionné dans d'autres apps — viendra plus tard).

FICHIERS À LIRE D'ABORD : src/main/ipc/ (patterns IPC existants), la création de la
fenêtre principale dans src/main/ (main-app-*), le flux de streaming chat côté renderer
(useIPC / stream), src/main/chat-lan-server/ (pour voir comment un client léger parle
déjà à l'agent — réutiliser la même voie interne si pratique).

SPÉCIFICATION :
1. Raccourci global via Electron globalShortcut, configurable dans Réglages, défaut
   CommandOrControl+Shift+Space. Gérer l'échec d'enregistrement (déjà pris par l'OS) :
   message dans Réglages, pas de crash. Désenregistrer proprement à quit.
2. Fenêtre : BrowserWindow frameless, alwaysOnTop, ~640×420, centrée, skipTaskbar,
   show/hide au raccourci (toggle), Échap = masquer, perte de focus = masquer.
   Réutiliser le bundle renderer existant avec une route/entrée dédiée légère
   (pas un 2e bundle Vite complet si évitable — suivre la config vite existante).
3. Comportement chat : chaque ouverture propose un champ unique ; l'envoi crée (ou
   réutilise) une session dédiée « quick-ask » avec le modèle par défaut ; la réponse
   streame dans la fenêtre (markdown rendu, pattern existant). Bouton « Ouvrir dans
   l'app » : affiche la fenêtre principale sur cette session.
4. Sécurité : la fenêtre quick-ask utilise le MÊME preload/allowlist IPC que la fenêtre
   principale — aucun canal privilégié nouveau. Pas d'outils d'écriture déclenchés depuis
   quick-ask : forcer la session quick-ask en mode lecture (si le mode Plan/Act de la
   branche cursor/plan-act-mode est déjà mergé, réutiliser 'plan' ; sinon poser un flag
   équivalent minimal).
5. Réglages : activer/désactiver la feature (défaut OFF), champ raccourci. i18n 12 locales.

HORS PÉRIMÈTRE : capture de sélection d'autres apps, actions contextuelles
(traduire/résumer la sélection), historique dédié quick-ask.

TESTS ATTENDUS : (1) helpers d'enregistrement du raccourci (register/unregister, échec
géré) ; (2) validation du format de raccourci saisi ; (3) logique de session quick-ask
(création/réutilisation). Les comportements purement fenêtre/OS peuvent rester non testés.
```

---

## Prompt 6 — Sortie contrainte (JSON-schema / grammaire)  `cursor/constrained-output`

```text
[coller ici les Règles communes]

TÂCHE : Quand l'endpoint local le supporte, contraindre CÔTÉ SERVEUR la sortie du modèle
(JSON valide conforme au schéma) au lieu de seulement réparer après coup. Le tool-call
guard existant (src/main/agent/hallucinated-toolcall-guard.ts) RESTE en filet de
sécurité — cette feature le rend juste rarement nécessaire.

ÉTAPE 0 OBLIGATOIRE — INVESTIGATION (à faire avant tout code, résumer les conclusions) :
Les requêtes chat passent par @earendil-works/pi-ai. Déterminer s'il existe un point
d'extension pour injecter des champs supplémentaires dans le corps de requête
(response_format / format / extra_body). Regarder aussi patches/ (patch-package est déjà
utilisé dans ce repo) : un patch minimal et documenté du SDK est acceptable si aucun
point d'extension n'existe. SI NI L'UN NI L'AUTRE n'est raisonnable, s'arrêter et
livrer uniquement l'étape 1 (détection de capacités) + un rapport expliquant le blocage.

SPÉCIFICATION :
1. Détection de capacités par endpoint (module src/main/config/endpoint-capabilities.ts) :
   au test de connexion/config (voir config-test-routing.ts, api-diagnostics.ts), sonder
   si l'endpoint honore un response_format de type json_schema :
   - Ollama natif : champ `format` (accepte un JSON schema) ;
   - llama.cpp server : `response_format: {type:"json_schema", json_schema:{...}}` ou `grammar` ;
   - vLLM : `response_format` OpenAI-compatible (guided decoding).
   Sonde = mini-requête (max_tokens très bas) avec un schéma trivial ; si erreur 4xx ou
   sortie non conforme → capacité absente. Mettre en cache le résultat par endpoint+modèle
   dans la config (invalider quand l'URL ou le modèle change).
2. Application : pour les décisions internes de l'app qui attendent du JSON (repérer les
   appels one-shot existants, ex. pi-ai-one-shot / memory-llm-client), passer le schéma
   attendu via le champ détecté. Pour les tool-calls du run agent : n'activer la
   contrainte que si l'investigation étape 0 a montré que c'est faisable proprement via
   pi-ai ; sinon, se limiter aux appels one-shot internes (déjà un gain réel).
3. Réglage : `constrainedOutput: 'auto' | 'off'` dans config-schema.ts, défaut 'auto'
   (= actif si capacité détectée). Fallback silencieux : toute erreur liée au champ de
   contrainte → retry immédiat SANS le champ + log debug, jamais d'échec utilisateur.
4. Le guard hallucinated-toolcall reste inchangé et actif.

HORS PÉRIMÈTRE : grammaires GBNF custom, guided_choice, streaming structuré, UI dédiée.

TESTS ATTENDUS : (1) mapping capacité→champ par type d'endpoint (table) ; (2) parsing
des réponses de sonde (conforme / non conforme / erreur) ; (3) fallback : erreur avec
champ → retry sans champ ; (4) cache de capacités invalidé au changement d'URL.
```

---

## Prompt 7 — Reranker local (mémoire)  `cursor/local-reranker`

```text
[coller ici les Règles communes]

TÂCHE : Améliorer la pertinence des souvenirs injectés en re-scorant le top-N récupéré
via un endpoint de rerank LOCAL (style llama.cpp `--reranking`, API POST /v1/rerank
{model, query, documents[]} → scores). Feature OPT-IN, OFF par défaut, fallback total.

FICHIERS À LIRE D'ABORD : src/main/memory/memory-retriever.ts, memory-ranker.ts,
memory-service-query.ts, config-schema.ts, SettingsMemory.tsx.
NOTE : si la branche cursor/memory-freshness-confidence est mergée, le rerank s'applique
AVANT les facteurs freshness/confidence (rerank = pertinence sémantique ; freshness et
confidence restent multiplicatifs par-dessus).

SPÉCIFICATION :
1. Config : section `memoryReranker` dans config-schema.ts — {enabled:false, baseUrl,
   model, topN:20, keep:8, timeoutMs:800}. Migration douce, réglages dans SettingsMemory
   (activer, URL, modèle, bouton « Tester » qui fait un appel de sonde), i18n 12 locales.
2. Client : src/main/memory/memory-reranker-client.ts — POST {baseUrl}/v1/rerank,
   payload {model, query, documents}, réponse tolérante aux deux formats courants
   (results[{index,relevance_score}] / scores[]). Timeout strict (config), AbortController.
3. Intégration : dans le retriever, si enabled → prendre le top-N actuel, appeler le
   rerank, garder `keep` meilleurs dans l'ordre reranké. TOUTE erreur/timeout → conserver
   exactement le classement actuel (log debug, jamais visible utilisateur). Aucun impact
   quand disabled (chemin de code court-circuité).
4. Le panneau « Mémoire utilisée » existant doit refléter l'ordre final (vérifier que
   rien ne suppose l'ancien ordre).

HORS PÉRIMÈTRE : reranker in-process ONNX/transformers.js (pas de modèle embarqué —
l'app reste légère), rerank de résultats web, batch/cache des scores.

TESTS ATTENDUS : (1) client — parsing des deux formats de réponse + timeout → erreur
typée ; (2) intégration — enabled+réponse valide → ordre reranké tronqué à keep ;
(3) erreur/timeout → ordre d'origine intact ; (4) disabled → aucun appel réseau (spy).
```

---

## Après chaque branche : la vérification Claude

Reviens dans la session Claude avec : « vérifie la branche cursor/xxx ». La revue portera sur :
typecheck/lint/tests verts, respect du périmètre (rien d'autre modifié), i18n complète
(12 locales), fallbacks silencieux réels, stabilité du préfixe de prompt (prompts 3/4/6),
sécurité IPC (prompt 5), et compat rétro (prompts 2/6/7). Verdict : mergeable / corrections
demandées (avec liste précise à recoller dans Cursor).
