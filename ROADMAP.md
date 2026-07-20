# 🗺️ Lygodactylus Roadmap

> Development direction for the [Emilien-Etadam/lygodactylus](https://github.com/Emilien-Etadam/lygodactylus) fork (alpha series **v5.x**; legacy `3.3.1-EE*` archived).
> For feature requests and discussion, see [GitHub Issues](https://github.com/Emilien-Etadam/lygodactylus/issues).

## ✅ Completed

### Upstream baseline (3.3.x)

- **Core**: Stable Windows & macOS installers with build verification
- **Security**: Full filesystem sandboxing + path traversal / zip-slip hardening
- **VM Sandbox**: WSL2 (Windows) and Lima (macOS) VM-level isolation
- **Skills**: PPTX, DOCX, PDF, XLSX support + custom skill management + hot-reload
- **MCP Connectors**: Custom connector support (stdio / SSE / Streamable HTTP)
- **Rich Input**: File upload and image input in chat
- **Multi-Model**: Claude, GPT, Gemini, DeepSeek, Qwen, GLM, Kimi, Grok, MiniMax, Ollama
- **UI/UX**: Enhanced interface with English/Chinese localization
- **Remote Control**: ~~Feishu (Lark) bot integration~~ — **supprimé** en post-EE4.91 (#40, #41) ; remplacé par chat LAN (#44)
- **CI/CD**: Automated builds, smoke tests, Codex-powered PR review bot
- **Model Presets**: Up-to-date model catalogs for all major providers
- **Dependency Policy**: Tiered management strategy with Dependabot grouping
- **Memory System Foundation**: Unified storage with core/experience memory and source-aware retrieval workflow

### EE fork (`3.3.1-EE1` → `3.3.1-EE4.98`)

- **EE4.98** (release) : rebranding complet **Lygodactylus** (`com.lygodactylus.app`)
- **EE4.97** (release) : compaction proactive contexte plein ; fork/édition prompt sur messages utilisateur ; barre contexte sidebar uniquement (#47, #48)
- **EE4.96** (release) : fix chat streaming en direct (multicast IPC preload — listener plugin n’écrase plus `useIPC`) ; barre de contexte au-dessus de la zone de saisie (#45)
- **EE4.95** (release) : fix auto-update Windows — `latest.yml` aligné sur `Lygodactylus-*.exe`, erreur téléchargement affichée dans Paramètres
- **EE4.94** (release) : fix Chat LAN « UI missing » — `resources/chat-lan` dans extraResources Windows/macOS/Linux
- **EE4.93** (release) : fix UI mises à jour Windows — téléchargement auto + bouton installer
- **EE4.92** (release publiée, Latest) :
  - **Chat LAN** : serveur web local, UI `resources/chat-lan/`, onglet Paramètres (#44)
  - **Config API** : deux fournisseurs (OpenAI-compatible + Anthropic-compatible), migration auto (#42)
  - **Suppression** Feishu (#40) et module contrôle à distance complet (#41)
  - App allégée (~7k lignes remote retirées, `@larksuiteoapi/node-sdk` supprimé)
- **EE4.91** :
  - Hotfix bouton « Vérifier les mises à jour » (`Cannot set properties of undefined (setting 'allowPrerelease')`)
  - Chargement `electron-updater` via `createRequire` (interop CJS — `autoUpdater` absent en `import()` ESM)
  - Repli API GitHub Releases si `electron-updater` indisponible (macOS/Linux + secours Windows)
  - `allowPrerelease = false` pour ignorer les releases draft/prerelease sur le feed GitHub
- **EE4.9** :
  - Fix blocage chat infini « Traitement… » (timeout `preparePiSessionRun` / `resourceLoader.reload`, cycle `activeTurn`, reset sessions `running` orphelines)
  - Commandes slash : rejet des inconnues, normalisation `/plugin:cmd` → `/cmd`
  - CI release débloquée (test `session-manager-crud`)
- **EE4.8** : bouton vérification mises à jour, mêmes correctifs chat/slash (supersédé par EE4.9)
- **EE4.7** : menu slash fond opaque (fix transparence sur l'historique)
- **EE4.6** : auto-update Windows, commandes plugin dans le menu `/`

- **EE4**: Slash command autocomplete, `README_en.md`, logo, first `agent-runner` module split
- **EE4.1**: Incremental WSL/Lima sandbox sync, `config-store` split, session handoff + `/handsoff`, unified Windows branding, 30 `agent-runner` unit tests
- **EE4.2**: Major structural refactors (no intended user-facing behaviour change):
  - `index.ts` → ~230 lines (`main-app-*`, `ipc/*`)
  - `gui-operate-server.ts` → entry + `mcp/gui-operate/*` (11 modules)
  - `agent-runner.ts` → ~265 lines (`agent-runner-run`, skills, MCP bridge, PATH, events)
- **EE4.3**: God-file cleanup phases 2–6 — `session-manager`, `mcp-manager`, `memory-service`, software-dev MCP, API config hooks (1043 tests)
- **EE4.4**: Marketplace curated unifiée (Skills/MCP/Plugins), nettoyage legacy Anthropic + Claude CLI, validation CI du catalogue (1035 tests)
- **EE4.5**: Catalogue 21 entrées, fix Context7/Chrome MCP marketplace install (1048 tests)
- **God-file cleanup (phase 1)**: `index.ts`, `gui-operate-server.ts`, `agent-runner.ts`, `config-store.ts` — done
- **God-file cleanup (phase 2)**: `agent-runner-run.ts`, `gui-operate/vision.ts`, `mcp-manager.ts`, `session-manager.ts` — done (2026-06-24)
- **God-file cleanup (phase 3)**: `mcp-manager` facade (~363), `vision-workflows`, `agent-runner-pi-setup`, `stream-handler`, `session-manager-facade-support` — done (2026-06-24)
- **God-file cleanup (phase 4)**: `agent-runner-stream-events`, `vision-workflows-plan`, `mcp-tool-registry`, `useApiConfigState` — done (2026-06-24)
- **God-file cleanup (phase 5)**: `use-api-config-state-hook` (~345), `software-dev-server-example` (entry ~24 + `mcp/software-dev/*`), `memory-service` (~201) — done (2026-06-24)
- **God-file cleanup (phase 6)**: `gui-runtime` (facade ~19), `mcp-server` software-dev (~82), `api-config-persist-actions` (~65) — done (2026-06-24)
- **Test coverage**: 1043+ unit/integration tests in CI

## 📦 Releases

| Tag             | Date       | Highlights                                                                    |
| --------------- | ---------- | ----------------------------------------------------------------------------- |
| `v6.0.2`        | 2026-07-08 | **Latest** — fix bash WSL timeout (CRLF + proxy non bloquant) |
| `v6.0.1`        | 2026-07-08 | fix bash sandbox WSL (`EADDRNOTAVAIL` proxy LAN) |
| `v6.0.0`        | 2026-07-07 | Série v6 local-first, Electron 43, migration config one-shot, sans SDK cloud directs |
| `v5.9.0`        | 2026-07-01 | marketplace skills GitHub, extension Firefox web-action |
| `v5.8.1`        | 2026-06-28 | fix timeout chat (vLLM distant + mémoire), sidebars plus étroites |
| `v5.8.0`        | 2026-06-28 | Sandbox LAN network (http_request, proxy opt-in), repo app-only cleanup |
| `v5.7.0`        | 2026-06-28 | Tool Completeness (glob/grep/web/todo/ask), LiteLLM/Qwen schemas |
| `v5.6.0`        | 2026-06-28 | memory UX + injection controls, Linux AppImage CI releases                    |
| `v5.5.0`        | 2026-06-28 | naming standardization (paths agent, sandbox, Lima)                           |
| `v5.4.0`        | 2026-06-28 | skills split on-demand (docx/pptx), lazy-load SDKs, ~2.7 MB installer savings |
| `v5.3.0`        | 2026-06-28 | slimming on-demand (Node, Python, cliclick), 1086 tests                       |
| `v5.1.0`        | 2026-06-27 | Hardening v5 (phases 0–3), pi-agent 0.80.2, Node 22.19, slimming quick wins   |
| `v5.0.0`        | 2026-06-27 | logo gecko Lygodactylus, série v5, rebranding complet                         |
| `v3.3.1-EE4.98` | 2026-06-26 | rebranding Lygodactylus                                                       |
| `v3.3.1-EE4.97` | 2026-06-25 | compaction proactive, fork/édition prompt, barre contexte sidebar             |
| `v3.3.1-EE4.96` | 2026-06-25 | Fix chat streaming + barre de contexte au-dessus de l’input                   |
| `v3.3.1-EE4.95` | 2026-06-25 | Fix auto-update Windows (`latest.yml` + nom installateur)                     |
| `v3.3.1-EE4.94` | 2026-06-25 | Fix Chat LAN UI missing (extraResources)                                      |
| `v3.3.1-EE4.93` | 2026-06-25 | Fix auto-update Windows (download + bouton installer)                         |
| `v3.3.1-EE4.92` | 2026-06-25 | Chat LAN, 2 providers API, suppression remote/Feishu                          |
| `v3.3.1-EE4.91` | 2026-06-25 | Hotfix vérification mises à jour, `createRequire`, GitHub API                 |
| `v3.3.1-EE4.9`  | 2026-06-25 | Fix chat « Traitement… », slash plugin, CI release                            |
| `v3.3.1-EE4.8`  | 2026-06-25 | Mises à jour EE4.8, fix chat bloqué, slash plugin (non publiée — draft)       |
| `v3.3.1-EE4.7`  | 2026-06-25 | Fix fond opaque menu slash                                                    |
| `v3.3.1-EE4.6`  | 2026-06-25 | Auto-update Windows, commandes plugin menu `/`                                |
| `v3.3.1-EE4.5`  | 2026-06-24 | Catalogue 21 entrées, fix Context7 + Chrome MCP, 1048 tests                   |
| `v3.3.1-EE4.4`  | 2026-06-24 | Marketplace curated, cleanup legacy plugins, 1035 tests                       |
| `v3.3.1-EE4.3`  | 2026-06-24 | God-file cleanup phases 2–6, 1043 tests                                       |
| `v3.3.1-EE4.2`  | 2026-06-24 | Refactor `index.ts`, `gui-operate`, `agent-runner`                            |
| `v3.3.1-EE4.1`  | 2026-06-23 | Sandbox sync, config-store, handoff, branding                                 |
| `v3.3.1-EE4`    | 2026-06-23 | Slash autocomplete, agent-runner split (phase 1)                              |
| `v3.3.1-EE3.x`  | 2026-06    | Security, WSL sandbox, Windows perf, pi-agent migration                       |

Current stable fork baseline: **`6.0.2`** — [CHANGELOG](CHANGELOG.md)

### v5.x hardening

- **Encrypted stores**: MCP credentials + Chat LAN token aligned with machine-bound encryption (`app-store` helper)
- **Dead code removal**: legacy per-skill MCP process stubs removed (MCP via marketplace / `mcp-config-store` only)
- **Docs**: SECURITY.md, README, ROADMAP updated for v5 support policy
- **Phase 1**: macOS sandbox default, IPC allowlist in main process, Chat LAN hardening (Bearer SSE, security headers)
- **Phase 2**: extracted `command-sandbox-validation`, `skills-frontmatter`, `use-ipc-stream-batching`; expanded tool-executor tests; CI coverage floor 40%
- **Phase 3**: migration `@earendil-works/pi-ai` / `@earendil-works/pi-coding-agent` ^0.80.2 (0 CVE runtime), compat entrypoint for legacy API, DeepSeek V4 thinking patch ported
- **v5.1 prep**: Node `>=22.19.0`, installer slimming (@img removed, MCP minify, locales win/linux), legacy rename `src/main/claude/` → `src/main/agent/`, `pi-ai-one-shot`, `AgentRunner`
- **v5.5 naming**: `userData/skills`, `lygodactylus-sandbox`, `~/.lygodactylus/sandbox`, sync manifest Lygodactylus
- **Validation v5.1.0** (2026-06-27) : smoke tests Chat LAN, migration config deux fournisseurs, régression chat/slash/auto-update — validés

## 📋 Planned

### Near-term (v5.2+)

- **Sandbox Hardening**: VM sandbox reliability, startup performance, cross-platform consistency (Lima, WSL2); incremental sync follow-ups
- **App Slimming**: Node.js on-demand — **done v5.2**; Python + cliclick on-demand — **done v5.3**; skills split (docx/pptx on-demand) — **done v5.4**; naming cleanup — **done v5.5**
- **Schema naming**: `claude_session_id`, `claudeCodePath` → `agent_session_id`, `agentCliPath` — **done v5.5** (migration auto, champs legacy conservés en lecture)
- **Tool Completeness**: Native TodoWrite, AskUserQuestion, Glob, Grep, WebFetch, WebSearch tool schemas + handlers for API key users — **done v5.7**
- **Memory System Enhancements**: Prompt injection controls, cross-session retrieval UX, memory source inspection, reranking quality — **done v5.6**
- **Memory Freshness & Confidence**: recency-decay term in `memory-ranker.ts` (demi-vie 30 j, plancher 0.35, timestamps existants) + champ `confidence` optionnel pris en compte au ranking — inspiré du "confidence tracking + freshness decay" de moltagent. — **done** (PR #133)
- **Scheduled Tasks**: Cron-like scheduling with UI management (backend exists; polish UX and edge cases)
- **Log Management**: Structured logging with rotation, size limits, log viewer improvements
- **Installation Experience**: Smoother first-run — auto-detect dependencies, clearer errors, one-click setup
- **Linux Support**: First-class Linux builds — **done v5.6** (AppImage CI release; deb/rpm later)
- **Model Location Picker (UX)**: sélecteur clair de *où* tourne chaque modèle (local vs machine distante via Chat LAN) — version allégée du « compute location as control plane » de LM Studio Bionic, sans cloud. UX polish, pas un sous-système. — _candidate_
- **Skill Lockfile & Pinning**: enregistrer à l'install le commit sha résolu + un hash d'intégrité dans `marketplace-installed-store` (aujourd'hui : install à un `ref` de catalogue, sans lockfile). Reproductibilité, détection/rollback de dérive, et sécurité supply-chain (un skill exécute du code dans le sandbox). Inspiré du `skills.lock` de trivium ; extension du store existant, pas un sous-système. — **→ lot 3**
- **Chat Organization**: groupes/dossiers de chats par projet + **sous-chats** (brancher une discussion annexe sans polluer le contexte principal) — UX locale self-contained, prolonge le fork/édition de messages existant. Inspiré d'Atlantis (roia.io). — _candidate_

### Lot veille 2026-07 — ✅ livré (PRs #131–#139)

_Issu d'une veille (moltagent, LM Studio Bionic, trivium, Atlantis, Jan/Cline/Aider/Khoj/llama.cpp…). Prompts : `docs/cursor-prompts-veille-2026-07.md` ; codé par Cursor, revu par Claude._

- **Constrained Output (grammar / JSON-schema)**: sonde de capacités par endpoint (Ollama `format`, vLLM/llama.cpp `response_format.json_schema`) + injection `onPayload` sur les one-shots JSON internes, cache invalidé sur changement URL/modèle, retry sans champ. Tool-call guard conservé en filet. — **done** (PR #137)
- **Global Quick-Ask Launcher**: hotkey global + fenêtre frameless lecture-seule (session `mode: 'plan'`), même preload/allowlist que la fenêtre principale, « Ouvrir dans l'app ». Phase 1 (sans capture de sélection). — **done** (PR #136)
- **Read-Aloud (TTS)**: lecture vocale offline via `speechSynthesis` (zéro dépendance), markdown « parlable », OFF par défaut. — **done** (PR #131)
- **Plan/Act Mode**: mode par session persisté, gating allowlist en un point unique + `excludeTools` SDK, MCP bloqués en plan, garde backend pendant un run. — **done** (PR #135)
- **Local Inference Latency**: préfixe système déterministe (tris skills/MCP/mémoire core) pour le prefix caching vLLM/llama.cpp + `keep_alive` et warm-up Ollama. — **done** (PR #134)
- **Local Reranker (mémoire)**: client `POST /v1/rerank` opt-in (OFF), branché sur recherche **et** injection, fallback ordre d'origine, fraîcheur/confiance multiplicatifs par-dessus. — **done** (PR #138)
- _Suivi_ : nettoyage code miroir / prompts / test tautologique — **done** (PR #139)

### 2e lot veille — ✅ livré (PRs #141–#149)

_Prompts Cursor : `docs/cursor-prompts-lot2-2026-07.md` (workflow : Cursor code, Claude vérifie)._

- **Live Model Stats**: tok/s côté client (deltas de stream), % contexte, méta params/quant Ollama via `/api/show` caché — zéro requête pendant la génération. — **done** (PR #141)
- **Global Conversation Search**: index FTS5 (repli LIKE), sync à tous les points d'écriture DB (y compris rewind/fork), backfill idempotent, IPC desktop-only. — **done** (PR #142)
- **Project Rules File (AGENTS.md)**: composition avec le chargement natif du SDK (préséance `AGENTS.md` > `.rules` > `CLAUDE.md`, dédup racine, cas sandbox), plafond 32 Ko UTF-8-safe, indicateur UI. — **done** (PR #143)
- **Prompt / Persona Presets**: bibliothèque locale `{{var}}` + `{date}`/`{os}`, `/preset` avec picker, rejet côté main sur les surfaces sans picker. — **done** (PR #144)
- **Inline Citations UI**: index `Source index:` dans les tool results web, numérotation monotone par session, carte Sources + linkification `[n]` défensive. — **done** (PR #145)
- **Semantic File Search**: outil `semantic_search` opt-in (gate embeddings), index SQLite par workspace, chokidar incrémental, containment realpath, rerank composé. — **done** (PR #146)
- **@-mention Context Attach**: `@fichier`/`@dossier`/`@url` avec autocomplétion, résolution main-side (64 Ko, realpath-safe), préfixe modèle ok-only. — **done** (PR #147)
- **Autonomy / Safety Modes**: checkpoints par pré-images (write/edit exacts via wrap des outils SDK, bash best-effort chokidar, « Annuler ce run » gardé) + sélecteur Prudent/Normal/Autonome par session (diff-approve via le flux permissions, boucle auto-fix lint/test max 3, autonomie lue en live). — **done** (PRs #148, #149)
- **Artifacts / Canvas Panel**: preview live HTML/SVG/code en panneau latéral + sélecteur de versions (Mermaid = quick win) ; iframe sandbox, exécution possible dans le sandbox existant. — _candidate_ (plus gros, à cadrer)
- **PII Scrub (outbound)**: détection + tokenisation réversible des données perso avant `web_search`/`web_fetch`/`http_request`/MCP, restauration en réponse. Lib JS/WASM ou sidecar Presidio. — _candidate_ (à cadrer)
- **Content Watch + Proactive Digest**: watchers dossier/RSS/URL (mode diff) résumant seulement le nouveau contenu, surfacé en digest ; étend le cron existant. — _candidate_ (à cadrer)

_Écartés volontairement par le mainteneur : RAG « chat avec mes docs » (risque d'usine à gaz) et compare multi-modèles côte à côte._

- **Cleanup post-lot 2**: dédup `path-safety` (#146/#147), linkification citations hors blocs de code (#145), `void offset` (#142). — **done** (PR #151)

### 3e lot veille — en cours (2026-07)

_Prompts Cursor : `docs/cursor-prompts-lot3-2026-07.md`. Regroupe les candidates restantes des analyses projet (trivium, Atlantis, Bionic) et du cadrage lot 2, + la phase 2 du Quick-Ask._

- **Model Location Picker** — badge local/LAN/distant dans le sélecteur de modèle. — **done** (PR #153)
- **Skill Lockfile & Pinning** — sha épinglé + hash d'intégrité à l'install (trivium). — **done** (PR #154)
- **Chat Organization** — dossiers repliables + sous-chats via le fork existant (Atlantis). — **done** (PR #155)
- **Quick-Ask phase 2** — actions sur le presse-papier (résumer/traduire/reformuler), 2e hotkey. — **done** (PR #157)
- **Content Watch + Digest** — watchers dossier/RSS/URL sur le cron existant, diff #149, session Veille en mode plan. — **done** (PR #158)
- **PII Scrub sortant** — jetons réversibles par règles (email/tél/IBAN/Luhn + termes custom), fail-closed, opt-in. — **done** (PR #159)
- **Artifacts / Canvas** — aperçu iframe sandboxée (html/svg, CSP no-network), versions. Mermaid exclu (dépendance). — **done** (PR #161)
- **Local STT (dictée)** — whisper.cpp on-demand (pattern runtimes v5.3), push-to-talk, transcription au release. — _planned_

### Mid-term (v3.5.0+)

- **Plugin System**: Extensible architecture for community-built integrations
- **Multi-Agent**: Orchestrate multiple agents for complex workflows
- **Workspace Templates**: Pre-configured environments for common use cases (coding, writing, research) — peut inclure des **environnements de skills nommés** (bascule entre jeux de skills) ; réf. design : trivium (install épinglée + switch d'environnements)

### Long-term

- **Computer Use (CUA)**: GUI automation via screen capture and mouse/keyboard control (GUI MCP server already provides foundation)
- **Collaborative Mode**: Multiple users sharing a workspace
- **Mobile Companion**: Lightweight mobile app for monitoring and quick interactions — **first step done**: the Chat LAN web UI is now an installable PWA (QR pairing, Android home-screen install, SSE auto-reconnect, reverse-proxy/HTTPS support); a richer client may follow
- **Local Voice Input (STT)**: clavier vocal 100% local — voice-to-text on-device via un modèle embarqué (ex. whisper.cpp / faster-whisper), push-to-talk vers la zone de saisie du chat. Surfacé par la transcription locale de LM Studio Bionic ; seule capacité purement locale qui manque aujourd'hui. Ajout de feature (capture audio + modèle local) : évaluer le périmètre avant de s'engager. — _candidate_
- **Remote Access — option Tailscale**: chemin d'accès distant type LM Link (Tailscale, chiffré E2E) en complément de Chat LAN + WireGuard, pour réduire la friction d'appairage. Variante à étudier : relais **zero-knowledge** app-level (Curve25519 + ChaCha20Poly1305, façon Atlantis) pour un accès via Internet **sans VPN**, le relais ne voyant que du chiffré. À surveiller/documenter, pas à reconstruire. — _candidate_

---

_Last updated: 2026-07-20 (lot 3 : 7/8 mergés — #153, #154, #155, #157, #158, #159 PII, #161 canvas ; reste local-stt ; prompts dans docs/cursor-prompts-lot3-2026-07.md)_
