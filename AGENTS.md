# AGENTS.md

## Cursor Cloud specific instructions

Lygodactylus is a **single Electron + React + TypeScript desktop app** (local-first AI agent). There is no backend server or database service — persistence is embedded SQLite (`better-sqlite3`). Standard commands live in `package.json` scripts; the notes below only cover non-obvious gotchas.

### Node version
- `.nvmrc` pins `22.19.0` and `package.json` requires `node >=22.19.0`. The nvm default in this environment is `v22.22.2`, which satisfies the requirement, so `npm`/`npm install` work out of the box. No manual `nvm use` is needed for install/lint/test/build.

### `better-sqlite3` ABI gotcha (most important)
`better-sqlite3` is a native module and must be compiled for the ABI of whichever runtime loads it. The two contexts need **different** builds and switching clobbers the other:
- `npm install`'s `postinstall` (and `npm run rebuild`) compile it for the **Electron** ABI — required to run the app (`npm run dev`).
- The **vitest** suite runs under plain **Node**. Before running tests you must rebuild for Node: `npm rebuild better-sqlite3`. Otherwise SQLite-backed tests fail with `Module did not self-register` / `Cannot read properties of undefined (reading 'close')`.
- After running tests, if you want to run the app again, restore the Electron build with `npm run rebuild`.

Order that works: `npm rebuild better-sqlite3` → `npm run test -- --run` (tests) → `npm run rebuild` → `npm run dev` (app).

### Running the app (dev mode)
- Run on the VNC desktop display: `DISPLAY=:1 npm run dev`. This starts Vite and auto-launches the Electron main/preload with HMR.
- `dbus`/`Gtk` warnings in the log are harmless in this headless container.
- On first launch, dev mode downloads a Python 3.10 runtime into `resources/python`; because that path is watched by Vite, it spams `[vite] page reload` lines until the download finishes. This is harmless and settles on its own.

### Testing the AI agent (LLM endpoint)
- No LLM API key is provided by default, so the agent chat is non-functional until configured. The app supports an OpenAI-compatible or Anthropic-compatible endpoint (Settings → API).
- For local end-to-end testing, run an Ollama server (OpenAI-compatible at `http://127.0.0.1:11434/v1`) and configure it via Settings → "Find Local Ollama", then pick a pulled model (e.g. `llama3.2:1b`).
- Caveat: the newest Ollama (0.32.x) segfaulted on this CPU during model warmup; a stable release such as `0.6.8` works reliably here. A local 1B model answers in ~1-2 min.

### Lint / typecheck / test / build
Use the `package.json` scripts: `npm run lint`, `npm run typecheck`, `npm run test -- --run` (see the `better-sqlite3` note above), `npm run build:linux`. Lint currently reports warnings only (no errors).
