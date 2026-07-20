/**
 * @module renderer/web-bridge/install
 *
 * Browser implementation of `window.electronAPI`, used when the React
 * renderer is served by the Chat LAN server (`/app/`) instead of Electron.
 * Must be imported FIRST in main.tsx: `hooks/ipc/constants.ts` computes
 * `isElectron` from the presence of `window.electronAPI` at module load.
 *
 * Transport mapping:
 *  - send(event)    → POST /api/bridge/event   (fire-and-forget ClientEvent)
 *  - invoke(event)  → POST /api/bridge/invoke  (ClientEvent with a result)
 *  - on(callback)   → SSE  /api/events         (ServerEvent stream)
 *  - namespaces     → POST /api/rpc            (server-side allowlist decides)
 *
 * Auth reuses the Chat LAN token (same localStorage key as the light UI, so
 * logging in on `/` also signs in `/app/`). On 401 the user is sent back to
 * the light UI's login screen.
 */

const TOKEN_KEY = 'lygodactylus-chat-lan-token';

type AnyEvent = { type: string; payload?: unknown };
type ServerEventListener = (event: AnyEvent) => void;

function getToken(): string {
  const params = new URLSearchParams(window.location.search);
  const urlToken = (params.get('token') || '').trim();
  if (urlToken) {
    localStorage.setItem(TOKEN_KEY, urlToken);
    window.history.replaceState(null, '', window.location.pathname);
  }
  return localStorage.getItem(TOKEN_KEY) || '';
}

function redirectToLogin(): void {
  window.location.href = '/';
}

function makeWebElectronApi(): Record<string, unknown> {
  const token = getToken();
  if (!token) {
    redirectToLogin();
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      redirectToLogin();
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      throw new Error(await res.text().catch(() => res.statusText));
    }
    return res.json();
  }

  const rpc = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    post<{ result: T }>('/api/rpc', { channel, args }).then(
      (data) => data.result,
      (err) => {
        console.warn('[WebBridge] rpc rejected:', channel, err?.message || err);
        throw err;
      }
    );

  /**
   * Fire-and-forget writes triggered automatically by the app (language sync,
   * diagnostics). The server rejects them for LAN clients; swallow the
   * rejection instead of surfacing an unhandled-promise error.
   */
  const SILENT_RPC_CHANNELS = new Set(['config.save']);

  /** Proxy a preload namespace: any method call becomes an allowlisted RPC. */
  const namespaceProxy = (prefix: string): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get:
          (_target, method: string) =>
          (...args: unknown[]) => {
            const channel = `${prefix}.${String(method)}`;
            const call = rpc(channel, ...args);
            return SILENT_RPC_CHANNELS.has(channel)
              ? call.catch(() => ({ success: false }))
              : call;
          },
      }
    );

  // --- ServerEvent stream (single shared EventSource, multicast) ---
  const listeners = new Set<ServerEventListener>();
  let eventSource: EventSource | null = null;
  let hadError = false;

  function ensureEventStream(): void {
    if (eventSource) return;
    // EventSource cannot set an Authorization header; the server accepts the
    // token as a query parameter for exactly this case. Reconnection and
    // backoff are built into EventSource.
    eventSource = new EventSource('/api/events?token=' + encodeURIComponent(token));
    eventSource.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as AnyEvent;
        for (const listener of listeners) {
          try {
            listener(event);
          } catch (err) {
            console.error('[WebBridge] Listener error:', err);
          }
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    eventSource.onopen = () => {
      if (hadError) {
        hadError = false;
        // Events emitted while disconnected are lost — refresh the session
        // list so the UI resyncs (the active view refetches on selection).
        void post('/api/bridge/event', { type: 'session.list' }).catch(() => undefined);
      }
    };
    eventSource.onerror = () => {
      hadError = true;
    };
  }

  return {
    send: (event: AnyEvent) => {
      void post('/api/bridge/event', event).catch((err) =>
        console.error('[WebBridge] send failed:', event.type, err)
      );
    },

    invoke: <T>(event: AnyEvent): Promise<T> =>
      post<{ result: T }>('/api/bridge/invoke', event).then((data) => data.result),

    on: (callback: ServerEventListener) => {
      listeners.add(callback);
      ensureEventStream();
      return () => listeners.delete(callback);
    },

    platform: 'browser',

    getSystemTheme: () =>
      Promise.resolve({
        shouldUseDarkColors: window.matchMedia('(prefers-color-scheme: dark)').matches,
      }),

    getVersion: () => rpc<string>('get-version'),

    // Desktop affordances without a browser equivalent: no-op gracefully.
    checkForUpdates: () => Promise.resolve({ supported: false }),
    installUpdate: () => Promise.resolve(false),
    isUpdateCheckSupported: () => Promise.resolve(false),
    openReleasesPage: () => Promise.resolve(false),
    openExternal: (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return Promise.resolve(true);
    },
    showItemInFolder: () => Promise.resolve(false),
    selectFiles: () => Promise.resolve([]),
    window: {
      minimize: () => undefined,
      maximize: () => undefined,
      close: () => undefined,
      openSessionInMain: () => undefined,
      hideQuickAsk: () => undefined,
    },

    artifacts: namespaceProxy('artifacts'),
    checkpoints: namespaceProxy('checkpoints'),
    config: namespaceProxy('config'),
    mcp: namespaceProxy('mcp'),
    memory: namespaceProxy('memory'),
    skills: namespaceProxy('skills'),
    plugins: namespaceProxy('plugins'),
    marketplace: namespaceProxy('marketplace'),
    sandbox: namespaceProxy('sandbox'),
    schedule: namespaceProxy('schedule'),
    presets: namespaceProxy('presets'),
    chatLan: namespaceProxy('chatLan'),
    // `logs` is intentionally absent: its presence would activate the
    // renderer diagnostics forwarder, which would spam rejected RPC calls.
  };
}

if (typeof window !== 'undefined' && window.electronAPI === undefined) {
  (window as unknown as { electronAPI: unknown }).electronAPI = makeWebElectronApi();
}

export {};
