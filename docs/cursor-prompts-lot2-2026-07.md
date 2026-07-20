# Prompts Cursor — 2e lot veille (2026-07)

> Même workflow que le lot 1 (`cursor-prompts-veille-2026-07.md`) : **un prompt = une
> branche = une feature**, puis revue Claude (« vérifie la branche cursor/xxx »).
> **Colle en tête de chaque prompt le bloc « Règles communes » du fichier du lot 1** —
> il s'applique intégralement (i18n ×12, pas de nouvelle dépendance, fallbacks
> silencieux, typecheck/lint/vitest verts, branche depuis `main`).
>
> **Ordre conseillé** : 1 → 7 indépendants (du plus simple au plus riche) ;
> 8 (checkpoints) **avant** 9 (modes d'autonomie), qui s'appuie dessus.

---

## Prompt 1 — Stats modèle en direct  `cursor/model-stats`

```text
[Règles communes du lot 1]

TÂCHE : Afficher pendant/après chaque réponse : vitesse de génération (tok/s),
remplissage du contexte (%), et méta du modèle (paramètres/quantization si connus).
Pur client — aucune requête supplémentaire pendant la génération.

FICHIERS À LIRE D'ABORD : src/main/agent/agent-runner-stream-handler.ts et
agent-runner-stream-events.ts (événements de stream), src/main/agent/context-budget.ts
(getLastInputTokenCount, estimation tokens), src/main/config/ollama-api.ts
(fetchOllamaModelInfo — /api/show donne params/quant), la barre de contexte existante
côté renderer (MemoryContextBar / barre sidebar).

SPÉCIFICATION :
1. tok/s : calculé côté renderer à partir des deltas du stream déjà reçus
   (timestamps d'arrivée + estimation de tokens via l'utilitaire existant) ;
   affiché discrètement sous le message pendant la génération, figé à la fin.
2. % contexte : réutiliser la détection de fenêtre réelle existante + le compteur
   de tokens du dernier échange — petit indicateur près de la barre de contexte
   existante (ne pas dupliquer la logique : importer, pas recopier).
3. Méta modèle : si l'endpoint est Ollama, afficher params/quant (via le
   fetchOllamaModelInfo existant, caché) dans le sélecteur de modèle ou le footer.
   vLLM/llama.cpp : n'affiche que ce qui est connu, pas d'appel supplémentaire.
4. Réglage on/off « Stats du modèle » (Réglages, défaut ON), i18n ×12.

HORS PÉRIMÈTRE : estimation VRAM, benchmark, historique des vitesses.

TESTS : util de calcul tok/s (deltas simulés → valeur attendue, bornes : 0 token,
burst unique) ; formatage du % contexte.
```

---

## Prompt 2 — Recherche dans l'historique des chats  `cursor/chat-search`

```text
[Règles communes du lot 1]

TÂCHE : Recherche plein-texte locale sur TOUTES les conversations (titres + contenu
des messages), depuis la sidebar. Résultats groupés par session, clic → ouvre la
session sur le message.

FICHIERS À LIRE D'ABORD : src/main/db/database.ts (tables sessions/messages,
better-sqlite3, pattern ensureColumn/migrations), src/main/session/session-manager-store.ts,
la sidebar sessions côté renderer.

SPÉCIFICATION :
1. Index : table virtuelle SQLite FTS5 (incluse dans better-sqlite3 — vérifier avec
   un test que le build embarqué l'active ; si absente, repli LIKE + normalisation,
   documenter le choix). Migration additive au démarrage + backfill des messages
   existants en tâche de fond (chunked, jamais bloquant).
2. Synchronisation : à l'insertion/suppression de messages, tenir l'index à jour
   au même endroit que l'écriture DB (pas de double source de vérité).
3. IPC : `session.searchMessages` (invoke, preload). NE PAS l'ajouter à
   client-event-allowlist (desktop d'abord ; le LAN pourra venir plus tard).
4. UI : champ de recherche en haut de la sidebar (ou raccourci Ctrl/Cmd+Shift+F),
   résultats avec extrait surligné, Échap pour fermer. i18n ×12.
5. Contenu indexé : texte des messages user/assistant uniquement (pas les blocs
   tool_use/tool_result), titre de session.

HORS PÉRIMÈTRE : recherche sémantique (voir prompt 6), filtre par date, regex.

TESTS : indexation + recherche sur DB en mémoire (insert → found ; delete →
absent) ; backfill idempotent ; requêtes avec caractères spéciaux FTS échappés.
```

---

## Prompt 3 — Règles projet (AGENTS.md)  `cursor/project-rules`

```text
[Règles communes du lot 1]

TÂCHE : Charger automatiquement un fichier de consignes à la racine du workspace
(`AGENTS.md`, standard cross-outil) comme contexte système stable de la session.

ÉTAPE 0 OBLIGATOIRE — INVESTIGATION (résumer les conclusions avant de coder) :
Le resource loader de @earendil-works/pi-coding-agent expose déjà `agentsFiles` /
`agentsFilesOverride` / `noContextFiles` (vu dans resource-loader.d.ts) et l'app trie
déjà ces fichiers (agentsFilesOverride dans agent-runner-pi-session.ts). Déterminer :
(a) si le SDK charge déjà AGENTS.md depuis le cwd tout seul — auquel cas la feature
est peut-être DÉJÀ ACTIVE ; tester en créant un AGENTS.md dans un workspace.
(b) quels noms de fichiers il cherche, et depuis quel répertoire (cwd effectif vs
workspace).

SPÉCIFICATION (adapter selon l'étape 0) :
1. Si le SDK charge déjà AGENTS.md : la tâche devient (a) garantir que le cwd
   effectif = dossier workspace choisi, (b) étendre aux variantes `.rules` et
   `CLAUDE.md` via agentsFilesOverride (premier trouvé gagne, ordre documenté),
   (c) surfacer dans le panneau de contexte « Règles projet chargées : <fichier> ».
2. Sinon : lire le fichier au préparatif de session (pi-setup), l'ajouter via
   agentsFilesOverride (en conservant le tri stable existant).
3. Plafond de taille (ex. 32 Ko, tronqué avec marqueur) ; fichier absent = silence.
4. Rechargement : à chaque nouvelle session pi (pas de watch à chaud pour l'instant).
5. Indicateur UI discret + i18n ×12.

HORS PÉRIMÈTRE : hiérarchie de fichiers par sous-dossier, hot-reload, éditeur intégré.

TESTS : résolution du fichier (préséance AGENTS.md > .rules > CLAUDE.md),
plafond de taille, absence silencieuse, stabilité byte-à-byte entre deux tours.
```

---

## Prompt 4 — Presets de prompts / personas  `cursor/prompt-presets`

```text
[Règles communes du lot 1]

TÂCHE : Bibliothèque locale de prompts réutilisables avec variables à remplir —
`{{sujet}}`, `{{langue}}` — et tokens dynamiques (`{date}`, `{os}`). Un preset =
{nom, description, texte, variables auto-détectées, system-prompt optionnel}.

FICHIERS À LIRE D'ABORD : le store de config existant (electron-store / app-store
helper) pour le pattern de persistance chiffrée/userData, SlashCommandMenu.tsx
(pattern d'autocomplétion), la zone de saisie ChatView.

SPÉCIFICATION :
1. Persistance : JSON dans userData (pattern des stores existants), CRUD via IPC
   invoke (preload) — PAS dans client-event-allowlist.
2. UI : entrée « Presets » dans le menu `/` existant (ex. `/preset <nom>`) +
   panneau de gestion dans Réglages (liste, créer, éditer, supprimer).
3. Insertion : choisir un preset → dialogue de remplissage des {{variables}}
   détectées (regex simple) → texte final inséré dans la zone de saisie
   (PAS envoyé automatiquement). Tokens {date}/{os} résolus à l'insertion.
4. Le system-prompt optionnel du preset s'ajoute au prompt UTILISATEUR (préfixe),
   pas au préfixe système stable (préserver le cache KV).
5. i18n ×12 pour l'UI ; le contenu des presets reste tel quel.

HORS PÉRIMÈTRE : partage/import-export, presets par workspace, avatars.

TESTS : détection des {{variables}} (doublons, imbriqués, aucun) ; résolution
{date}/{os} ; CRUD du store (fichier temporaire).
```

---

## Prompt 5 — Citations de sources [1][2]  `cursor/inline-citations`

```text
[Règles communes du lot 1]

TÂCHE : Quand une réponse s'appuie sur la recherche web (SearXNG) ou web_fetch,
afficher une section « Sources » cliquable sous le message (titre, domaine,
favicon optionnel), et encourager le modèle à citer inline [1][2].

FICHIERS À LIRE D'ABORD : les handlers web_search/web_fetch dans src/main/tools/,
le format des trace steps (session-manager, TraceStep), MessageCard/ContentBlockView
(rendu), la consigne <citation_requirements> existante dans agent-runner-prompts.ts.

SPÉCIFICATION :
1. Collecte : à partir des tool_results web_search/web_fetch du TOUR courant
   (déjà présents dans les traces), extraire {titre, url} de chaque résultat
   réellement retourné au modèle. Aucune requête réseau supplémentaire.
2. Numérotation : injecter dans le RÉSULTAT des outils web une ligne d'index
   « [n] titre — url » (le modèle voit les numéros et peut citer [n]) ; adapter
   la consigne <citation_requirements> existante pour demander des marqueurs [n]
   inline quand des sources numérotées sont fournies. Chaîne CONSTANTE (préfixe stable).
3. Rendu : sous le message assistant, carte « Sources » repliable listant les [n]
   utilisés (détectés par regex \[\d+\] dans le texte) ∪ tous les résultats cités ;
   les [n] du texte deviennent des liens vers l'entrée correspondante.
4. Pas de post-traitement du texte du modèle au-delà de la linkification des [n].
5. i18n ×12 (« Sources », états vides).

HORS PÉRIMÈTRE : citations pour MCP tools, vérification des URLs, favicons distants
(utiliser une icône locale générique — pas de requête réseau depuis le renderer).

TESTS : extraction sources depuis un trace step simulé ; mapping [n]→url ;
regex inline (faux positifs type « tableau [1] » sans sources → pas de lien).
```

---

## Prompt 6 — Recherche sémantique de fichiers  `cursor/semantic-file-search`

```text
[Règles communes du lot 1]

TÂCHE : Outil natif `semantic_search` — « grep par le sens » : indexe les fichiers
texte du workspace en embeddings locaux et renvoie des hits `file:line` classés
pour une requête en langage naturel. Complément de glob/grep, PAS un RAG documents.

FICHIERS À LIRE D'ABORD : la config embeddings mémoire existante (memoryRuntime,
memory-llm-client, embedQuery/cosineSimilarity dans memory-utils), les outils natifs
existants (src/main/tools/, schémas TypeBox plats), chokidar (déjà en dépendance),
path-containment (le tool ne doit voir QUE le workspace).

SPÉCIFICATION :
1. Opt-in : réglage « Recherche sémantique » (OFF), actif seulement si un endpoint
   d'embeddings est déjà configuré (réutiliser la config mémoire — pas de nouvelle
   section). Si OFF ou non configuré : l'outil n'est PAS exposé au modèle.
2. Index : par workspace, dans userData (SQLite table additive ou fichier dédié —
   suivre le pattern du store mémoire). Chunking simple par blocs de lignes
   (~60 lignes, overlap 10), fichiers texte uniquement (extensions allowlist),
   plafonds : 2 Mo/fichier, 5 000 fichiers ; respect de .gitignore (réutiliser
   la lib glob existante / ignore rules — pas de nouvelle dépendance).
3. Construction lazy au premier usage (progress loggé), puis incrémental via
   chokidar (debounce, re-embed uniquement les fichiers modifiés).
4. Outil : entrée {query, top_k?} → sorties [{file, line, excerpt, score}] ;
   schéma TypeBox PLAT ; hits re-scorés par le reranker mémoire si activé
   (réutiliser maybeRerankMemoryItems, fallback identique).
5. Path-containment : tout chemin résolu DOIT passer par la validation existante.
6. i18n ×12 pour le réglage.

HORS PÉRIMÈTRE : ingestion PDF/docx, citations UI, index cross-workspace,
recherche dans l'historique de chat.

TESTS : chunking (bornes, overlap) ; allowlist extensions + plafonds ; pipeline
index→query sur répertoire temporaire avec embeddings mockés ; containment
(chemin hors workspace rejeté) ; incrémental (fichier modifié → chunks remplacés).
```

---

## Prompt 7 — Contexte épinglé @-mention  `cursor/at-mention-context`

```text
[Règles communes du lot 1]

TÂCHE : Taper `@` dans la zone de saisie ouvre une autocomplétion — `@fichier`,
`@dossier`, `@url` — et les mentions sont résolues à l'envoi en contexte explicite
joint au message.

FICHIERS À LIRE D'ABORD : SlashCommandMenu.tsx + son câblage dans ChatView
(pattern d'autocomplétion existant à REPRODUIRE, pas réinventer), les outils
glob/read existants côté main (listing fichiers du workspace), web_fetch.

SPÉCIFICATION :
1. Déclencheur : `@` en début de mot → menu ; sources : fichiers/dossiers du
   workspace (via IPC de listing, fuzzy sur le chemin relatif, max 20 résultats),
   et détection d'URL collée après @.
2. Résolution à l'envoi (côté main) : @fichier → contenu (plafond 64 Ko, tronqué
   avec marqueur) ; @dossier → listing 1 niveau ; @url → web_fetch existant.
   Chaque mention devient un bloc préfixé au prompt utilisateur :
   <attached_context source="...">…</attached_context>. Path-containment obligatoire.
3. Le message affiché dans l'historique garde la mention compacte (@src/foo.ts)
   avec le bloc complet visible dans le panneau de contexte/trace, pas en clair
   dans la bulle.
4. Échecs silencieux par mention (fichier disparu → note courte dans le bloc).
5. i18n ×12 (placeholder du menu, erreurs).

HORS PÉRIMÈTRE : @problems/@terminal/@git-diff, mentions dans le Chat LAN léger,
drag-and-drop (existe déjà via upload).

TESTS : parsing des mentions dans un texte (multiples, adjacentes, échappées) ;
résolution fichier avec plafond/troncature ; containment ; dossier → listing.
```

---

## Prompt 8 — Checkpoints & annulation  `cursor/checkpoints`

```text
[Règles communes du lot 1]

TÂCHE : Filet de sécurité : avant que l'agent modifie des fichiers, capturer des
pré-images pour permettre « Annuler les changements de ce run » d'un clic.
SANS dépendre d'un binaire git sur la machine.

ÉTAPE 0 OBLIGATOIRE — INVESTIGATION (résumer avant de coder) :
Où passent concrètement les écritures fichiers de l'agent ? Cartographier :
(a) les built-ins pi write/edit — sont-ils observables côté app (événements de
stream tool_use AVANT exécution ? wrapper possible comme _onPayload ?) ;
(b) le bash (sandbox WSL/Lima et natif) — non interceptable finement : décision
attendue = checkpoints couvrent write/edit + création de fichiers détectée, et
le bash est couvert en best-effort (voir 3) ;
(c) tools/sandbox-tool-executor et le path-containment comme points de passage.
Si AUCUN point d'observation fiable n'existe pour write/edit, S'ARRÊTER et livrer
un rapport avec options (ex. remplacer les built-ins par des customTools wrappés
+ excludeTools), sans implémenter.

SPÉCIFICATION (si l'étape 0 donne un point d'accroche) :
1. Store : userData/checkpoints/<sessionId>/<runId>/ — copie du fichier AVANT sa
   première modification du run (pré-image) + journal JSON {path, action
   modified|created, preImagePath?}. Plafond : 50 Mo/run (au-delà : stop capture,
   marquer le run « partiellement couvert » dans le journal et l'UI).
2. Best-effort bash : snapshot par chokidar sur le workspace pendant le run
   UNIQUEMENT (start/stop au run), pré-image à la première notification si le
   fichier n'est pas déjà couvert. Documenter la fenêtre de course connue.
3. Restore : « Annuler ce run » (menu du message assistant) → réécrit les
   pré-images, supprime les fichiers `created`, dans l'ordre inverse ; refus si
   un run est en cours sur la session. Confirmation avec liste des fichiers.
4. Rétention : garder les N derniers runs par session (défaut 10), purge au-delà
   + purge à la suppression de session.
5. Réglage on/off (défaut ON), i18n ×12.

HORS PÉRIMÈTRE : timeline multi-runs (revert cumulatif), diff visuel (prompt 9),
snapshot du sandbox VM lui-même.

TESTS : capture pré-image unique par fichier/run ; restore modified+created ;
plafond → couverture partielle signalée ; purge rétention ; refus pendant un run.
```

---

## Prompt 9 — Modes d'autonomie (Prudent / Normal / Autonome)  `cursor/autonomy-modes`

```text
[Règles communes du lot 1]
PRÉREQUIS : la branche des checkpoints (prompt 8) est mergée.

TÂCHE : Un sélecteur à 3 niveaux par session qui règle le degré de contrôle :
- PRUDENT : chaque write/edit est proposé en DIFF à approuver avant écriture ;
- NORMAL (défaut) : comportement actuel exactement ;
- AUTONOME : après les modifications, lance lint/tests configurés et laisse
  l'agent corriger en boucle (plafond d'itérations).
Étend le pattern Plan/Act existant (#135) — même mécanique, pas un nouveau système.

ÉTAPE 0 OBLIGATOIRE — INVESTIGATION :
(a) Le flux de permissions existant (decidePermission, permission-rules-store,
ask/permission.response IPC) peut-il porter une approbation PAR ÉDITION avec
payload diff (ancien/nouveau contenu) ? (b) Même question d'interception write/edit
que le prompt 8 — réutiliser son point d'accroche. Si le diff-approve n'est pas
faisable proprement via le flux existant, livrer Prudent SANS diff (approbation
sur nom de fichier + taille du changement) et le documenter.

SPÉCIFICATION :
1. Étendre session.mode : 'plan' | 'act' reste, ajouter un réglage par session
   `autonomy: 'careful' | 'normal' | 'autonomous'` (défaut normal, colonne DB
   additive, IPC get/set, garde pendant un run — pattern #135 à l'identique).
2. PRUDENT : au point d'accroche write/edit, suspendre l'exécution et pousser une
   demande d'approbation (flux permissions existant) avec diff unifié calculé
   côté main ; approuver/refuser/« tout approuver pour ce run ». Refus → l'outil
   renvoie une erreur explicite au modèle (il peut ajuster).
3. AUTONOME : config par workspace {lintCmd?, testCmd?} (Réglages, vides par
   défaut) ; à la fin d'un run AVEC modifications, si une commande est configurée :
   l'exécuter via le pipeline bash/sandbox existant, et si échec, renvoyer stdout/
   stderr tronqués (plafond 8 Ko) comme message utilisateur automatique
   « corrige ces erreurs » — max 3 itérations, puis s'arrêter avec résumé.
   Checkpoints (prompt 8) restent actifs — c'est le filet.
4. UI : le toggle Plan/Act devient un groupe : Plan | Act, et sous Act un
   sélecteur Prudent/Normal/Autonome (icônes + tooltip) ; badge du mode actif ;
   i18n ×12.
5. Interactions : mode plan ⇒ sélecteur d'autonomie masqué (rien à écrire) ;
   Quick Ask reste en plan (inchangé).

HORS PÉRIMÈTRE : classifieur LLM d'approbation (SmartApprove), allowlists de
commandes par pattern, approbation des commandes bash en Prudent (permissions
existantes inchangées), diff par hunk (tout-ou-rien par fichier).

TESTS : transitions d'état + persistance + garde run (pattern #135) ; boucle
autonome (échec→retry→plafond 3→stop ; succès→stop) ; troncature 8 Ko ;
Prudent : refus → erreur outil transmise au modèle (mock du point d'accroche).
```

---

## Après chaque branche

Comme au lot 1 : « vérifie la branche cursor/xxx » → revue Claude (typecheck/lint/
vitest sur l'arbre mergé, périmètre, i18n ×12, sécurité IPC/LAN, stabilité du
préfixe, rétro-compat DB/config). Verdict mergeable ou corrections précises.

---

## Ménage post-lot 2  `cursor/cleanup-lot2`

_Trois dettes d'hygiène relevées pendant les revues des PRs #142/#145/#146/#147.
AUCUN changement de comportement attendu._

```text
[coller les Règles communes du lot 1]

TÂCHE : Trois nettoyages sans changement de comportement, branche cursor/cleanup-lot2
depuis main.

1. DÉDUP PATH-SAFETY (#146/#147) — deux modules quasi identiques coexistent :
   src/main/semantic-search/path-safety.ts et src/main/tools/path-safety.ts.
   Faire de src/main/tools/path-safety.ts LA seule source :
   - y déplacer toWorkspaceRelativePath (aujourd'hui uniquement dans la version
     semantic-search) s'il n'y est pas déjà ;
   - mettre à jour tous les imports de semantic-search (index-service, manager,
     etc.) vers tools/path-safety ;
   - supprimer src/main/semantic-search/path-safety.ts ;
   - fusionner/adapter les tests (src/tests/tools/path-safety.test.ts devient le
     seul fichier de tests ; reprendre les cas de la version semantic-search qui
     manquent, notamment toWorkspaceRelativePath).

2. LINKIFICATION HORS CODE (#145) — dans src/shared/web-citation.ts,
   linkifyCitationMarkers réécrit aussi les [n] situés dans les blocs de code.
   Segmenter le texte : fences ``` (multilignes) et backticks inline `…` sont
   des zones interdites — la substitution [n] → [[n]](url) ne s'applique QUE
   hors de ces zones. Implémentation simple par scan des segments (pas de
   parseur markdown complet). Tests dans src/tests/shared/web-citation.test.ts :
   [1] dans un fence → intact ; [1] dans `code inline` → intact ; [1] en texte
   normal de la même chaîne → linkifié ; fence non fermé → tout ce qui suit
   l'ouverture est traité comme code (choix conservateur).

3. MICRO (#142) — src/main/db/message-search-index.ts : supprimer la variable
   offset inutilisée et son `void offset` dans buildHighlightedExcerpt (et le
   commentaire associé).

Vérifications : npm run typecheck && npm run lint && npx vitest run → tout vert.
Le diff doit être net négatif ou quasi neutre en lignes.
```
