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
