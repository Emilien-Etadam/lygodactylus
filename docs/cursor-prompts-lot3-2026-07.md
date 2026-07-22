# Prompts Cursor — 3e lot veille (2026-07)

> Même workflow que les lots 1 et 2 : **un prompt = une branche = une feature**,
> Règles communes du lot 1 à coller en tête de chaque prompt, revue Claude à la fin
> (« vérifie la branche cursor/xxx »).
>
> **Ordre conseillé** (simple → ambitieux) :
> 1. Sélecteur de localisation modèle → 2. Verrou skills → 3. Dossiers de chats
> → 4. Quick-Ask phase 2 → 5. Veille automatique → 6. Masquage PII
> → 7. Aperçu canvas → 8. Dictée vocale locale.
>
> Leçons des lots 1–2, à respecter partout : dépendance = déclarée + justifiée ;
> valeurs par session lues **en live** (jamais figées au prep) ; realpath pour tout
> containment ; nouveaux canaux desktop **hors** `client-event-allowlist` sauf
> besoin LAN explicite ; préfixe système constant.

---

## Prompt 1 — Sélecteur de localisation du modèle  `cursor/model-location-picker`

```text
[Règles communes du lot 1]

TÂCHE : Rendre visible OÙ tourne chaque modèle — badge « Local » / « Distant
(hôte) » dans le sélecteur de modèle et le panneau de contexte. Pur UX, zéro
nouvelle requête.

FICHIERS À LIRE D'ABORD : src/shared/network/loopback.ts (isLoopbackBaseUrl
existe), src/shared/api-provider-guidance.ts (detectCommonProviderSetup),
les hooks src/renderer/hooks/api-config/*, le picker de modèle actuel.

SPÉCIFICATION :
1. Util partagé `describeEndpointLocation(baseUrl)` → { kind: 'local' | 'lan' |
   'remote', host } : loopback → local ; IP RFC1918/hostname .local → lan ;
   sinon remote. Réutiliser isLoopbackBaseUrl, ne pas réinventer.
2. Badge discret dans le sélecteur de modèle (icône + « Local » / hostname
   tronqué) + rappel dans le footer du panneau contexte à côté des stats #141.
3. Tooltip : URL complète expurgée (pas de clé API, jamais).
4. i18n ×12.

HORS PÉRIMÈTRE : ping/latence, bascule de modèle par badge, multi-endpoints.

TESTS : describeEndpointLocation (loopback v4/v6, 192.168.x, 10.x, .local,
domaine public, URL invalide → remote par défaut).
```

---

## Prompt 2 — Verrou skills (lockfile & pinning)  `cursor/skill-lockfile`

```text
[Règles communes du lot 1]

TÂCHE : À l'installation d'un skill depuis la marketplace, enregistrer le commit
sha résolu + un hash d'intégrité du contenu, les vérifier à la réinstallation /
mise à jour, et permettre le retour à la version épinglée. Sécurité supply-chain :
un skill exécute du code dans le sandbox.

FICHIERS À LIRE D'ABORD : src/main/catalog/install-resolver.ts (entry.resolve.ref
— branche/tag aujourd'hui), github-downloader.ts, marketplace-installed-store.ts,
marketplace-service.ts.

SPÉCIFICATION :
1. À l'install : résoudre le ref en SHA de commit exact (l'API GitHub est déjà
   utilisée par le downloader — réutiliser son client/headers, y compris le
   token éventuel). Calculer un hash sha256 déterministe du contenu installé
   (fichiers triés par chemin, hash de (chemin + contenu)).
2. Persister dans marketplace-installed-store (champ additif par entrée :
   { pinnedSha, contentHash, pinnedAt }). Entrées existantes sans pin →
   comportement actuel inchangé (rétro-compat totale).
3. « Vérifier l'intégrité » : recalcul du hash local vs contentHash — bouton
   dans la fiche du skill installé + check silencieux au démarrage de l'app
   (échec → badge d'avertissement, JAMAIS de blocage automatique).
4. Mise à jour : afficher « épinglé à <sha court> » ; l'update explicite
   ré-épingle sur le nouveau sha. Rollback = réinstaller au pinnedSha
   (le downloader sait télécharger un ref précis — un sha est un ref).
5. UI marketplace : sha court + état intégrité (ok / modifié / non vérifié) ;
   i18n ×12.

HORS PÉRIMÈTRE : signature cryptographique, pinning des MCP/plugins (skills
d'abord), auto-update.

TESTS : hash déterministe (ordre de fichiers permuté → même hash ; contenu
modifié → hash différent) ; store rétro-compat (entrée sans pin) ; résolution
ref→sha mockée ; détection de modification locale.
```

---

## Prompt 3 — Dossiers de chats + sous-chats  `cursor/chat-organization`

```text
[Règles communes du lot 1]

TÂCHE : Organiser la sidebar : dossiers repliables par projet, et « sous-chats »
— brancher une discussion annexe depuis un message sans polluer la session
principale, avec lien de retour.

FICHIERS À LIRE D'ABORD : src/main/db/database.ts (pattern ensureColumn),
session-manager-store.ts, session-manager-message-branch.ts (le fork existant —
le sous-chat DOIT le réutiliser), Sidebar.tsx, la recherche #142 (ne pas casser).

SPÉCIFICATION :
1. DB additive : table `folders` (id, name, collapsed, position, created_at) +
   colonnes sessions `folder_id TEXT NULL` et `parent_session_id TEXT NULL`
   (ensureColumn, défauts NULL — zéro migration destructive).
2. Dossiers : créer/renommer/supprimer (suppression → sessions orphelines vers
   la racine, JAMAIS supprimées) ; assignation par menu contextuel de session ;
   repli persisté ; ordre par position.
3. Sous-chat : action « Ouvrir un sous-chat » sur un message assistant →
   réutilise le fork existant (session-manager-message-branch) + renseigne
   parent_session_id → affiché indenté sous le parent dans la sidebar, badge
   « ↳ » + lien retour vers le parent dans l'en-tête du chat.
4. IPC : folder.create/update/delete/assign — desktop invoke ; AJOUTER aussi à
   client-event-allowlist UNIQUEMENT session.list enrichi (folder_id/parent déjà
   dans l'objet session — vérifier que l'UI distante /app/ affiche les groupes
   sans nouveau canal).
5. Recherche #142 : les hits restent groupés par session — ajouter le nom de
   dossier en sous-titre si présent, rien d'autre.
6. i18n ×12.

HORS PÉRIMÈTRE : drag-and-drop (menu suffit en v1), dossiers imbriqués,
partage/couleurs.

TESTS : migration additive (DB existante → colonnes NULL) ; suppression dossier
→ sessions à la racine ; sous-chat = fork + parent_session_id ; cycle interdit
(un parent ne peut pas devenir enfant de son enfant).
```

---

## Prompt 4 — Quick-Ask phase 2 : actions sur sélection  `cursor/quick-ask-selection`

```text
[Règles communes du lot 1]

TÂCHE : Étendre le Quick-Ask (#136) : agir sur du texte venu d'une autre
application — résumer / traduire / reformuler — avec le résultat prêt à coller.
SANS nouvelle dépendance native.

ÉTAPE 0 OBLIGATOIRE — INVESTIGATION (résumer avant de coder) :
La capture directe de la sélection d'une autre app exige une simulation clavier
(Ctrl+C) que nous ne pouvons pas faire proprement sans dépendance native sur
Windows/Linux. Cartographier ce qui existe déjà : cliclick est téléchargé
on-demand sur macOS (scripts/prepare-gui-tools, mcp/gui-operate/mac-platform) ;
y a-t-il un équivalent Windows/Linux déjà embarqué (gui-operate) ? CONCLURE :
- chemin universel = PRESSE-PAPIER (l'utilisateur copie lui-même, Ctrl+C puis
  hotkey) — c'est la voie à implémenter partout ;
- capture de sélection vraie = amélioration macOS-only via cliclick SI ET
  SEULEMENT SI l'infra existante le permet sans nouveau binaire ; sinon la
  documenter comme non retenue.

SPÉCIFICATION (chemin presse-papier, universel) :
1. Deuxième raccourci global configurable (défaut CommandOrControl+Shift+Y,
   même infra #136 : validation, échec géré, unregister) : ouvre la fenêtre
   Quick-Ask en mode « Sélection » pré-remplie avec le TEXTE du presse-papier
   (clipboard.readText côté main ; > 32 Ko → tronqué avec marqueur ; vide →
   message d'aide « copiez d'abord un texte »).
2. Rangée de chips d'action au-dessus du champ : Résumer / Traduire (vers la
   langue UI) / Reformuler / Corriger — chaque chip = template de prompt
   constant (i18n) appliqué au texte collé ; le champ reste éditable avant envoi.
3. Résultat : affiché comme aujourd'hui + bouton « Copier le résultat »
   (clipboard.writeText) mis en évidence ; pas de paste-back automatique.
4. La session reste la session Quick-Ask en mode plan (lecture seule) — rien
   ne change au modèle de sécurité de #136.
5. Réglages : le raccourci sélection dans la section Quick-Ask ; i18n ×12.

HORS PÉRIMÈTRE : simulation clavier cross-platform, paste-back automatique,
historique des actions, OCR d'images du presse-papier.

TESTS : troncature 32 Ko UTF-8-safe ; presse-papier vide → état d'aide ;
templates de chips constants (byte-stable par langue) ; helpers de raccourci
(réutiliser les tests #136 comme modèle).
```

---

## Prompt 5 — Veille automatique (watch + digest)  `cursor/content-watch`

```text
[Règles communes du lot 1]

TÂCHE : Surveiller des sources — dossier local, flux RSS, URL — et produire un
digest des NOUVEAUTÉS uniquement, dans une session dédiée « Veille ». Étend le
backend cron existant, n'en crée pas un deuxième.

FICHIERS À LIRE D'ABORD : src/main/schedule/ (scheduled-task-manager,
schedule-tools — le backend cron existe), src/main/autonomy/unified-diff.ts
(#149 — à réutiliser pour le mode diff), chokidar (dép existante), web_fetch,
le parsing RSS : PAS de nouvelle dépendance — parser XML minimal maison pour
RSS/Atom (title/link/pubDate/guid uniquement) avec tests.

SPÉCIFICATION :
1. Config : liste de watchers dans un store dédié userData (pas la config
   globale) : { id, type: 'folder'|'rss'|'url', target, schedule (cron existant),
   enabled, lastState }. CRUD via IPC desktop (hors allowlist LAN).
2. Détection du nouveau :
   - folder : chokidar ponctuel au tick (scan, pas de watcher permanent) —
     liste fichiers+mtime vs lastState ;
   - rss : GUIDs non vus (lastState = derniers 200 guids) ;
   - url : hash du texte extrait ; si changé → unified-diff (#149) du texte,
     tronqué 8 Ko UTF-8-safe (réutiliser l'helper #149).
3. Digest : au tick, s'il y a du nouveau, envoyer UN message dans une session
   dédiée « Veille » (créée au premier usage, réutilisée par titre interne
   comme Quick-Ask) : résumé par le modèle avec le matériel nouveau en
   contexte ; sinon AUCUN message (pas de bruit « rien de neuf »).
4. La session Veille est en mode plan (lecture seule) — un digest ne doit
   jamais déclencher d'écriture.
5. UI : onglet Réglages « Veille » (liste, ajouter, activer/désactiver,
   dernier passage) ; i18n ×12.

HORS PÉRIMÈTRE : notifications OS, authentification sur les flux, contenu
paywallé, fréquences < 1h.

TESTS : parser RSS/Atom minimal (2 fixtures réelles + malformé → vide) ;
détection folder (ajout/modif/suppression) ; état guids borné à 200 ;
diff URL tronqué ; aucun message quand rien de neuf.
```

---

## Prompt 6 — Masquage PII sortant  `cursor/pii-scrub`

```text
[Règles communes du lot 1]

TÂCHE : Avant tout appel sortant (web_search, web_fetch, http_request, outils
MCP), remplacer les données personnelles détectées par des jetons réversibles
({{PII_1}}), puis restaurer les vraies valeurs dans la réponse. Opt-in, OFF.
AUCUNE dépendance ML — détection par règles.

ÉTAPE 0 OBLIGATOIRE — INVESTIGATION (résumer avant de coder) :
Localiser les CHOKEPOINTS uniques par lesquels passent les paramètres sortants :
(a) web_search → runWebSearch (query) ; (b) web_fetch / http_request → leurs
handlers (URL + headers + body) ; (c) MCP → mcpManager.callTool (arguments).
Confirmer qu'il n'existe pas d'autre chemin d'egress d'arguments outils (le bash
sandbox est HORS périmètre — documenté). Si le point MCP n'est pas unique,
s'arrêter et rapporter.

SPÉCIFICATION :
1. Module src/shared/pii-scrub.ts : détecteurs par règles — email, téléphone
   (formats FR + E.164), IBAN (avec validation mod-97), carte bancaire (Luhn),
   + liste de termes personnalisés définie par l'utilisateur (noms, adresses)
   dans les Réglages. Chaque détection → jeton {{PII_n}} + map réversible
   PAR REQUÊTE (jamais persistée, jamais loggée).
2. Application aux chokepoints identifiés en étape 0 : scrub des arguments
   sortants, unscrub des textes de réponse avant retour au modèle. Les URLs :
   scrub uniquement des query params et du body, PAS du hostname/path (une URL
   cassée = feature cassée).
3. Réglage global OFF + liste de termes custom (store chiffré existant) ;
   compteur discret « N éléments masqués » dans la trace de l'outil ; i18n ×12.
4. Échec du scrub (regex catastrophique, etc.) → envoyer NON scrubé n'est PAS
   acceptable : en cas d'erreur interne du module, BLOQUER l'appel avec une
   erreur outil claire (fail-closed, c'est le contrat de la feature).

HORS PÉRIMÈTRE : NER/ML, langues au-delà FR/EN pour les formats, scrub du bash,
scrub des prompts vers le LLM local (il est local, c'est le point).

TESTS : chaque détecteur (vrais/faux positifs — un numéro de version 1.2.3
n'est pas un téléphone ; IBAN invalide mod-97 → non masqué) ; aller-retour
scrub→unscrub identité ; termes custom avec caractères regex ; fail-closed.
```

---

## Prompt 7 — Aperçu live (canvas)  `cursor/artifacts-canvas`

```text
[Règles communes du lot 1]

TÂCHE : Quand une réponse contient un bloc ```html ou ```svg, proposer un bouton
« Aperçu » qui rend le contenu dans un panneau latéral sandboxé, avec bascule
entre les versions successives du même artefact dans la session. ZÉRO dépendance.

FICHIERS À LIRE D'ABORD : ContentBlockView/CodeBlock (détection des fences),
ContextPanel (pattern de panneau latéral), la CSP de l'app (index.html,
main-app-window webPreferences).

SPÉCIFICATION :
1. Détection : blocs fencés html/svg complets (heuristique : contient une
   racine plausible — <html, <svg, <!doctype) dans les messages assistant →
   bouton « Aperçu » sur le CodeBlock.
2. Rendu : panneau latéral avec <iframe sandbox="allow-scripts" srcdoc=...> —
   PAS de allow-same-origin (isolation totale), CSP inline injectée dans le
   srcdoc interdisant toute requête réseau (default-src 'none' ; style/script
   inline autorisés). Le JS du bloc tourne, mais ne peut rien charger ni
   atteindre l'app. Vérifier qu'aucun canal preload ne fuit dans l'iframe.
3. Versions : les blocs successifs du même type dans la session = versions ;
   sélecteur « v1 / v2 / … » (état renderer par session, non persisté).
4. Boutons : rafraîchir, ouvrir en grand (fenêtre dédiée avec les mêmes
   protections), copier la source.
5. i18n ×12.

HORS PÉRIMÈTRE : Mermaid (dépendance — éventuel lot ultérieur avec
justification), exécution dans le sandbox VM, React/JSX, persistance des
artefacts, édition in-place.

TESTS : détection (html complet oui, fragment non, svg oui, ts non) ;
construction du srcdoc avec CSP (snapshot) ; versions ordonnées par arrivée.
```

---

## Prompt 8 — Dictée vocale locale (STT)  `cursor/local-stt`

> **État 2026-07-22 — LIVRÉ** via la **PR #165** (voie A : win/linux = assets
> officiels v1.9.1 ; macOS = bottles Homebrew `whisper-cpp` 1.9.1 pinnés par
> digest). Étape 0 : [`local-stt-investigation-2026-07.md`](./local-stt-investigation-2026-07.md) ;
> spécification d'implémentation : **Prompt 8-bis** ci-dessous (remplace le
> prompt 8 original).

```text
[Règles communes du lot 1]

TÂCHE : Bouton micro dans la zone de saisie : maintenir (push-to-talk) ou
cliquer pour démarrer/arrêter, transcription 100% locale insérée dans le champ.
Le miroir du TTS #131 — dernière brique de la boucle voix.

ÉTAPE 0 OBLIGATOIRE — INVESTIGATION (résumer avant de coder) :
L'app télécharge déjà des runtimes on-demand dans userData (Node, Python,
cliclick — scripts/download-node.mjs, prepare-python, prepare-gui-tools ;
releases GitHub officielles, vérification, installateur allégé v5.3).
Cartographier ce pattern et CONCLURE le plan exact pour whisper.cpp :
- binaire précompilé whisper.cpp (ou whisper-cli) par plateforme
  (win-x64 / mac-arm64 / linux-x64) depuis les releases GitHub officielles
  ggml-org/whisper.cpp — vérifier qu'elles existent pour les 3 plateformes ;
  SINON s'arrêter et rapporter les alternatives (compilation locale exclue).
- modèle ggml-base (~140 Mo, multilingue) OU ggml-base.en — choix : base
  multilingue (app 12 langues), téléchargé au premier usage depuis
  huggingface ggerganov/whisper.cpp (URL stable), checksum vérifié.

SPÉCIFICATION :
1. Téléchargement on-demand (pattern existant) : binaire + modèle dans
   userData/stt/, barre de progression dans les Réglages, checksums, reprise
   d'un téléchargement interrompu = repartir de zéro (simple).
2. Capture : getUserMedia côté renderer (permission micro OS gérée par
   Electron), MediaRecorder → WAV/PCM 16 kHz mono (conversion via
   AudioContext, pas de dépendance), envoyé au main par IPC à l'arrêt
   (pas de streaming — transcription au release, v1 assumée).
3. Main : spawn whisper-cli (fichier temp WAV dans le scratch userData,
   supprimé après), langue = langue UI (ou auto), timeout 60 s, sortie texte
   insérée au curseur dans le champ de saisie (événement au renderer).
   Échec → toast discret, jamais de crash.
4. UI : bouton micro (états : idle / enregistrement (pulsation) /
   transcription (spinner)) ; premier clic sans binaire → dialogue proposant
   le téléchargement (taille affichée) ; réglage on/off + choix du modèle
   (base/small) dans Réglages ; i18n ×12.
5. Sécurité : le binaire ne reçoit QUE le WAV temp et --language ; pas de
   shell interpolé (spawn args array) ; fichier temp dans userData, pas /tmp.

HORS PÉRIMÈTRE : streaming temps réel, voice activity detection, commandes
vocales, envoi automatique après transcription, Chat LAN.

TESTS : conversion PCM (fixture sinusoïde → en-tête WAV valide 16 kHz mono) ;
construction des args spawn (pas d'interpolation) ; gestion binaire absent /
téléchargement requis ; nettoyage du fichier temp (succès ET échec).
```

---

## Après chaque branche

Rituel habituel : « vérifie la branche cursor/xxx » → revue Claude complète.
Points d'attention spécifiques lot 3 : chokepoints PII réellement uniques,
sandbox iframe sans fuite preload, spawn STT sans interpolation shell,
lockfile rétro-compatible, sous-chats sans cycle.

---

## Prompt 8-bis — STT locale, implémentation voie A  `cursor/local-stt-impl`

```text
[Règles communes du lot 1]

CONTEXTE : L'étape 0 est FAITE (docs/local-stt-investigation-2026-07.md) et la
décision est prise : voie A. Ne pas re-investiguer. Implémenter la dictée
vocale locale avec whisper.cpp v1.9.1 :
- win-x64   : release officielle ggml-org/whisper.cpp v1.9.1 → whisper-bin-x64.zip
              (extraire whisper-cli.exe + TOUTES les DLLs du même dossier).
- linux-x64 : whisper-bin-ubuntu-x64.tar.gz (whisper-cli + libwhisper/libggml .so).
- macOS     : bottle Homebrew de la formula whisper-cpp 1.9.1 — MÊME MÉCANIQUE
              que cliclick (scripts/lib/gui-tools-runtime.mjs), arm64 ET x86_64.

FICHIERS À LIRE D'ABORD : scripts/lib/gui-tools-runtime.mjs (bottle : résolution,
download, extraction tar args-array), scripts/lib/node-runtime.mjs (checksum),
src/main/runtime/gui-tools-runtime.ts (wrapper ensure*), le rapport étape 0.

SPÉCIFICATION :
1. Runtime : scripts/lib/stt-runtime.mjs + src/main/runtime/stt-runtime.ts,
   stockage userData/runtimes/stt/<version whisper>/ (aligné Node/Python).
   Téléchargement AU PREMIER USAGE avec progression visible + annulable.
2. ÉPINGLAGE STRICT (leçon fragilité cliclick — ne PAS dépendre de la version
   courante de la formule) :
   - Win/Linux : URLs des assets du tag v1.9.1 (immuables) + sha256 FIGÉS en
     constantes dans stt-runtime.mjs.
   - macOS : URL du blob ghcr.io par DIGEST sha256 (stable à jamais) + le même
     sha256 comme checksum, PAS de résolution dynamique formulae.brew.sh au
     runtime (la garder seulement en fallback commenté). Un blob par arch
     (arm64 / x86_64), clés bottle relevées dans le rapport étape 0.
   - Toute archive téléchargée : vérifier le sha256 AVANT extraction ; mismatch
     → supprimer + erreur claire, jamais d'exécution d'un binaire non vérifié.
3. Chargement dynamique des libs au spawn (le binaire n'est PAS déplacé hors de
   son dossier d'extraction) :
   - Windows : cwd = dossier du binaire (résolution DLL implicite).
   - Linux   : env LD_LIBRARY_PATH = dossier des .so (préfixé à l'existant).
   - macOS   : env DYLD_LIBRARY_PATH + DYLD_FALLBACK_LIBRARY_PATH = <bottle>/lib
     (dyld résout par nom de feuille en priorité — couvre les install_names
     absolus /opt/homebrew du bottle ; SIP ne s'applique pas à un binaire
     téléchargé). Test manuel de lancement documenté dans la PR.
4. Modèle : ggml-base.bin multilingue depuis huggingface
   ggerganov/whisper.cpp, URL figée PAR COMMIT (resolve/<commit>/ggml-base.bin)
   + sha256 + taille en constantes. Download .part → rename atomique après
   checksum OK. Option Réglages : ggml-small.bin (même mécanique). Stockage
   userData/runtimes/stt/models/.
5. Capture : bouton micro dans la zone de saisie (ChatView) — MAINTENIR
   (push-to-talk) ou CLIC pour démarrer/arrêter. getUserMedia audio →
   AudioContext → mono 16 kHz PCM16 → en-tête WAV écrit À LA MAIN (44 octets,
   zéro dépendance). macOS : systemPreferences.askForMediaAccess('microphone')
   + NSMicrophoneUsageDescription dans la config electron-builder (exception
   packaging légitime, la documenter dans la PR ; ne rien toucher d'autre au
   build/CI).
6. Transcription : spawn du binaire en ARGS ARRAY STRICT (jamais de shell) :
   ['-m', modelPath, '-f', wavPath, '-l', lang, '--no-timestamps'] ; lang =
   langue UI mappée vers les codes whisper + option « auto » ; lire la
   transcription sur STDOUT (PAS de -otxt : aucun fichier de sortie à gérer) ;
   timeout (5 min) + kill à l'annulation utilisateur.
7. Fichier WAV temporaire dans userData/runtimes/stt/tmp/, supprimé en finally
   (succès, échec ET annulation). Aucun audio persisté, jamais.
8. Résultat : INSÉRÉ dans le champ de saisie à la position du curseur —
   l'utilisateur relit et envoie lui-même. JAMAIS d'envoi automatique.
9. Réglages « Voix » : activer la dictée (OFF par défaut), modèle base/small,
   langue auto/UI, état du runtime (téléchargé ou non + bouton supprimer).
10. i18n ×12 (UI + erreurs backend via catalog mt()).

HORS PÉRIMÈTRE : streaming temps réel, VAD, ponctuation avancée, autres
modèles, autres langues de FORMATS que la liste whisper, toute modification CI.

TESTS : en-tête WAV (44 octets exacts, champs riff/fmt/data) ; resample vers
16 kHz mono (fixtures) ; construction des args spawn (aucune interpolation,
chemins avec espaces OK) ; checksum mismatch → refus + fichier supprimé ;
nettoyage tmp sur échec ET annulation ; mapping langue UI → code whisper ;
résolution du chemin binaire par plateforme (mocks fs).
```

---

## Ménage post-lot 3  `cursor/cleanup-lot3`

```text
[Règles communes du lot 1]

TÂCHE : Ménage ciblé post-lot 3 — suppression de code mort à risque, trois
déduplications, deux correctifs de robustesse, trois micro-fixes. AUCUN
changement de comportement utilisateur sauf les points explicitement listés.

1. SUPPRIMER LES EXECUTORS MORTS (le point le plus important) :
   src/main/tools/tool-executor.ts et src/main/tools/sandbox-tool-executor.ts
   ne sont importés NULLE PART dans src/ (framework pré-pi-SDK) et contiennent
   un appel runWebSearch NON scrubé PII — un rebranchement futur contournerait
   silencieusement le masquage #159.
   - Vérifier zéro référence (imports, mocks) dans src/ ET tests/ avant
     suppression ; lister la vérification dans la PR.
   - Cascade : command-sandbox-validation.ts et format-file-size.ts ne servent
     qu'à ces executors → les supprimer aussi SI aucune autre référence.
     PathResolver, path-containment, local-file-path sont VIVANTS — ne pas y
     toucher.
   - tests/tool-executor-*.test.ts (sandbox, unc-paths, file-ops) testent ce
     code mort : avant suppression, vérifier que la logique vivante qu'ils
     exercent indirectement (isPathWithinRoot, isUncPath, validation sandbox)
     reste couverte par les tests de path-safety / local-file-path existants ;
     sinon réécrire le cas manquant contre le module vivant, PUIS supprimer.
     Documenter la variation du décompte de tests dans la PR.

2. DÉDUP RÉSEAU (#153) : exporter normalizeHostname depuis
   src/shared/network/loopback.ts et l'utiliser dans endpoint-location.ts
   (supprimer la copie locale, et aligner le parsing d'URL si trivial).
   Comportement identique — les tests endpoint-location restent verts tels
   quels.

3. DÉDUP DOSSIERS (#155) : un helper safeListChatFolders(db) (try/catch → [])
   exporté de chat-folders-store.ts, remplaçant le bloc dupliqué ×4 dans
   main-client-events.ts, chat-lan-server.ts, quick-ask-controller.ts,
   ipc-chat-folders.ts.

4. PIN PRÉSERVÉ AU ROLLBACK (#154) : dans installGithubSkill, quand le ref
   effectif est DÉJÀ un SHA de commit (40 hex, cas installGithubSkillAtRef) et
   que resolveGithubCommitSha échoue, utiliser ce SHA comme resolvedSha (il est
   exact par définition) → contentHash calculé, pin conservé. Test : rollback
   avec résolution API mockée à null → pinnedSha/contentHash présents.

5. MICRO-FIXES :
   a. rss-parser.ts (#158) : dans extractLink Atom, préférer réellement
      rel="alternate" (ou un link SANS rel) et ne jamais retenir rel="self" —
      corriger l'ordre des regex + test avec une entry contenant self puis
      alternate.
   b. ipc-stt.ts (#165) : refuser stt.transcribe si une transcription est déjà
      active (garde busy simple) — erreur backend errSttBusy via catalog mt()
      ×12 locales.
   c. Sidebar (#155) : masquer « Déplacer vers un dossier » dans le menu
      contextuel d'un SOUS-chat (il suit son parent ; l'assignation n'a pas
      d'effet visible).

HORS PÉRIMÈTRE : bump du SDK pi (chantier séparé), toute refonte, tout
changement de dépendances npm.

TESTS : typecheck / lint (0 erreur, warnings baseline) / vitest verts ;
nouveaux tests pour 4, 5a, 5b ; décompte final documenté.
```
