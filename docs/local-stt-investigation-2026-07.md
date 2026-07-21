# Local STT — Étape 0 investigation (2026-07)

> **Décision** : **voie A retenue** (2026-07-21) — win/linux = assets officiels
> `ggml-org/whisper.cpp` v1.9.1 ; macOS = bottles Homebrew `whisper-cpp` 1.9.1
> pinnés par digest ghcr.io (même mécanique que cliclick, sans résolution
> dynamique formulae.brew.sh au runtime).
>
> Branche : `cursor/local-stt` · Prompt : `docs/cursor-prompts-lot3-2026-07.md` §8

---

## 1. Pattern on-demand existant (v5.3)

L’app allège l’installateur en téléchargeant des runtimes au premier usage
dans `userData`, avec libs partagées scripts ↔ main :

| Runtime | Script / lib | Main wrapper | Stockage packaged |
| --- | --- | --- | --- |
| Node.js | `scripts/download-node.mjs` + `scripts/lib/node-runtime.mjs` | `src/main/runtime/node-runtime.ts` | `userData/runtimes/node/<version>/` |
| Python | `scripts/prepare-python.js` + `scripts/lib/python-runtime.mjs` | `src/main/runtime/python-runtime.ts` | `userData/runtimes/python/<version>/` |
| cliclick (macOS) | `scripts/prepare-gui-tools.js` + `scripts/lib/gui-tools-runtime.mjs` | `src/main/runtime/gui-tools-runtime.ts` | `userData/runtimes/...` (+ bottle Homebrew) |

Traits communs utiles pour STT :

1. Lib `scripts/lib/*-runtime.mjs` (download / extract / verify / resolve path).
2. Wrapper Electron `ensure*Runtime()` : cache, migration legacy, download
   packaged → `userData`, dev → `resources/…`.
3. Sources **officielles** uniquement (nodejs.org, astral-sh PBS, Homebrew
   bottles pour cliclick).
4. Pas de reprise partielle : échec / interruption → repartir de zéro.
5. TTS miroir déjà livré (#131 / PR lecture vocale) via `speechSynthesis`
   Chromium — **aucune** dépendance native côté TTS.

Le prompt demande `userData/stt/` (plutôt que `userData/runtimes/stt/`) :
acceptable, mais préférable d’aligner sur `userData/runtimes/stt/<version>/`
pour rester cohérent avec Node/Python, **sauf** décision contraire.

---

## 2. Releases officielles whisper.cpp (v1.9.1, 2026-06-19)

Source vérifiée via API GitHub :
`https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest`

| Plateforme cible | Asset officiel | Contient `whisper-cli` ? |
| --- | --- | --- |
| **win-x64** | `whisper-bin-x64.zip` (~7.6 Mo) | ✅ `Release/whisper-cli.exe` + DLLs |
| **linux-x64** | `whisper-bin-ubuntu-x64.tar.gz` (~8.9 Mo) | ✅ `whisper-cli` + `.so` |
| **mac-arm64** | *aucun asset CLI* | ❌ |
| macOS (autre) | `whisper-v1.9.1-xcframework.zip` (~48 Mo) | ❌ XCFramework (librairie embed), **pas** un CLI |

Autres assets présents mais hors cible : Win32, ubuntu-arm64, BLAS/cuBLAS
Windows, xcframework Apple.

**Inspection archives** :

- Windows : `whisper-cli.exe` coexiste avec `main.exe` (legacy) et de nombreuses
  DLL CPU variants — il faudra extraire le CLI + DLLs nécessaires (pas seulement
  l’exe).
- Linux : `whisper-cli` + libs partagées (`libwhisper.so*`, `libggml*.so`) dans
  le même dossier — le spawn devra préserver `LD_LIBRARY_PATH` / rpath relatif
  (ou cwd = dossier du binaire).
- XCFramework macOS : framework `whisper` pour tvOS / macOS — **inutilisable**
  comme processus `spawn` sans wrapper Swift/ObjC (hors périmètre).

Même constat sur v1.9.0, v1.8.7, v1.8.6 : **jamais** de tarball/zip CLI macOS
dans les releases officielles.

→ **Critère « 3 plateformes » du prompt non rempli. Arrêt obligatoire.**

---

## 3. Modèle ggml (hors blocage binaire)

| Modèle | URL stable | Taille liée (HF) | Choix |
| --- | --- | --- | --- |
| `ggml-base.bin` | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin` | **147 951 465** o (~141 Mo) | ✅ multilingue (12 langues UI) |
| `ggml-base.en.bin` | même repo HF | similaire | ❌ anglais seul |
| `ggml-small.bin` | même repo HF | plus grand | option Réglages (spec §4) |

Checksum : HF expose `x-linked-etag` / commit
(`5359861c739e955e79d9a303bcbc70fb988958b1` au moment de l’enquête). À figer
(sha256 du fichier) dans la lib runtime une fois la voie binaire choisie —
ne pas se fier uniquement à la taille.

---

## 4. Alternatives (compilation locale utilisateur exclue)

### A. Hybride officiel + bottle Homebrew macOS ⭐ recommandée

Miroir exact du pattern **cliclick** (`gui-tools-runtime.mjs`) :

| OS | Source |
| --- | --- |
| Windows x64 | GitHub `ggml-org/whisper.cpp` → `whisper-bin-x64.zip` |
| Linux x64 | GitHub → `whisper-bin-ubuntu-x64.tar.gz` |
| macOS arm64 (et x64) | Homebrew formula `whisper-cpp` **v1.9.1** bottles (`ghcr.io/v2/homebrew/core/whisper-cpp/blobs/sha256:…`) |

Bottles disponibles (API `formulae.brew.sh`, 2026-07-21) :
`arm64_tahoe`, `arm64_sequoia`, `arm64_sonoma`, `sonoma`, `arm64_linux`,
`x86_64_linux` — chacun avec sha256.

**Avantages** : même version 1.9.1 que les releases officielles ; checksums
Homebrew ; code path déjà éprouvé (cliclick) ; pas de build utilisateur.
**Risques** : dépendance à Homebrew bottle layout / GHCR auth headers ; bottles
liés à une version macOS (sélection multi-clés comme cliclick).

### B. Publier nous-mêmes le CLI macOS dans les releases Lygodactylus

Job CI macOS (GitHub Actions `macos-14`) qui build `whisper-cli` une fois par
tag whisper / release app, attache `whisper-cli-darwin-arm64.tar.gz` (+ x64)
aux assets GitHub du fork, vérifie sha256.

**Avantages** : source 100 % contrôlée, une seule origine pour les 3 OS côté
app. **Coût** : maintenance CI, signature/notarisation éventuelle, taille
release.

### C. Dépôts tiers précompilés

Ex. `yaklang/whisper.cpp.binary`, `daniloaguiarbr/whisper-macos-cli`.

**Non recommandé** : surface supply-chain hors ggml-org / Homebrew ; versions
et politique de sécurité opaques.

### D. whisper.cpp WebAssembly dans le renderer

Évite le spawn native. **Hors esprit** du prompt (spawn `whisper-cli`, IPC WAV,
userData scratch) et perf/mémoire moins prévisibles pour `base`/`small`.

### E. Ship Win + Linux seulement, macOS « bientôt »

Mauvaise UX (macOS = plateforme principale du fork). À éviter.

---

## 5. Plan d’implémentation **si** alternative A (ou B) validée

À ne pas démarrer avant décision explicite.

1. **Runtime**
   - `scripts/lib/stt-runtime.mjs` : resolve platform asset, download archive,
     extract slim layout (`bin/whisper-cli` + libs), download model
     `ggml-base.bin` (+ `small` optionnel), sha256 verify, delete partial on
     failure.
   - `src/main/runtime/stt-runtime.ts` : `ensureSttRuntime()`, status + progress
     IPC vers Réglages (`userData/runtimes/stt/` ou `userData/stt/`).
2. **Capture renderer** : `getUserMedia` → `AudioContext` resample 16 kHz mono
   PCM → WAV header → IPC buffer au release (pas de streaming).
3. **Main** : `spawn(cli, ['-m', model, '-f', wav, '-l', lang, '-nt'], {…})`
   args array only ; timeout 60 s ; temp WAV sous scratch userData ; unlink
   success **et** failure ; toast discret.
4. **UI** : bouton micro (idle / recording pulse / transcribing spinner) près
   du textarea `ChatView` (+ WelcomeView si pertinent) ; dialog premier
   téléchargement avec taille ; toggle + modèle base/small dans
   `SettingsGeneral` ; i18n ×12.
5. **Config** : `speechToTextEnabled` (off default), `speechToTextModel:
   'base' | 'small'` — miroir de `speechSynthesisEnabled`.
6. **Tests** : WAV sinusoïde 16 kHz mono ; `buildWhisperArgs` sans
   interpolation ; absent → `download_required` ; cleanup temp success/échec.

---

## 6. Question ouverte pour le mainteneur

Choisir **A** (Homebrew bottle macOS, recommandé) ou **B** (CI self-publish
macOS CLI). Toute autre voie (C/D/E) à justifier.

Sans ce choix, la feature reste **planned / bloquée** dans la roadmap lot 3.
