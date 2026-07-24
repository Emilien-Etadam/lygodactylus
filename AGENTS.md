# AGENTS.md

## Cursor Cloud specific instructions

Lygodactylus is an **Electron desktop AI-agent app** (React + Vite renderer, TypeScript main process, SQLite via `better-sqlite3`). There is no backend server; the "product" is the single desktop app. Standard commands live in `package.json` `scripts` — prefer those. Notes below cover only non-obvious startup/run caveats.

### Node version
- The repo pins Node **22.19.0** (`.nvmrc`, `engines`). It is installed via `nvm` and interactive shells pick it up automatically (`~/.bashrc` prepends it to `PATH`). If a shell reports an older Node (the base image ships 22.14), run `nvm use` in `/workspace`.

### `better-sqlite3` has two incompatible builds (most important gotcha)
`better-sqlite3` is a native module and must match the runtime's ABI. The two runtimes need different builds and **overwrite each other**:
- **Running the app** (Electron ABI): `npm install` already leaves it Electron-built via `postinstall`. To force it later: `npm run rebuild`.
- **Running the tests** (Node ABI, vitest runs under Node): `npm rebuild better-sqlite3`, then `npm test`.

So after a fresh `npm install`, `npm test` fails with `NODE_MODULE_VERSION` mismatch until you run `npm rebuild better-sqlite3`. After running tests, run `npm run rebuild` again before launching the app. CI does the same (`npm rebuild better-sqlite3` before tests).

### Running the app
- `npm run dev` builds the sandbox agents + MCP bundle, then launches Vite + Electron. It requires a display (the cloud VM provides `DISPLAY`).
- `dbus`/`Gtk` errors in the log are benign in this headless-desktop container.
- In dev mode the app downloads a standalone Python runtime into `resources/python`; Vite may print repeated `page reload ...python...` lines while those files are written. This is harmless noise, not a crash loop.

### LLM provider (needed for the chat / agent feature)
The app needs an OpenAI/Anthropic-compatible endpoint or a local Ollama server; none ship with the repo. For local end-to-end testing without secrets, run Ollama and configure Settings → provider `openai`, Base URL `http://localhost:11434/v1`, then pick a pulled model.
- Caveat: the latest Ollama build **segfaults** (`llama-server ... signal: segmentation fault`) on this VM's CPU. Ollama **0.11.4** works (`OLLAMA_VERSION=0.11.4 sh install.sh`). Start it with `ollama serve` (systemd is not running in the VM).
