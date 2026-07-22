# Règles communes Cursor — canonique

> Fichier de référence pour TOUS les prompts Cursor du projet. Chaque prompt
> commence par « LIRE D'ABORD : docs/cursor-rules-communes.md » — ce fichier
> remplace l'ancien bloc « Règles communes » collé à la main (lots 1–3).
> Un agent qui exécute un prompt sans avoir appliqué ces règles livre une
> branche non conforme.

## Contexte projet (à lire avant de coder)

- App : **Lygodactylus**, agent IA desktop Electron + Vite + React + TypeScript
  strict, **100 % local** (endpoints OpenAI-compatible / Anthropic-compatible,
  Ollama/vLLM/llama.cpp, modèles Qwen etc.).
- Agent basé sur `@earendil-works/pi-ai` / `pi-coding-agent`. Outils natifs
  déclarés en TypeBox (schémas **PLATS**, compat LiteLLM→vLLM→Qwen — ne pas
  introduire de schémas imbriqués exotiques).
- Tests : vitest (`src/tests/**` + `tests/`), ~1580 tests existants doivent
  rester verts.
- i18n : TOUTE chaîne UI nouvelle doit être ajoutée dans **LES 12 fichiers**
  `src/renderer/i18n/locales/{fr,en,zh,es,de,it,uk,pl,sv,no,nl,ro}.json` ;
  chaînes backend (erreurs/dialogues) dans `src/main/i18n/catalog.ts` (`mt()`).
- Style : suivre l'existant (ESLint/Prettier du repo). Commits en français,
  style conventionnel (`feat/fix/docs(scope): …`), comme l'historique git.

## Règles strictes

- Crée une branche dédiée `cursor/<slug>` **depuis main à jour**. Ne touche
  PAS aux autres branches.
- AUCUNE nouvelle dépendance npm sans justification écrite dans la description
  du commit — y compris les dépendances *transitives déjà présentes* : tout
  import d'un module npm doit être **déclaré** dans package.json (leçon #146).
- Ne refactore RIEN d'autre que ce qui est demandé. Pas de renommages
  opportunistes.
- Ne modifie pas ROADMAP.md, CHANGELOG.md ni la config CI.
- Toute nouvelle capacité doit être **optionnelle** et dégrader proprement
  (fallback silencieux vers le comportement actuel).
- Avant de terminer : `npm run typecheck` puis `npm run lint` (0 erreur,
  warnings pré-existants seulement) puis `npx vitest run` → tout vert.
- Termine par un résumé : fichiers modifiés, choix faits, hors périmètre,
  décompte de tests.

## Leçons des lots 1–3 (à respecter partout)

- **Valeurs par session lues en live** au moment de l'exécution — jamais
  figées à la préparation (leçon #149 : autonomie gelée dans une closure).
- **realpath** pour tout containment de chemins (leçon #147) ; symlinks
  jamais suivis dans un parcours de hash/scan.
- Nouveaux canaux desktop **hors** `src/shared/client-event-allowlist.ts`,
  sauf besoin LAN explicite — et stub no-op dans
  `src/renderer/web-bridge/install.ts` pour l'UI distante `/app/`.
- **Préfixe système constant** (KV-cache vLLM) : aucune valeur variable
  (timestamp, aléa) dans les prompts système ; tri déterministe des listes
  qui y entrent.
- **Fail-closed** pour toute fonctionnalité de sécurité (PII, checksums) :
  en cas d'erreur interne, bloquer l'action plutôt que l'exécuter dégradée.
- Téléchargements : contenu **vérifié (sha256) avant toute exécution**,
  `.part` → rename atomique, épinglage par version/digest immuable — pas de
  résolution flottante au runtime.
- Process externes : `spawn` en **args array strict**, jamais d'interpolation
  shell ; chemins passés par variables d'environnement dans PowerShell.
- Fichiers temporaires : nettoyés en `finally` (succès, échec ET annulation).
- Un merge ne doit JAMAIS commiter de marqueurs de conflit — en cas de
  conflit avec main, rebaser et résoudre proprement.

## Livraison

PR draft avec : résumé, tableau des choix faits, hors périmètre,
vérifications (`typecheck` / `lint` / décompte `vitest`). La revue se fait
par Claude sur la branche ; corrections éventuelles demandées via l'auteur.
