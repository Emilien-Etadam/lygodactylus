'use strict';

const TOKEN_KEY = 'lygodactylus-chat-lan-token';
let authToken = localStorage.getItem(TOKEN_KEY) || '';
let activeSessionId = null;
let eventStreamAbort = null;
let pendingPermission = null;
let pendingSudo = null;
let reconnectDelayMs = 1000;
let reconnectTimer = null;
let connected = false;

const RECONNECT_MAX_MS = 30000;

const $ = (id) => document.getElementById(id);

function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken, ...(options.headers || {}) };
  return fetch(path, { ...options, headers }).then(async (res) => {
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  });
}

function textFromContent(content) {
  if (!Array.isArray(content)) return String(content || '');
  return content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
}

function appendMessage(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = text;
  $('messages').appendChild(el);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function setConnStatus(state) {
  const el = $('connStatus');
  if (state === 'connected') {
    el.textContent = 'Connecté';
    el.className = 'status ok';
  } else if (state === 'reconnecting') {
    el.textContent = 'Reconnexion…';
    el.className = 'status warn';
  } else {
    el.textContent = 'Hors ligne';
    el.className = 'status';
  }
}

function renderSessions(sessions) {
  const list = $('sessionList');
  list.innerHTML = '';
  for (const s of sessions) {
    const btn = document.createElement('button');
    btn.className = 'session-item' + (s.id === activeSessionId ? ' active' : '');
    btn.textContent = s.title || s.id.slice(0, 8);
    btn.onclick = () => {
      closeDrawer();
      void selectSession(s.id);
    };
    list.appendChild(btn);
  }
}

async function loadSessions() {
  const data = await api('/api/sessions');
  renderSessions(data.sessions || []);
}

async function loadMessages(sessionId) {
  $('messages').innerHTML = '';
  const data = await api('/api/sessions/' + encodeURIComponent(sessionId) + '/messages');
  for (const m of data.messages || []) {
    appendMessage(m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : 'system', textFromContent(m.content));
  }
}

async function selectSession(sessionId) {
  activeSessionId = sessionId;
  await loadSessions();
  await loadMessages(sessionId);
}

/* Catch-up after a dropped stream: Android freezes background tabs/PWAs,
 * so events emitted while frozen are lost and must be refetched. */
async function resyncAfterReconnect() {
  try {
    await loadSessions();
    if (activeSessionId) {
      await loadMessages(activeSessionId);
    }
  } catch (e) {
    console.warn(e);
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  setConnStatus('reconnecting');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
    connectEvents();
  }, reconnectDelayMs);
}

function connectEvents() {
  if (eventStreamAbort) {
    eventStreamAbort.abort();
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  eventStreamAbort = new AbortController();

  void (async () => {
    try {
      const response = await fetch('/api/events', {
        headers: { Authorization: 'Bearer ' + authToken },
        signal: eventStreamAbort.signal,
        cache: 'no-store',
      });
      if (!response.ok || !response.body) {
        throw new Error('SSE ' + response.status);
      }

      const wasReconnecting = !connected;
      connected = true;
      reconnectDelayMs = 1000;
      setConnStatus('connected');
      if (wasReconnecting) {
        void resyncAfterReconnect();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
          if (!line) continue;
          try {
            handleServerEvent(JSON.parse(line.slice(6)));
          } catch (e) {
            console.warn(e);
          }
        }
      }
      // Server closed the stream cleanly — retry.
      connected = false;
      scheduleReconnect();
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      connected = false;
      scheduleReconnect();
    }
  })();
}

function handleServerEvent(event) {
  if (!event || !event.type) return;
  if (event.type === 'stream.message' && event.payload?.message) {
    const m = event.payload.message;
    if (activeSessionId && m.sessionId !== activeSessionId) return;
    if (!activeSessionId) activeSessionId = m.sessionId;
    const role = m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : 'system';
    appendMessage(role, textFromContent(m.content));
  }
  if (event.type === 'stream.partial' && event.payload?.sessionId === activeSessionId) {
    /* partial deltas omitted for simplicity */
  }
  if (event.type === 'permission.request') {
    pendingPermission = event.payload;
    $('permTitle').textContent = 'Autorisation : ' + event.payload.toolName;
    $('permTool').textContent = 'Session ' + event.payload.sessionId;
    $('permInput').textContent = JSON.stringify(event.payload.input, null, 2);
    $('permOverlay').classList.add('open');
  }
  if (event.type === 'permission.dismiss') {
    pendingPermission = null;
    $('permOverlay').classList.remove('open');
  }
  if (event.type === 'sudo.password.request') {
    pendingSudo = event.payload;
    $('sudoCmd').textContent = event.payload.command;
    $('sudoPassword').value = '';
    $('sudoOverlay').classList.add('open');
  }
  if (event.type === 'sudo.password.dismiss') {
    pendingSudo = null;
    $('sudoOverlay').classList.remove('open');
  }
  if (event.type === 'session.status' || event.type === 'session.update') {
    void loadSessions();
  }
  if (event.type === 'error' && event.payload?.message) {
    appendMessage('system', 'Erreur : ' + event.payload.message);
  }
}

async function sendMessage() {
  const prompt = $('prompt').value.trim();
  if (!prompt) return;
  $('prompt').value = '';
  appendMessage('user', prompt);
  if (!activeSessionId) {
    const data = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ prompt }) });
    activeSessionId = data.session?.id;
    await loadSessions();
    return;
  }
  await api('/api/sessions/' + encodeURIComponent(activeSessionId) + '/messages', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
}

async function enterApp() {
  localStorage.setItem(TOKEN_KEY, authToken);
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  connectEvents();
  await loadSessions();
}

$('connectBtn').onclick = async () => {
  authToken = $('token').value.trim();
  if (!authToken) return;
  try {
    await api('/api/health');
    await enterApp();
  } catch (e) {
    $('loginError').textContent = 'Connexion refusée : ' + e.message;
  }
};

$('sendBtn').onclick = () => void sendMessage();
$('prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
});
$('newSessionBtn').onclick = () => {
  activeSessionId = null;
  $('messages').innerHTML = '';
  closeDrawer();
  void loadSessions();
};

function openDrawer() {
  $('sessionList').classList.add('open');
  $('drawerBackdrop').classList.add('open');
}
function closeDrawer() {
  $('sessionList').classList.remove('open');
  $('drawerBackdrop').classList.remove('open');
}
$('menuBtn').onclick = () => {
  if ($('sessionList').classList.contains('open')) closeDrawer();
  else openDrawer();
};
$('drawerBackdrop').onclick = closeDrawer;

$('permAllow').onclick = () => void respondPermission('allow');
$('permAlways').onclick = () => void respondPermission('allow_always');
$('permDeny').onclick = () => void respondPermission('deny');

async function respondPermission(result) {
  if (!pendingPermission) return;
  await api('/api/permissions/' + encodeURIComponent(pendingPermission.toolUseId), {
    method: 'POST',
    body: JSON.stringify({ result }),
  });
  pendingPermission = null;
  $('permOverlay').classList.remove('open');
}

$('sudoSubmit').onclick = async () => {
  if (!pendingSudo) return;
  await api('/api/sudo/' + encodeURIComponent(pendingSudo.toolUseId), {
    method: 'POST',
    body: JSON.stringify({ password: $('sudoPassword').value }),
  });
  pendingSudo = null;
  $('sudoOverlay').classList.remove('open');
};
$('sudoCancel').onclick = async () => {
  if (!pendingSudo) return;
  await api('/api/sudo/' + encodeURIComponent(pendingSudo.toolUseId), {
    method: 'POST',
    body: JSON.stringify({ password: null }),
  });
  pendingSudo = null;
  $('sudoOverlay').classList.remove('open');
};

/* Reconnect immediately when the app comes back to the foreground or the
 * network returns — the exponential backoff timer may be far in the future. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && authToken && !$('app').classList.contains('hidden') && !connected) {
    reconnectDelayMs = 1000;
    connectEvents();
  }
});
window.addEventListener('online', () => {
  if (authToken && !$('app').classList.contains('hidden') && !connected) {
    reconnectDelayMs = 1000;
    connectEvents();
  }
});

/* QR pairing: /?token=… → validate, persist, then strip it from the URL. */
async function bootstrap() {
  const params = new URLSearchParams(location.search);
  const urlToken = (params.get('token') || '').trim();
  if (urlToken) {
    authToken = urlToken;
    history.replaceState(null, '', location.pathname);
  }
  if (authToken) {
    $('token').value = authToken;
    try {
      await api('/api/health');
      await enterApp();
      return;
    } catch {
      /* stale or invalid token — fall through to the login form */
    }
  }
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn(e));
}

void bootstrap();
