/**
 * @module main/chat-lan-server/chat-lan-event-bus
 */
import type { ServerEvent } from '../../renderer/types';
import { redactSecrets } from './chat-lan-redact';

/**
 * ServerEvents mirrored to LAN clients over SSE. Covers everything the React
 * renderer consumes on the chat path (streaming, traces, sessions, prompts,
 * context/memory info, plugin command refreshes). Desktop-only events
 * (navigate, new-session from tray/menu, update.checkResult, sandbox.*) are
 * intentionally excluded.
 */
const CHAT_LAN_EVENT_TYPES = new Set<ServerEvent['type']>([
  'stream.message',
  'stream.partial',
  'stream.thinking',
  'stream.executionTime',
  'session.status',
  'session.update',
  'session.list',
  'session.notice',
  'session.contextInfo',
  'session.memoryContext',
  'trace.step',
  'trace.update',
  'permission.request',
  'permission.dismiss',
  'question.request',
  'question.dismiss',
  'sudo.password.request',
  'sudo.password.dismiss',
  'folder.selected',
  'workdir.changed',
  'config.status',
  'native-theme.changed',
  'plugins.commandsChanged',
  'plugins.runtimeApplied',
  'skills.storageChanged',
  'error',
]);

/** Event types whose payload may embed the full AppConfig (cleartext API keys). */
const EVENT_TYPES_WITH_SECRETS = new Set<ServerEvent['type']>(['config.status']);

type ChatLanListener = (event: ServerEvent) => void;

const listeners = new Set<ChatLanListener>();

export function subscribeChatLanEvents(listener: ChatLanListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function broadcastChatLanEvent(event: ServerEvent): void {
  if (!CHAT_LAN_EVENT_TYPES.has(event.type)) {
    return;
  }
  const safeEvent = EVENT_TYPES_WITH_SECRETS.has(event.type) ? redactSecrets(event) : event;
  for (const listener of listeners) {
    try {
      listener(safeEvent);
    } catch {
      /* ignore subscriber errors */
    }
  }
}
