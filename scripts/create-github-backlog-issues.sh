#!/usr/bin/env bash
# Crée le backlog post-v6.0.0 en issues GitHub.
# Prérequis : Issues activées (Settings → General → Features → Issues)
# Usage : ./scripts/create-github-backlog-issues.sh

set -euo pipefail

REPO="${GITHUB_REPOSITORY:-Emilien-Etadam/lygodactylus}"

if ! gh api "repos/${REPO}" --jq .has_issues | grep -q true; then
  echo "Erreur : les Issues sont désactivées sur ${REPO}."
  echo "Activez-les : https://github.com/${REPO}/settings — General → Features → Issues"
  exit 1
fi

create() {
  local title="$1"
  local body="$2"
  shift 2
  gh issue create -R "$REPO" --title "$title" --body "$body" "$@"
}

create "[P1] Fiabilité agent — cœur produit" "$(cat <<'EOF'
## Contexte
Série v6.0.0 livrée (local-first, Electron 43). Priorité produit n°1.

## Tâches
- [ ] Régressions chat : timeouts `preparePiSessionRun`, sessions bloquées « Traitement… »
- [ ] Tool calling LiteLLM → vLLM → Qwen (cas réels avec modèles locaux)
- [ ] Compaction / contexte plein sous charge longue
- [ ] Mémoire + vLLM distant : timeouts et fallback lexical
- [ ] Tests d'intégration sur setup Ollama/vLLM réel (pas seulement loopback CI)

## Critères de done
- Scénarios documentés qui passent sur Ollama et vLLM locaux
- Pas de régression sur les 1135+ tests CI
EOF
)" --label enhancement

create "[P2] Sandbox — fiabilité cross-plateforme" "$(cat <<'EOF'
## Contexte
Différenciateur sécurité du projet (WSL2 / Lima / natif).

## Tâches
- [ ] Fiabilité démarrage WSL2 / Lima (premier run, messages d'erreur clairs)
- [ ] Sync incrémentale workspace → VM (suites ROADMAP)
- [ ] Parité Windows / macOS / Linux (native vs VM)
- [ ] Régressions réseau LAN sandbox (proxy RFC1918, `http_request`)

## Critères de done
- Premier run sandbox documenté par OS
- Tests sandbox existants verts + cas manquants couverts
EOF
)" --label enhancement

create "[P3] Chat LAN + extension Firefox" "$(cat <<'EOF'
## Contexte
Écosystème navigateur (PRs #85–#87, extension signée AMO en CI).

## Tâches
- [ ] Stabiliser `web-action` (401, timeouts, modèles vision locaux)
- [ ] Publication extension AMO (workflow signature)
- [ ] Doc utilisateur : token extension vs token global, usage WireGuard
- [ ] Cas limites : pages longues, streaming, annulation

## Critères de done
- Extension utilisable de bout en bout avec Chat LAN local
- Erreurs 401/timeout explicites côté extension
EOF
)" --label enhancement

create "[P4] Marketplace & skills" "$(cat <<'EOF'
## Contexte
Skills = valeur produit concrète (v5.9+ install GitHub).

## Tâches
- [ ] Enrichir le catalogue curated (skills MIT/Apache)
- [ ] Fiabiliser install / update / uninstall skills GitHub
- [ ] Guide « publier un skill » pour contributeurs
- [ ] Validation CI catalogue (éviter échecs hors réseau en dev local)

## Critères de done
- Catalogue validé en CI de façon fiable
- Au moins 3 nouvelles entrées curated documentées
EOF
)" --label enhancement

create "[P5] Tâches planifiées — polish" "$(cat <<'EOF'
## Contexte
Backend `ScheduledTaskManager` existant ; UI et edge cases incomplets.

## Tâches
- [ ] Edge cases : timezone, échec silencieux, retry
- [ ] Notification / log quand une tâche planifiée échoue
- [ ] Tests sessions orphelines liées aux tâches planifiées

## Critères de done
- Échec de tâche visible dans les logs et/ou l'UI
- Tests couvrant au moins un cycle échec → retry
EOF
)" --label enhancement

create "[P6] Distribution & confiance" "$(cat <<'EOF'
## Contexte
v6.0.0 publiée ; friction adoption sur macOS et Linux.

## Tâches
- [ ] macOS : signature + notarisation (`scripts/notarize.js` branché en CI)
- [ ] Linux : packages deb/rpm en plus de l'AppImage
- [ ] Smoke auto-update Windows sur installateur v6
- [ ] Aligner SECURITY.md / README à chaque release

## Critères de done
- macOS : build notarisé ou procédure documentée si compte dev indisponible
- Linux : au moins un format paquet supplémentaire en CI
EOF
)" --label enhancement

create "[P7] Observabilité & logs" "$(cat <<'EOF'
## Contexte
Debug utilisateur et support des priorités P1/P2.

## Tâches
- [ ] Logs structurés : rotation, taille max
- [ ] Viewer Paramètres → logs (filtrage / export améliorés)
- [ ] Corrélation session / outil / sandbox dans les logs

## Critères de done
- Rotation configurable ou plafond de taille documenté
- Export logs utilisable pour rapporter un bug agent
EOF
)" --label enhancement

create "[P8] Qualité continue & maintenance" "$(cat <<'EOF'
## Contexte
Post-v6 : garder la stack saine sans gros chantiers.

## Tâches
- [ ] Niveau 1 deps à chaque release mineure (6.0.x)
- [ ] Documenter rebuild `better-sqlite3` (Electron vs Vitest) dans CONTRIBUTING ou README dev
- [ ] Fermer / trier PR et branches obsolètes post-cleanup

## Critères de done
- Procédure dev rebuild SQLite ajoutée au README
- Checklist release mineure documentée
EOF
)" --label enhancement

create "[Backlog] Long terme — hors scope v6.x" "$(cat <<'EOF'
## Items reportés volontairement

- [ ] **UI Snow** — refonte visuelle (+ Tailwind 4 / React 19 quand attaqué)
- [ ] **Computer Use (CUA)** — extension GUI MCP existante
- [ ] **Multi-agent** — orchestration (roadmap)
- [ ] **Plugin system communautaire** — après marketplace stable
- [ ] **Tauri** — non recommandé (coût >> bénéfice)

## Note
Ne pas prioriser avant P1–P3 stabilisés.
EOF
)" --label enhancement

echo ""
echo "Terminé : 9 issues créées sur ${REPO}"
gh issue list -R "$REPO" --limit 12
