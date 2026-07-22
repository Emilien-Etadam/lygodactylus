# Changelog

All notable changes to the Lygodactylus AI agent desktop app will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [6.4.0] - 2026-07-22

> Inclut également le contenu de la 6.3.0 (extension Thunderbird), documentée
> ci-dessous mais jamais publiée en release.

### Added

- **Dictée vocale locale (STT)** : bouton micro dans la zone de saisie — clic (toggle) ou maintien (push-to-talk), transcription 100 % locale via **whisper.cpp v1.9.1** téléchargé au premier usage (win/linux : releases officielles ; macOS : bottle Homebrew épinglé par digest), modèle `ggml-base` multilingue vérifié par sha256, texte inséré au curseur — jamais d'envoi automatique (#165)
- **Veille automatique** : watchers dossier local / flux RSS-Atom / URL (parser XML maison, zéro dépendance) sur le moteur cron existant ; digest des nouveautés uniquement dans une session « Veille » en mode plan — premier passage silencieux, aucun message quand rien de neuf (#158)
- **Masquage PII sortant** (opt-in, OFF) : e-mails, téléphones FR/E.164, IBAN (mod-97), cartes (Luhn) et termes personnels remplacés par des jetons réversibles `{{PII_n}}` avant tout appel sortant (web_search, web_fetch, http_request, outils MCP), restaurés dans la réponse ; **fail-closed** — une erreur du module bloque l'appel ; compteur discret dans la trace (#159)
- **Aperçu live HTML/SVG** : bouton « Aperçu » sur les blocs de code des réponses — rendu dans une iframe sandboxée (`allow-scripts` seul, CSP `default-src 'none'` injectée en tête absolue : **aucune requête réseau possible**), versions successives par session, « ouvrir en grand » dans une fenêtre isolée sans preload (#161)
- **Dossiers de chats + sous-chats** : sidebar organisée en dossiers repliables (créer/renommer/supprimer — les sessions ne sont jamais effacées), et sous-chats branchés depuis un message assistant avec lien de retour, indentation et anti-cycle ; recherche inchangée avec le dossier en sous-titre (#155)
- **Quick-Ask « Sélection »** : second raccourci global (défaut `Ctrl/Cmd+Shift+Y`) qui ouvre le Quick-Ask pré-rempli du presse-papier (troncature UTF-8-safe 32 Ko), chips Résumer / Traduire / Reformuler / Corriger et bouton « Copier le résultat » — session toujours en mode plan (#157)
- **Verrou d'intégrité des skills** : à l'installation marketplace, le commit est résolu en SHA exact et un hash sha256 du contenu est épinglé ; vérification manuelle + contrôle silencieux au démarrage (badge, jamais de blocage), mise à jour ré-épinglée et restauration à la version épinglée (#154)
- **Badge de localisation du modèle** : « Local » / hôte LAN / distant affiché sur le chip modèle et dans le panneau contexte, dérivé de l'URL configurée (aucune requête), tooltip expurgé de tout secret (#153)
- **Harnais « contrat SDK »** : `src/tests/sdk-contract/` verrouille chaque point de contact avec le SDK pi (exports, extension points, invariants byte-stables, patch) — les bumps deviennent une procédure outillée (`docs/cursor-prompts-maintenance.md`, M1–M4) (#174)

### Changed

- **SDK pi 0.80.3 → 0.81.1** (lockstep) : migration `AuthStorage`/`ModelRegistry` → singleton `ModelRuntime` (`allowModelNetwork: false` — jamais de rafraîchissement réseau des catalogues), patch DeepSeek V4 régénéré (#177)
- **keep_alive / num_ctx Ollama réparés** : le wrapper reposait sur une surface privée du SDK disparue (inopérant silencieusement) — porté sur l'API officielle d'extensions (`before_provider_request`), keep_alive lu en direct à chaque requête (#177)
- **Skill OfficeCLI épinglé** : l'installeur flottant amont (`curl | bash`) est remplacé dans notre copie par le téléchargement de la release GitHub **v1.0.140** avec sha256 vérifié avant toute exécution (fail-closed) ; provenance et divergence documentées dans `NOTICE.md`, resync doc+binaire ensemble via le prompt M4 (#180)
- **Dependabot** : les bumps du SDK pi (`@earendil-works/*`) sont pilotés manuellement (harnais + patch + lockstep) et exclus des PRs automatiques

### Fixed

- **Audit de sécurité runtime** : overrides `brace-expansion` (par majeure), `js-yaml ^4.3.0`, `fast-uri ^3.1.4` suite aux advisories de juillet ; l'exception temporaire liée à la copie bundlée du SDK 0.80.x est supprimée — audit vert sans exception (#166, #167, #177)
- **Parser Atom (veille)** : `rel="alternate"` réellement préféré, `rel="self"` ignoré (#171)
- **Transcriptions STT** : une transcription à la fois (garde busy, erreur claire) (#171)

### Removed

- **Executors legacy pré-pi-SDK** (`tool-executor.ts`, `sandbox-tool-executor.ts` + orphelins) : code mort dont le `web_search` contournait le masquage PII s'il avait été rebranché — supprimés avec leur couverture migrée sur les modules vivants ; −1 487 lignes (#171)

### Security

- `isUncPath` étendu aux UNC en forward-slash (`//server/share`) — les gardes de `main-shell-reveal` et des contraintes de workspace couvrent désormais les deux formes (#171)
- Politique générale de la série : tout téléchargement est épinglé (version/digest) et vérifié (sha256) **avant** exécution — whisper.cpp, modèles ggml, OfficeCLI


## [6.3.0] - 2026-07-17

### Added

- **Extension Thunderbird / Betterbird « Lygodactylus Mail »** (`extension-thunderbird/`) — pendant courrier de l'extension Firefox : résumer, traduire, analyser le ton/l'intention, expliquer et vérifier un e-mail affiché ; suggérer une réponse ou reformuler un brouillon (tons : standard, formel, amical, concis, développé, poli), avec insertion directe dans la fenêtre de composition. Client léger du **Chat LAN** (mêmes URL + token extension) : toute la logique de modèle reste dans Lygodactylus, aucun fournisseur ni clé d'API à configurer dans l'extension, **aucune modification serveur** (actions `custom`/`translate` de `/api/web-action`, CORS `moz-extension://` déjà compatible Thunderbird). Prompts et intégration Thunderbird repris et retravaillés depuis aimailsupport (MIT). Packaging `.xpi` via `package-thunderbird-extension.yml` (tags `tbext-v*`)
- **Installation de l'extension Thunderbird depuis l'app** : nouveau bloc « Extension Thunderbird » dans Réglages → Chat LAN — télécharge le dernier `.xpi` (`tbext-v*`), détecte Thunderbird / Betterbird (Windows, macOS, Linux) et l'ouvre pour l'installation, avec copie automatique du token extension. Moteur d'installation généralisé et partagé avec le bouton Firefox (`src/main/browser-extension-installer.ts`). Note UI : Thunderbird exige une signature — l'app rappelle d'utiliser `xpinstall.signatures.required=false` ou une version signée ATN si l'installation est refusée

### Changed

- **Installeur d'extension refactorisé** : la logique commune (récupération de la release, détection multi-navigateurs par plateforme, ouverture du `.xpi`) est extraite dans un moteur générique ; `firefox-extension-installer.ts` et `thunderbird-extension-installer.ts` n'en sont plus que des configurations (préfixe de tag + catalogue de navigateurs)

## [6.2.1] - 2026-07-17

### Changed

- **Installation de l'extension dans les forks Firefox** : le bouton « Installer dans Firefox » détecte désormais toute la famille Firefox — Firefox (+ Developer Edition / Nightly / ESR), Waterfox, LibreWolf, Floorp, Mullvad Browser, Zen — sur Windows, macOS et Linux. Le `.xpi` signé AMO s'y installe puisque ces navigateurs honorent la signature Mozilla. Quand plusieurs navigateurs compatibles sont présents, l'app propose de choisir lequel utiliser ; sinon elle ouvre le seul détecté (types partagés `src/shared/firefox-extension.ts`, détection testée par plateforme)

## [6.2.0] - 2026-07-15

### Added

- **Installation en un clic de l'extension Firefox** : nouveau bloc « Extension Firefox » dans Réglages → Chat LAN — l'app télécharge le dernier `.xpi` signé depuis les releases GitHub (tags `ext-v*`), l'ouvre dans Firefox (détection par plateforme Windows/macOS/Linux ; téléchargement dans le dossier Téléchargements pour rester lisible par les Firefox sandboxés snap/flatpak) et copie automatiquement le token extension dans le presse-papier. Si Firefox est introuvable, le `.xpi` reste disponible et l'UI pointe vers `about:addons` ; bouton de secours vers la page des releases (8 clés i18n, 12 locales)

### Changed

- **CI** : le workflow de signature de l'extension (`sign-extension.yml`) accepte un déclenchement manuel (`workflow_dispatch`, input `tag`) — le tag `ext-vX.Y.Z` est créé sur le commit courant s'il n'existe pas encore ; première release extension publiée (`ext-v1.0.0`)

## [6.1.2] - 2026-07-15

### Fixed

- **Fenêtre de contexte** : l'app détecte désormais la fenêtre de contexte réellement servie par l'endpoint au lieu de se fier aux specs par famille de modèle — sonde Ollama `/api/show` étendue aux hôtes distants (LAN), et lecture de `max_model_len` / `context_length` dans `/v1/models` pour vLLM et compatibles (cache par endpoint+modèle, timeout 4 s, échec non bloquant). Corrige le scénario « contexte plein côté serveur alors que la jauge affiche 50 % et que `/compact` répond “rien à compacter” » quand le déploiement plafonne le contexte en dessous du nominal (ex. qwen3.6 servi à 131k au lieu de 262k). Une « Fenêtre de contexte » saisie manuellement dans Réglages → API garde la priorité

## [6.1.1] - 2026-07-15

### Fixed

- **Sandbox WSL / bash** : cause racine des timeouts systématiques (v6.0.2 et v6.0.4 n'avaient corrigé que des problèmes périphériques) — le script envoyé au shell persistant joignait ses morceaux par des espaces au lieu de retours à la ligne : les `echo` des marqueurs de fin devenaient des arguments de la commande utilisateur et le groupe `{` ne se refermait jamais, donc bash attendait indéfiniment sans rien exécuter et chaque commande expirait à son timeout. Script reconstruit en bloc `if/fi` multi-lignes ; l'échec de `cd` ne tue plus le shell persistant ; ajout de tests d'intégration contre un vrai bash (les tests unitaires mockaient le shell et ne pouvaient pas détecter d'erreur de syntaxe)

## [6.1.0] - 2026-07-14

### Added

- **Chat LAN — UI React complète servie à `/app/`** : les clients LAN accèdent au vrai renderer desktop (streaming avec thinking et traces d'outils, permissions interactives, slash commands des plugins, fork/rewind de messages, panneau de contexte) sans duplication de code UI — shim web-bridge HTTP/SSE installé quand `window.electronAPI` est absent, endpoints bridge validés par la même allowlist de `ClientEvents` que l'IPC Electron, canaux de gestion rejetés par design, secrets masqués en profondeur côté serveur (`chat-lan-redact.ts`)
- **Mobile Companion PWA** : appairage par QR code, UI installable sur mobile, SSE compatible proxy
- **Niveau de raisonnement réglable par prompt** : nouvelle config `thinkingLevel` (low/medium/high) combinée à `enableThinking`, hot-swappée sur la session, avec bouton Off/Faible/Moyen/Élevé dans le composer (12 locales) ; envoi de `chat_template_kwargs.enable_thinking` aux endpoints OpenAI-compatibles non-Ollama (vLLM, SGLang) et reconnaissance de `qwen3.6` (contexte 262k) comme modèle raisonnant
- **Catalogues tiers dans la marketplace** : enregistrement de sources additionnelles (URL d'un `manifest.json`) dans Paramètres → Extensions → Catalogues — entrées externes préfixées par source, forcées « Non vérifié », stratégies de résolution limitées à github/mcp-registry, dernier manifest valide conservé en cas d'échec réseau transitoire (18 clés i18n, 12 locales)
- **Skill OfficeCLI dans la marketplace** : nouvelle entrée catalogue (Réglages → Extensions) qui installe le skill [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) (Apache-2.0) — génération et édition de documents Office (`.docx`, `.xlsx`, `.pptx`) via le binaire autoporteur `officecli`, téléchargé au premier usage par le skill lui-même (dans le sandbox quand il est actif). Redonne une capacité de génération documentaire après le retrait en v6.0 des skills documents propriétaires d'Anthropic ; `SKILL.md` vendorisé dans `catalog/skills/officecli/` (politique curated-strict, provenance dans `NOTICE.md`)

- **Planifications pilotables par l'agent** : nouveaux outils natifs `schedule_list`, `schedule_create`, `schedule_update`, `schedule_delete`, `schedule_toggle`, `schedule_run_now` exposés au LLM — l'agent peut désormais consulter, créer, modifier, activer/désactiver, supprimer et déclencher les planifications (Paramètres → Planifications) directement depuis le chat (modes unique, quotidien, hebdomadaire et intervalle), avec les mêmes validations que l'UI (répertoire de travail supporté, heure d'exécution future)

- **Tool-call guard** : détection des tool calls « hallucinés » en texte par les modèles locaux (ex. Qwen3.x à contexte profond) — appel émis en balises `<tool_call>`/`<function=…>` ou laissé dans le raisonnement au lieu d'un appel structuré ; l'app recadre automatiquement le modèle pour qu'il réémette l'appel via le vrai mécanisme de tool calling (2 relances max par run)
### Changed

- **Ménage du dépôt** : suppression de fichiers morts (`resources/WeChat.jpg`, doublon `resources/logolygo.png`, script one-shot de backlog) ; `.gitignore` corrigé — les icônes suivies de `resources/` et le dossier `docs/` ne sont plus masqués par les règles `*.png` et `docs/`

### Fixed

- **CI** : les appels API GitHub de `tests/catalog-github-paths.test.ts` sont désormais authentifiés (`GITHUB_TOKEN`) — corrige les échecs 403 dus au quota anonyme partagé des runners

## [6.0.4] - 2026-07-09

### Fixed

- **Sandbox WSL / bash** : timeouts systématiques (même sur `echo test`) — le timer de timeout par commande démarrait avant que le shell WSL persistant confirme qu'il était prêt à lire stdin, donc un démarrage à froid de la VM WSL2 (fréquent après ~8s d'inactivité) consommait tout le budget du timeout ; pire, le timeout tuait le process WSL, provoquant un nouveau démarrage à froid en boucle pour chaque commande suivante. Ajout d'un handshake de disponibilité explicite avant d'armer le timer de la commande.

## [6.0.3] - 2026-07-08

### Added

- **Mémoire** : extraction en JSON garanti via `response_format: { type: 'json_object' }` (SDK OpenAI en direct) sur le rail OpenAI-compatible (vLLM/Ollama), avec repli gracieux sur pi-ai ; `openai` promu en dépendance directe pour rendre `import('openai')` résolvable (corrige aussi le chemin embeddings)

### Changed

- **Mémoire** : garde-fous à l'ingestion contre l'auto-empoisonnement — les sessions en erreur/abandonnées ou au texte dégénéré (boucles, faible diversité lexicale) ne sont plus mémorisées ; chunks dégénérés filtrés ; `rawSession` non stocké pour un résumé dégénéré

### Fixed

- **CI** : erreur `tsc` préexistante (paramètre de test inutilisé) qui rendait la CI rouge pour toutes les PR

## [6.0.2] - 2026-07-08

### Fixed

- **Sandbox WSL / bash** : commandes qui time-out (même `echo test`) — les marqueurs de fin de commande n’étaient pas détectés avec les fins de ligne CRLF de WSL ; le proxy LAN ne bloque plus le démarrage de la session ; le timeout couvre aussi l’initialisation WSL

## [6.0.1] - 2026-07-08

### Fixed

- **Sandbox WSL / bash** : le tool bash ne démarrait plus quand le proxy réseau LAN sandbox était activé et que WSL exposait l’IP DNS virtuelle `10.255.255.254` (mode réseau miroir) — `EADDRNOTAVAIL` au bind du proxy ; le bash continue désormais sans proxy LAN si le bind échoue

## [6.0.0] - 2026-07-07

Série **v6** : fork recentré **local-first** (Ollama/vLLM en OpenAI-compatible), runtime Electron 43, sans SDK cloud en dépendances directes.

### Changed

- **Electron 41 → 43** (Chromium M150, Node.js v24.18 embarqué) : rebuild `better-sqlite3` aligné sur la version Electron installée
- **Diagnostics API** : auth loopback (skip immédiat) ; remote via `probeWithPiAi` ou `GET /v1/models` en HTTP — plus d’import `@anthropic-ai/sdk` / `openai`
- **Vision GUI** : route unique OpenAI-compatible HTTP (`/v1/chat/completions`) ; défauts locaux Ollama (`http://localhost:11434/v1`)
- **Mémoire** : embeddings via `fetch` HTTP au lieu du SDK OpenAI
- **Presets modèles** : exemples locaux (`qwen3.5:0.8b`, `llama3.2`, `qwen3:8b`)
- **Phase 4 (config)** : `migrateLegacyConfig()` one-shot au boot ; suppression de la projection legacy bidirectionnelle
- **pi-model-resolution** : retrait des branches `google` / `gemini`
- **agentCliPath** : `claudeCodePath` lu en fallback, plus jamais écrit
- **i18n** (12 locales) : libellés skills / thinking mode neutralisés ; clés cloud obsolètes supprimées

### Development

- **ESLint 9** flat config (`eslint.config.js`) ; `@typescript-eslint/*` ^8, `eslint-plugin-react-hooks` ^5

### Breaking changes

- `config.json` legacy (`openrouter`, `gemini`, `ollama`, `vllm`, profils dédiés) → migration auto vers **OpenAI-compatible** ou **Anthropic-compatible** au démarrage. Vérifiez `baseUrl`, `model`, `apiKey` après mise à jour.
- `claudeCodePath` n’est plus persisté → utiliser `agentCliPath`
- OpenRouter manuel : profil **OpenAI-compatible**, `baseUrl` `https://openrouter.ai/api/v1`
- Installateurs régénérés avec Electron 43 ; `npm run rebuild` requis après upgrade depuis v5.x

### Removed

- Dépendances directes orphelines : `@google/genai`, `@opentelemetry/api`, `@anthropic-ai/sdk`, `openai`
- Sandbox Claude Code (WSL/Lima) : chemins `installClaudeCode` / `runClaudeCode` jamais utilisés
- Alias `auth-utils` dépréciés ; wrappers `ConfigNormalizer` / `SLASH_COMMAND_DEFINITIONS`

### Dependencies

- `@earendil-works/pi-ai` + `pi-coding-agent` ^0.80.3 ; patch `pi-ai` régénéré
- `electron` ^43.1.0, `electron-builder` ^26.15.3, `electron-updater` ^6.8.9
- Vitest ^4.1.10, `zustand` ^5.0.14, `lucide-react` ^1.23.0, `typebox` ^1.3.4, `prettier` ^3.9.4

## [5.9.0] - 2026-07-01

### Added

- **Marketplace** : installation de skills `SKILL.md` téléchargés à la demande depuis un dépôt GitHub (résolveur `via: "github"` + `type: "skill"`), sans vendoring ni re-hébergement
- **Skills** : `requesting-code-review` (Nous Research, MIT) et `skill-creator` (Anthropic, Apache-2.0) disponibles à l'installation via le marketplace

### Removed

- **Skills** : retrait des skills documents propriétaires d'Anthropic (`docx`, `pdf`, `pptx`, `xlsx`) — licence « All rights reserved » incompatible avec la redistribution ; suppression du dépôt, du packaging, des bundles de release et du téléchargement runtime

## [5.8.1] - 2026-06-28

### Fixed

- **Chat** : timeout `preparePiSessionRun` (120–180 s) — timeouts par phase, dégradation gracieuse (`resourceLoader.reload`, runtimes Node/Python, extensions)
- **vLLM** : ne plus appeler l’API Ollama `/api/show` sur un endpoint vLLM local
- **Mémoire + vLLM distant** : plafond 30 s sur la préparation mémoire au démarrage ; skip des embeddings hérités d’un endpoint d’inférence non-OpenAI (recherche lexicale à la place)
- Message utilisateur explicite `errSessionSetupTimeout` (i18n)

### Changed

- **UI** : largeur des sidebars réduite de 10 %

## [5.8.0] - 2026-06-28

### Added

- **Sandbox LAN network** : outil `http_request` (method, headers, body), headers optionnels sur `web_fetch`, proxy hôte authentifié pour curl/wget WSL (opt-in Réglages)
- Filtrage RFC1918 sur le proxy sandbox ; internet public reste direct depuis WSL

### Changed

- **Repo app-only** : suppression site VitePress, bots DeepSeek, gouvernance upstream (CODEOWNERS, templates, CONTRIBUTING), husky/commitlint
- Dépendance directe `typebox` pour la résolution TypeScript

## [5.7.0] - 2026-06-28

### Added

- **Tool Completeness** : outils natifs `glob`/`find`, `grep`, `web_fetch`, `web_search`, `todo_write`, `ask_user_question` avec alias PascalCase pour compatibilité historique
- Schémas TypeBox plats optimisés pour **LiteLLM → vLLM → Qwen 3.6 27B** (tool calling OpenAI-compatible)
- **AskUserQuestion** interactif : IPC `question.request` / `question.response`, UI inline avec soumission des réponses

### Changed

- `buildNativeCustomTools` branché dans `agent-runner-pi-setup` aux côtés de la recherche web et des outils MCP

## [5.6.0] - 2026-06-28

### Added

- **Memory UX** : panneau « Mémoire utilisée » dans le chat, toggle mémoire par session, scores de pertinence dans Paramètres
- **Memory hardening** : sanitization à l'ingestion, politique d'injection configurable (`escape` / `strip-suspicious` / `block`), ranker unifié (lexical + embedding + workspace + recency)
- **Linux releases** : build CI AppImage x64, script `npm run build:linux`, publication sur GitHub Releases

### Changed

- `MemoryRetriever` utilise le même ranker que la récupération runtime ; `sourceExcerpt` peuplé à la lecture
- Config mémoire : `chunkTopK`, `sessionTopK`, `injectionPolicy`, `showInjectedMemoryInChat`

## [5.5.0] - 2026-06-28

### Changed

- **Chemins agent** : `userData/claude/{skills,plugins}` → `userData/{skills,plugins}` avec migration automatique au démarrage
- **Sandbox VM** : `~/.claude/sandbox` → `~/.lygodactylus/sandbox` (sessions legacy conservées)
- **Lima** : instance `claude-sandbox` → `lygodactylus-sandbox` (détection des deux noms)
- **Manifeste sync** : `.opencowork-sync.json` → `.lygodactylus-sync.json` (lecture legacy)
- Préfixes temporaires `opencowork-*` → `lygodactylus-*` (plugins, export logs)
- Skills sandbox : `{sandbox}/skills` au lieu de `{sandbox}/.claude/skills`
- **Schéma** : colonne SQLite `agent_session_id` (migration depuis `claude_session_id`) ; config `agentCliPath` (migration depuis `claudeCodePath`)

## [5.4.0] - 2026-06-28

### Added

- **Skills on-demand** : `docx` et `pptx` (~2.7 MB) retirés de l'installateur ; téléchargement depuis GitHub Releases au premier usage (`userData/runtimes/skills/{version}/`)
- **Skill bundles CI** : job `skill-bundles` publie `lygodactylus-skill-{docx|pptx}-v{version}.tar.gz` sur chaque release
- **Lazy-load SDKs** : `openai` et `@anthropic-ai/sdk` chargés à la demande (embed mémoire, diagnostics API)

### Changed

- **Skills core** : seuls `pdf`, `xlsx`, `skill-creator` embarqués via `resources/skills-core/`
- Migration automatique depuis les anciens bundles `extraResources/skills` complets (docx/pptx inclus)
- Preflight : avertissement si skills lourds pas encore téléchargés

## [5.3.0] - 2026-06-28

### Added

- **Python on-demand** : runtime Python 3.10.19 (python-build-standalone) téléchargé dans `userData` au premier usage GUI — Pillow + pyobjc sur macOS (~30–45 MB économisés sur l'installateur)
- **cliclick on-demand** (macOS) : téléchargement/copie à la demande avec repli Quartz si absent
- **Détection automatique des modèles** pour les endpoints API distants (#63)

### Changed

- **Node.js on-demand** : le runtime Node n'est plus embarqué dans l'installateur ; téléchargement automatique dans `userData` au premier usage MCP (~25–35 MB économisés sur Windows)
- Migration automatique depuis les anciens bundles `extraResources` (node, python, tools) si présents
- **1086 tests** passent en CI

## [5.1.0] - 2026-06-27

### Added

- **Hardening v5 (phases 0–3)** : stores MCP/Chat LAN chiffrés, sandbox macOS/Windows activé par défaut, allowlist IPC côté main, durcissement Chat LAN (Bearer SSE, en-têtes sécurité)
- **Qualité** : extractions modules (`command-sandbox-validation`, `skills-frontmatter`, `use-ipc-stream-batching`), tests tool-executor, seuil couverture CI 40 %
- **Sécurité dépendances** : migration `@earendil-works/pi-ai` / `pi-coding-agent` ^0.80.2 — **0 CVE runtime** (patch DeepSeek V4 porté)

### Changed

- **Node** : `engines` >= 22.19.0 (aligné earendil 0.80.2), CI/release sur Node 22.19
- **Allègement installateur** : retrait `@img`/sharp des artifacts, minify bundles MCP, locales Electron réduites (win/linux)
- **Renommage interne** : `src/main/claude/` → `src/main/agent/`, `AgentRunner`, `pi-ai-one-shot`, `probeWithPiAi` / `generateTitleWithPiAi`
- **1075 tests** passent en CI

## [5.0.0] - 2026-06-27

### Changed

- **Versioning** : passage à la série **v5** (semver `5.0.0`)
- **Logo** : nouveau gecko bleu Lygodactylus (`logolygo.png`) — icônes app, tray, favicon et UI régénérés
- **Rebranding** : application **Lygodactylus** (`com.lygodactylus.app`, dépôt `Emilien-Etadam/lygodactylus`)
- **Recherche web** : providers configurables (DuckDuckGo, SearXNG, YaCy)

## [3.3.1-EE4.98] - 2026-06-26

### Changed

- **Rebranding** : l'application s'appelle désormais **Lygodactylus** (`com.lygodactylus.app`, installeurs `Lygodactylus-*`)
- **Dépôt GitHub** : renommé en `Emilien-Etadam/lygodactylus` (URLs du projet mises à jour)
- Identifiants internes, i18n (12 langues), installateur Windows et script de nettoyage legacy mis à jour
- Les clés de chiffrement legacy Open Cowork restent supportées pour la rotation des configs existantes

## [3.3.1-EE4.97] - 2026-06-25

### Added

- **Messages utilisateur** : icônes fork (nouvelle session depuis ce message) et édition prompt (rewind + zone de saisie)
- IPC `session.forkFromMessage` et `session.rewindToMessage`

### Fixed

- **Compaction auto** : appel explicite à `compact()` avant `prompt()` quand le contexte est plein (~98 %+)
- **Barre de contexte** : une seule barre dans le panneau Contexte (sidebar) — suppression du doublon au-dessus de l’input
- **Erreur contexte plein** : hint `/compact` au lieu du message trompeur « réessaie automatiquement »

## [3.3.1-EE4.96] - 2026-06-25

### Fixed

- **Chat** : réflexion et réponses en streaming réaffichées en direct (multicast IPC — le listener plugin n’écrase plus `useIPC`)
- **Barre de contexte** : réintégrée au-dessus de la zone de saisie ; visible même panneau Contexte replié
- **Contexte** : affichage dès que la fenêtre est connue (réservation `maxTokens` incluse)

## [3.3.1-EE4.95] - 2026-06-25

### Fixed

- **Auto-update Windows** : `latest.yml` pointait vers `Lygodactylus-*.exe` au lieu de `Lygodactylus-*.exe` (téléchargement 404)
- Script CI `sync-windows-latest-yml.mjs` pour aligner le YAML sur le nom réel de l’installateur
- Affichage de l’erreur de téléchargement automatique dans Paramètres

## [3.3.1-EE4.94] - 2026-06-25

### Fixed

- **Chat LAN** : UI `index.html` introuvable en build packagé — copie via `extraResources` + résolution `process.resourcesPath`

## [3.3.1-EE4.93] - 2026-06-25

### Fixed

- **Mises à jour Windows** : attendre le téléchargement `electron-updater` avant d’afficher le résultat (bouton « Redémarrer et installer »)
- **UI mises à jour** : ne plus afficher « Windows uniquement » sur Windows ; message manuel réservé à macOS/Linux

## [3.3.1-EE4.92] - 2026-06-25

### Added

- **Chat LAN** : serveur web local avec UI (`resources/chat-lan/`), permissions et onglet Paramètres dédié (#44)
- **Config API** : deux fournisseurs uniquement — OpenAI-compatible et Anthropic-compatible, avec migration automatique (#42)

### Removed

- **Feishu** : intégration remote Feishu/Lark supprimée (#40)
- **Contrôle à distance** : module complet supprimé (gateway WebSocket, Slack, tunnel ngrok, panneau UI) (#41)

### Changed

- Dépendances allégées (`@larksuiteoapi/node-sdk`, code remote ~7k lignes retirées)

## [3.3.1-EE4.91] - 2026-06-25

### Fixed

- **Vérification des mises à jour** : chargement `electron-updater` via `createRequire` (`autoUpdater` undefined avec `import()` ESM)
- **Vérification des mises à jour** : repli API GitHub Releases si `electron-updater` échoue
- **Auto-update Windows** : `allowPrerelease = false` pour ignorer les releases draft du feed GitHub
- **CI** : lint `@typescript-eslint/no-var-requires` corrigé sur `auto-updater.ts`
- **PRs #36–#42** : rebasées sur `main`, handlers IPC update dédupliqués (`ipc-auto-update`)

## [3.3.1-EE4.9] - 2026-06-25

### Added

- **Bouton « Vérifier les mises à jour »** dans Paramètres → Général
- Affichage de la version au format **EE4.9** dans l’interface
- Vérification via `electron-updater` (Windows) ou API GitHub Releases (macOS/Linux)

### Fixed

- **Chat** : correction du blocage infini « Traitement… » après intégration des commandes plugin
- **Commandes slash** : rejet des commandes inconnues et normalisation `/plugin:cmd` pour le SDK Pi
- **CI** : test `session-manager-crud` aligné avec le reset des sessions `running` au démarrage

## [3.3.1-EE4.8] - 2026-06-25

### Added

- **Bouton « Vérifier les mises à jour »** dans Paramètres → Général
- Affichage de la version au format **EE4.8** dans l’interface
- Vérification via `electron-updater` (Windows) ou API GitHub Releases (macOS/Linux)

### Fixed

- **Chat** : correction du blocage infini « Traitement… » après intégration des commandes plugin
- **Commandes slash** : rejet des commandes inconnues et normalisation `/plugin:cmd` pour le SDK Pi

## [3.3.1-EE4.7] - 2026-06-25

### Fixed

- **Menu slash** : fond opaque (`bg-surface`) — l'historique du chat ne transparaît plus derrière l'autocomplétion `/`

## [3.3.1-EE4.6] - 2026-06-25

### Added

- **Auto-update Windows** depuis les releases GitHub du fork EE (`latest.yml`, `electron-updater`)
- **Commandes plugin** intégrées au menu slash (`/`)

## [3.3.1-EE4.5] - 2026-06-24

### Added

- Catalogue marketplace enrichi : **21 entrées** (manifest v2) — plugins workflow Anthropic + intégrations GitHub, Playwright, Linear, GitLab
- Test CI `catalog-github-paths` : validation des chemins GitHub du manifest

### Fixed

- **Context7** : chemin d’installation corrigé (`external_plugins/context7`)
- **Chrome MCP** : `marketplace.install` ne bloque plus si le port debug 9222 n’est pas prêt
- Démarrage Chrome : détection Linux améliorée (`google-chrome-stable`, `chromium`) + erreurs spawn async

### Tests

- Suite CI : **1048** tests unitaires/intégration

## [3.3.1-EE4.4] - 2026-06-24

### Added

- Marketplace unifiée **curated strict** (Skills + MCP + Plugins) dans l’onglet Extensions
- `catalog/manifest.json` : whitelist vérifiée avec résolution builtin, preset, MCP Registry et GitHub
- Backend marketplace : agrégateur, install resolver, store des extensions installées
- Mise à jour OTA du catalogue avec indicateur source remote/bundled
- Validation CI du manifest catalogue

### Changed

- Onglet Settings **Extensions** remplace les anciens onglets Skills / Connectors
- MCP manuel déplacé dans la section avancée (`MarketplaceMcpAdvanced`)

### Removed

- Scrape Anthropic legacy (`PluginCatalogService`) et installation via Claude CLI
- Handlers IPC `plugins.listCatalog` / `plugins.install`
- Composants UI legacy `SettingsSkills` / `SettingsConnectors`
- Clés i18n orphelines `skills.plugin*` (22 clés × 11 locales)

### Tests

- Suite CI : **1035** tests unitaires/intégration
- Tests de validation `catalog/manifest.json`

## [3.3.1-EE4.3] - 2026-06-24

### Changed

- Refactor (god-file cleanup phases 2–6, sans changement de comportement prévu) :
  - **Phase 2** : `session-manager`, `agent-runner-run`, `vision.ts`, `mcp-manager`
  - **Phase 3** : facade `mcp-manager`, `vision-workflows`, `agent-runner-pi-setup`, `stream-handler`, `session-manager-facade-support`
  - **Phase 4** : `agent-runner-stream-events`, `vision-workflows-plan`, `mcp-tool-registry`, `useApiConfigState`
  - **Phase 5** : `use-api-config-state-hook`, `memory-service`, `software-dev-server-example` (+ modules `mcp/software-dev/*`, `memory-service-*`, `api-config-*`)
  - **Phase 6** : `gui-runtime`, `mcp-server` software-dev, `api-config-persist-actions`

### Tests

- Suite CI : **1043** tests unitaires/intégration
- Mocks MCP reconnect et inspections mémoire alignés sur les nouveaux modules

## [3.3.1-EE4.2] - 2026-06-24

### Changed

- Refactor : découpage de `index.ts` en modules (window, IPC, lifecycle) — 2914 → ~230 lignes
- Refactor : découpage de `gui-operate-server.ts` en 11 modules sous `mcp/gui-operate/` — 6884 → ~24 lignes (entry)
- Refactor : suite du découpage `agent-runner.ts` — 2520 → ~265 lignes (`run`, skills, MCP bridge, PATH, events)

## [3.3.1-EE4.1] - 2026-06-23

### Added

- Tests unitaires pour les modules `agent-runner` extraits (30 tests : `pi-session`, `sandbox-bootstrap`, `history`)
- Sync sandbox incrémental WSL/Lima : pull host→sandbox à la réutilisation de session, skip export si fichier inchangé
- Découpage de `config-store` en modules (`config-schema`, `config-normalizer`, `config-provider-runtime`)

### Changed

- Branding : logo unifié et identité Electron corrigée sur Windows (icônes tray, génération automatique)

### Fixed

- Handoff de session : bootstrap UI corrigé, alias `/handsoff` accepté
- Test flaky `recent-workspace-files` : timestamps explicites via `fs.utimes` au lieu de `setTimeout`

## [3.3.1-EE4] - 2026-06-23

### Added

- Autocomplétion des commandes slash (`/`) dans le champ de prompt
- `README_en.md` et logo Lygodactylus

### Changed

- Refactor : découpage de `agent-runner.ts` en 3 modules (`history`, `sandbox-bootstrap`, `pi-session`)
- Documentation : suppression de `README_zh.md`

### Fixed

- CI : Codex PR Review ignoré si aucune clé API n'est configurée

## [3.3.0] - 2026-04-18

First stable release of the 3.3.x series. Graduated from 9 beta releases with 30+ commits since beta.9.

### Added

- Pairing mode UI guidance and approval panel for Feishu remote control (#109)
- Official project website with VitePress (#122)
- Codex-powered PR review bot with GPT-5.3-codex (#94)
- Codex issue auto-response workflow (#95)
- Platform-based issue auto-assignment (#96)
- ROADMAP.md with versioned planning (v3.4.0+)
- SEO optimizations — llms.txt, social preview, FAQ
- Dependency management policy in CONTRIBUTING.md

### Fixed

- Feishu DM policy now correctly syncs to gateway auth mode (#107)
- Feishu WebSocket connection failures (#93, #105)
- Screenshot tool results display as images instead of bloating text context (#135, #124)
- GUI tool-result image deduplication via content hashing
- Gemini and other providers: empty probe response handling (#88)
- Model probe error causes now preserved in diagnostics (#121)
- MCP: prefer system npx on Windows (#120)
- Security: zip-slip and path traversal hardening (#139)
- Dark/light theme switching on website
- Outdated model fallbacks updated to current versions (claude-sonnet-4-6, gemini-3-flash-preview, gpt-5.4-mini)

### Changed

- OpenAI model presets updated: gpt-5.4-mini, gpt-5.4-nano, o4-mini (replaced retired gpt-4.1)
- CI: platform builds moved to release-only, smoke tests added
- Dependabot: grouped CI actions, separated production patch/minor, ignored Electron major

### Removed

- Unused credentials store module and Keychain integration (eliminated macOS Keychain popup on startup)

### Contributors

- [@hqhq1025](https://github.com/hqhq1025)
- [@Sun-sunshine06](https://github.com/Sun-sunshine06)
- [@JackXFan](https://github.com/JackXFan)
- [@andoan16](https://github.com/andoan16)

## [3.3.0-beta.8] - 2026-03-29

### Added

- Build verification and post-install reliability checks for Windows and macOS installers
- ~100 test files with coverage thresholds enforced in CI pipeline

### Fixed

- 8 critical + 10 high security findings from Round 3 security audit
- 20 medium-severity hardening fixes across sandbox and MCP modules
- VM sandbox security against command injection and symlink attacks (WSL2 & Lima)
- MCP server staging and lifecycle issues for external tool integration
- Skills ENOTDIR error when built-in skills (PPTX, DOCX, PDF, XLSX) symlink into .asar archive
- Remote gateway null check in `loadPairedUsers` for Feishu/Slack integration
- Scrypt `maxmem` parameter for startup key derivation performance
- CI pipeline stabilization for cross-platform builds

## [3.2.0] - 2026-03-02

### Added

- GUI automation support for Windows desktop applications (computer use with WeChat workflow)
- Drag-and-drop file and image attachments with bubble layout in chat interface

### Changed

- Updated Lygodactylus app icons for Windows and macOS packaging (branding refresh)
- Widened chat content area layout for better readability

### Fixed

- Improved `key_press` robustness for GUI automation on Windows and macOS

## [3.1.0] - 2026-02-13

### Added

- Full V2 plugin runtime and management system for custom MCP connectors
- Demo videos showcasing file organization, PPTX generation, XLSX creation, and GUI operation

### Fixed

- Custom Anthropic API timeout handling for Claude model requests
- Agent runner `sdkPlugins` runtime ReferenceError in multi-model configurations
- Hardcoded Chinese text removed from config modal and titlebar (full English/Chinese localization)
- Sensitive log redaction hardened for API keys and credentials
- Packaged app version alignment to 3.0.0 for consistent update detection

## [3.0.0] - 2026-02-08

### Changed

- **Breaking**: Removed proxy layer — all AI model requests now go through Claude Agent SDK directly
- Architecture redesigned to SDK-first approach for better multi-model support (Claude, OpenAI, Gemini, DeepSeek)

### Fixed

- GUI dock click targeting and verification gating for macOS computer use

## [2.0.0] - 2026-01-25

### Changed

- Major architecture overhaul: Electron-based desktop app with React UI, sandbox isolation, and Skills system

## [1.0.0] - 2025-12-01

### Added

- Initial release of Lygodactylus — open-source AI agent desktop app with one-click install for Windows and macOS

[Unreleased]: https://github.com/Emilien-Etadam/lygodactylus/compare/v5.8.1...HEAD
[5.8.1]: https://github.com/Emilien-Etadam/lygodactylus/compare/v5.8.0...v5.8.1
[5.8.0]: https://github.com/Emilien-Etadam/lygodactylus/compare/v5.7.0...v5.8.0
[5.7.0]: https://github.com/Emilien-Etadam/lygodactylus/compare/v5.3.0...v5.7.0
[5.5.0]: https://github.com/Emilien-Etadam/lygodactylus/compare/v5.4.0...v5.5.0
[5.4.0]: https://github.com/Emilien-Etadam/lygodactylus/compare/v5.3.0...v5.4.0
[5.3.0]: https://github.com/Emilien-Etadam/lygodactylus/compare/v5.1.0...v5.3.0
[5.1.0]: https://github.com/Emilien-Etadam/lygodactylus/releases/tag/v5.1.0
[5.0.0]: https://github.com/Emilien-Etadam/lygodactylus/releases/tag/v5.0.0
