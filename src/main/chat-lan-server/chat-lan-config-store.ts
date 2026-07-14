/**
 * @module main/chat-lan-server/chat-lan-config-store
 */
import * as crypto from 'crypto';
import Store from 'electron-store';
import { createAppEncryptedStore } from '../utils/app-store';

export interface ChatLanConfig {
  enabled: boolean;
  port: number;
  token: string;
  extensionToken: string;
  /** External HTTPS URL when the server sits behind a reverse proxy (e.g. Nginx Proxy Manager). */
  publicUrl: string;
}

const DEFAULT_PORT = 19890;

function generateToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

class ChatLanConfigStore {
  private store: Store<ChatLanConfig>;

  constructor() {
    this.store = createAppEncryptedStore<ChatLanConfig & Record<string, unknown>>({
      name: 'chat-lan-config',
      defaults: {
        enabled: false,
        port: DEFAULT_PORT,
        token: generateToken(),
        extensionToken: generateToken(),
        publicUrl: '',
      },
      logPrefix: '[ChatLanConfigStore]',
    }) as unknown as Store<ChatLanConfig>;

    if (!this.store.get('token')) {
      this.store.set('token', generateToken());
    }
    if (!this.store.get('extensionToken')) {
      this.store.set('extensionToken', generateToken());
    }
  }

  getAll(): ChatLanConfig {
    return {
      enabled: Boolean(this.store.get('enabled')),
      port: Number(this.store.get('port')) || DEFAULT_PORT,
      token: String(this.store.get('token') || generateToken()),
      extensionToken: String(this.store.get('extensionToken') || generateToken()),
      publicUrl: String(this.store.get('publicUrl') || ''),
    };
  }

  setPublicUrl(publicUrl: string): void {
    const trimmed = publicUrl.trim().replace(/\/+$/, '');
    if (!trimmed) {
      this.store.set('publicUrl', '');
      return;
    }
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return;
      }
      this.store.set('publicUrl', trimmed);
    } catch {
      /* invalid URL — keep previous value */
    }
  }

  setEnabled(enabled: boolean): void {
    this.store.set('enabled', enabled);
  }

  setPort(port: number): void {
    const safe = Number.isFinite(port)
      ? Math.max(1024, Math.min(65535, Math.round(port)))
      : DEFAULT_PORT;
    this.store.set('port', safe);
  }

  regenerateToken(): string {
    const token = generateToken();
    this.store.set('token', token);
    return token;
  }

  regenerateExtensionToken(): string {
    const extensionToken = generateToken();
    this.store.set('extensionToken', extensionToken);
    return extensionToken;
  }
}

export const chatLanConfigStore = new ChatLanConfigStore();
