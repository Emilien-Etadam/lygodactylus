# Prompts Cursor — Maintenance SDK pi

> Procédure réutilisable pour les bumps `@earendil-works/pi-ai` /
> `pi-coding-agent`. Ordre : **M1 une seule fois** (le harnais), puis **M2 à
> chaque bump**. Mode autonome : chaque prompt commence par la référence aux
> règles communes.

---

## Prompt M1 — Harnais « contrat SDK »  `cursor/sdk-contract-harness`

```text
LIRE D'ABORD (OBLIGATOIRE) : docs/cursor-rules-communes.md.

TÂCHE : Créer src/tests/sdk-contract/ — un harnais de tests qui verrouille
CHAQUE point de contact de l'app avec le SDK pi. Objectif : avant un bump le
harnais est vert (baseline) ; après un bump, ses échecs listent EXACTEMENT ce
qui a changé. AUCUN changement de code produit — tests uniquement (déplacer un
test existant est permis si l'original est remplacé par un re-export ou
supprimé proprement).

ÉTAPE 0 — CARTOGRAPHIE (résumer dans la PR) :
Recenser tous les imports `@earendil-works/*` dans src/ (≈32 fichiers) et
classer : imports de TYPES seuls vs imports de VALEURS (runtime). Le harnais
couvre les valeurs ; les types sont couverts par tsc.

SPÉCIFICATION — un fichier par domaine :
1. exports.test.ts : chaque export VALEUR importé par l'app existe et a le
   bon typeof (createWriteToolDefinition, createEditToolDefinition, les
   classes/factories de session et d'agent réellement importées, etc. —
   liste issue de l'étape 0).
2. extension-points.test.ts :
   - resource loader : skillsOverride / agentsFilesOverride acceptés et
     honorés (fixture minimale) ;
   - excludeTools accepté ;
   - customTools : un customTool nommé comme un builtin (ex. bash) REMPLACE
     le builtin (le précédent établi — tester sur la liste d'outils
     effective d'une session préparée) ;
   - StreamOptions.onPayload : présent dans les types ET appelé sur un
     stream mocké si un test léger est possible sans réseau.
3. private-surface.test.ts : `_onPayload` — documenter par un test le
   comportement DÉFENSIF de l'app : si la propriété disparaît du SDK, le
   wrapper Ollama se désactive proprement (mock d'un agent sans _onPayload →
   pas de throw, warn loggé). Ce test protège la dégradation, pas l'API.
4. stable-prefix.test.ts : regrouper/référencer les invariants byte-stables
   dépendants du SDK (prompt système assemblé, buildPiSessionRuntimeSignature)
   — réutiliser les tests existants (déplacement ou import), ne pas dupliquer.
5. patch.test.ts : le patch patches/@earendil-works+pi-ai+*.patch est
   appliqué : vérifier dans node_modules/@earendil-works/pi-ai/dist/api/
   openai-completions.js la présence de `requiresThinkingInContent` (marqueur
   du patch DeepSeek V4). Si le patch est un jour intégré en amont, ce test
   guidera sa suppression.

CONTRAINTE : harnais 100 % offline (mocks/fixtures), rapide (< 5 s), zéro
dépendance nouvelle.

TESTS : le harnais lui-même + la suite complète restent verts (baseline
0.80.3).
```

---

## Prompt M2 — Bump SDK pi (générique, cible à jour dans le titre de la PR)  `cursor/bump-pi-sdk`

```text
LIRE D'ABORD (OBLIGATOIRE) : docs/cursor-rules-communes.md.
PRÉREQUIS : le harnais src/tests/sdk-contract/ existe et est vert sur la
version ACTUELLE avant tout changement (le vérifier, sinon s'arrêter).

TÂCHE : Monter @earendil-works/pi-ai ET pi-coding-agent (TOUJOURS en
lockstep, même version) vers la version cible indiquée au lancement.
Exception explicite aux règles communes : ce prompt PEUT modifier
package.json/package-lock.json (le bump) et patches/ (régénération).

ÉTAPE 0 — OBLIGATOIRE (résumer dans la PR) :
1. Lire le changelog/release notes amont entre la version actuelle et la
   cible ; lister les breaking changes annoncés.
2. Diff des .d.ts (npm pack des deux versions) sur les symboles du harnais.
3. Sort du patch DeepSeek V4 : intégré en amont ? → le supprimer (et adapter
   patch.test.ts). Sinon → le régénérer sur la cible (npx patch-package
   @earendil-works/pi-ai) en vérifiant que la logique reste équivalente.

SPÉCIFICATION :
1. Bump des deux paquets, npm install, patch régénéré/supprimé selon 3.
2. Harnais sdk-contract : chaque échec est soit corrigé dans l'app (en
   suivant le changelog), soit remonté dans la PR si le changement amont est
   ambigu — ne JAMAIS affaiblir un test du harnais pour « faire passer ».
3. Audit : node scripts/audit-runtime.mjs — si la version cible ne bundle
   plus ses node_modules (≥0.81), SUPPRIMER l'entrée GHSA-3JXR-9VMJ-R5CP de
   ALLOWED_UNFIXED (scripts/audit-runtime.mjs) et vérifier que l'audit passe
   sans exception.
4. Suite complète verte ; documenter tout changement de décompte.
5. PR : tableau étape 0 (breaking changes → traitement), sort du patch,
   sort de l'exception d'audit.

TESTS : harnais + suite complète + audit verts. Smoke manuel recommandé
après merge : une session chat réelle sur vLLM (stream, un appel d'outil,
un skill).
```

---

## Prompt M3 — Réparer le keep_alive Ollama via l'API extensions  `cursor/ollama-payload-extension`

```text
LIRE D'ABORD (OBLIGATOIRE) : docs/cursor-rules-communes.md.
PRÉREQUIS : SDK pi ≥ 0.81.1 mergé (M2) et harnais sdk-contract vert.

CONTEXTE : Le harnais M1 a documenté que le wrapper Ollama keep_alive/num_ctx
(agent-runner-pi-session.ts, bloc `_onPayload`) est inopérant : la surface
privée `_onPayload` n'existe plus sur l'agent — l'app warn et skip à chaque
session Ollama. Le SDK 0.81.x fournit le remplaçant OFFICIEL : le système
d'extensions, hook `before_provider_request`.

POINTS D'APPUI VÉRIFIÉS (les lire, ne pas re-découvrir) :
- dist/core/extensions/types.d.ts : `InlineExtension` ({ name, factory,
  hidden? }), `ExtensionAPI.on("before_provider_request", handler)`,
  `BeforeProviderRequestEvent` / `...Result` (formes exactes à relever).
- dist/core/resource-loader.d.ts:70 : `extensionFactories?: InlineExtension[]`
  — MÊME surface d'options que skillsOverride/agentsFilesOverride déjà
  utilisés par l'app (créer le loader avec ce champ en plus).
- dist/core/sdk.js (≈l.200) : le SDK route onPayload →
  runner.emitBeforeProviderRequest — le hook reçoit/retourne le payload.

SPÉCIFICATION :
1. Nouveau module src/main/agent/ollama-payload-extension.ts : fabrique une
   InlineExtension `{ name: 'ollama-payload', hidden: true, factory }` dont le
   handler before_provider_request retourne le payload étendu de
   { num_ctx: <ref mutable>.value, keep_alive: toOllamaKeepAlivePayload(
   normalizeOllamaKeepAlive(configStore.get('ollamaKeepAlive'))) }.
   - keep_alive lu LIVE à CHAQUE requête (jamais figé — règle commune) ;
   - num_ctx via la même référence mutable ollamaNumCtx que l'actuel
     (ctx.piSessions — la compaction la met à jour) ;
   - ne JAMAIS écraser d'autres clés du payload (spread payload d'abord).
2. createPiSession : enregistrer cette extensionFactory dans les options du
   resource loader UNIQUEMENT quand isOllamaEndpoint (même détection
   qu'aujourd'hui). SUPPRIMER intégralement l'ancien bloc `_onPayload`
   (le check, le warn, le wrapper).
3. Non-Ollama : AUCUNE extension enregistrée, payload strictement inchangé.
4. Harnais : remplacer private-surface.test.ts par
   src/tests/sdk-contract/ollama-payload.test.ts :
   - session Ollama (modèle synthétique loopback:11434) → l'extension est
     enregistrée et un before_provider_request mocké/émis produit un payload
     contenant num_ctx et keep_alive, autres clés préservées ;
   - keep_alive reflète un changement de configStore ENTRE deux requêtes
     (lecture live) ;
   - session non-Ollama → extension absente ;
   - plus aucun accès à `_onPayload` nulle part dans src/ (grep en test de
     wiring, comme chat-folders-wiring).
5. Aucun impact prompt/préfixe système (le hook ne touche que la requête
   réseau) — le test stable-prefix doit rester intact.

HORS PÉRIMÈTRE : tout autre usage des extensions, réglages UI nouveaux,
autres providers.

TESTS : harnais + suite complète verts ; documenter le décompte.
```

---

## Prompt M4 — Resync OfficeCLI (skill vendorisé + binaire épinglé)  `cursor/officecli-resync`

```text
LIRE D'ABORD (OBLIGATOIRE) : docs/cursor-rules-communes.md.
PARAMÈTRE AU LANCEMENT : la release amont cible (ex. « v1.0.140 »).

CONTEXTE : catalog/skills/officecli/SKILL.md est vendorisé depuis
iOfficeAI/OfficeCLI (NOTICE.md = provenance). L'amont release quasi
quotidiennement, et son mécanisme d'install est un `curl | bash` FLOTTANT
(https://d.officecli.ai/install.sh) — sans version ni checksum : la doc
vendorisée et le binaire réellement installé divergent avec le temps.
DÉCISION ACTÉE : notre copie épingle le binaire (version + sha256) et les
deux avancent ENSEMBLE à chaque resync. Ce prompt sert pour la
transformation initiale ET pour chaque resync suivant.

ÉTAPE 0 — OBLIGATOIRE (résumer dans la PR) :
1. Télécharger le SKILL.md amont
   (https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/SKILL.md) et
   relever le SHA du commit amont qui le porte. Diff avec notre copie :
   résumer ce qui a changé (commandes, flags, sections).
2. Lister les assets de la release cible (plateformes couvertes ; y a-t-il
   un fichier de checksums fourni ?). Cibles requises : win-x64, mac-arm64,
   mac-x64, linux-x64. Si une plateforme manque → s'arrêter et rapporter.
3. Release notes depuis le dernier resync (NOTICE.md porte la version
   précédente) : signaler tout changement de comportement notable.

SPÉCIFICATION :
1. Re-vendoriser SKILL.md depuis l'amont (verbatim), PUIS appliquer NOTRE
   unique divergence : remplacer la section d'installation `curl | bash` /
   `irm | iex` par le téléchargement des assets GitHub de la release ÉPINGLÉE,
   avec vérification sha256 AVANT toute exécution :
   - checksums repris du fichier de checksums de la release s'il existe,
     sinon calculés depuis les assets téléchargés et FIGÉS dans le SKILL.md ;
   - instructions par plateforme, courtes et actionnables par l'agent
     (curl -fsSL <url release pinnée> + sha256sum -c sous unix ;
     Invoke-WebRequest + Get-FileHash sous Windows) ; échec de checksum →
     supprimer le fichier et s'arrêter (fail-closed) ;
   - AUCUNE autre modification du texte amont.
2. NOTICE.md : date de resync, SHA du commit amont du SKILL.md, version
   binaire épinglée + sha256 par plateforme, et une section
   « Local modifications » décrivant précisément la divergence d'install
   (traçabilité curated-strict).
3. catalog/manifest.json : description de l'entrée mise à jour si elle
   mentionne une version.
4. La validation CI du catalogue et la suite complète restent vertes.

HORS PÉRIMÈTRE : modifier le comportement du skill au-delà de l'install,
bundler le binaire dans l'app, autres skills du catalogue.

TESTS : validation catalogue verte ; si un test verrouille le contenu du
skill vendorisé, l'adapter — sinon en ajouter un LÉGER : le SKILL.md
vendorisé ne contient PLUS `d.officecli.ai` ni `| bash` ni `| iex`, et
contient la version épinglée et des sha256 (40+ hex).
```
