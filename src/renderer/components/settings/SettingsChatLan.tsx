import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Loader2, Puzzle, QrCode, RefreshCw, Smartphone, Wifi } from 'lucide-react';
import QRCode from 'qrcode';

interface ChatLanConfig {
  enabled: boolean;
  port: number;
  token: string;
  extensionToken: string;
  publicUrl: string;
}

interface ChatLanStatus {
  running: boolean;
  port: number;
  enabled: boolean;
  urls: string[];
}

export function SettingsChatLan() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ChatLanConfig | null>(null);
  const [status, setStatus] = useState<ChatLanStatus | null>(null);
  const [portInput, setPortInput] = useState('19890');
  const [publicUrlInput, setPublicUrlInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isInstallingExtension, setIsInstallingExtension] = useState(false);
  const [extensionInstallError, setExtensionInstallError] = useState<string | null>(null);
  const [browserChoices, setBrowserChoices] = useState<{ id: string; name: string }[] | null>(null);
  const [isInstallingTb, setIsInstallingTb] = useState(false);
  const [tbInstallError, setTbInstallError] = useState<string | null>(null);
  const [tbBrowserChoices, setTbBrowserChoices] = useState<{ id: string; name: string }[] | null>(
    null
  );

  const refresh = useCallback(async () => {
    const [nextConfig, nextStatus] = await Promise.all([
      window.electronAPI.chatLan.getConfig(),
      window.electronAPI.chatLan.getStatus(),
    ]);
    setConfig(nextConfig);
    setStatus(nextStatus);
    setPortInput(String(nextConfig.port));
    setPublicUrlInput(nextConfig.publicUrl);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pairingUrls = useMemo(() => {
    const urls: string[] = [];
    if (config?.publicUrl) {
      urls.push(config.publicUrl + '/');
    }
    if (status?.running) {
      urls.push(...status.urls);
    }
    return urls;
  }, [config?.publicUrl, status]);

  useEffect(() => {
    if (pairingUrls.length > 0 && (!qrUrl || !pairingUrls.includes(qrUrl))) {
      setQrUrl(pairingUrls[0]);
    }
    if (pairingUrls.length === 0) {
      setQrUrl(null);
    }
  }, [pairingUrls, qrUrl]);

  useEffect(() => {
    if (!qrUrl || !config?.token) {
      setQrDataUrl(null);
      return;
    }
    const target = `${qrUrl}?token=${encodeURIComponent(config.token)}`;
    QRCode.toDataURL(target, { margin: 1, width: 220 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [qrUrl, config?.token]);

  const applyConfig = async (patch: { enabled?: boolean; port?: number; publicUrl?: string }) => {
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await window.electronAPI.chatLan.setConfig(patch);
      setConfig(result.config);
      setStatus(result.status);
      setMessage(t('chatLan.saved'));
    } catch {
      setMessage(t('common.error'));
    } finally {
      setIsSaving(false);
    }
  };

  const regenerateToken = async () => {
    setIsSaving(true);
    try {
      const result = await window.electronAPI.chatLan.regenerateToken();
      setConfig((current) => (current ? { ...current, token: result.token } : current));
      setStatus(result.status);
      setMessage(t('chatLan.tokenRegenerated'));
    } finally {
      setIsSaving(false);
    }
  };

  const regenerateExtensionToken = async () => {
    setIsSaving(true);
    try {
      const result = await window.electronAPI.chatLan.regenerateExtensionToken();
      setConfig((current) =>
        current ? { ...current, extensionToken: result.extensionToken } : current
      );
      setStatus(result.status);
      setMessage(t('chatLan.extensionTokenRegenerated'));
    } finally {
      setIsSaving(false);
    }
  };

  const copyToken = async () => {
    if (!config?.token) return;
    await navigator.clipboard.writeText(config.token);
    setMessage(t('chatLan.tokenCopied'));
  };

  const copyExtensionToken = async () => {
    if (!config?.extensionToken) return;
    await navigator.clipboard.writeText(config.extensionToken);
    setMessage(t('chatLan.extensionTokenCopied'));
  };

  const runInstall = async (target: 'firefox' | 'thunderbird', browserId?: string) => {
    const isFirefox = target === 'firefox';
    const invoke = isFirefox
      ? window.electronAPI.chatLan.installFirefoxExtension
      : window.electronAPI.chatLan.installThunderbirdExtension;
    const setInstalling = isFirefox ? setIsInstallingExtension : setIsInstallingTb;
    const setError = isFirefox ? setExtensionInstallError : setTbInstallError;
    const setChoices = isFirefox ? setBrowserChoices : setTbBrowserChoices;
    const notFoundKey = isFirefox
      ? 'chatLan.extensionInstallErrorFirefoxNotFound'
      : 'chatLan.extensionTbInstallErrorNotFound';
    const startedKey = isFirefox
      ? 'chatLan.extensionInstallStarted'
      : 'chatLan.extensionTbInstallStarted';

    setInstalling(true);
    setMessage(null);
    setError(null);
    setChoices(null);
    try {
      const result = await invoke(browserId);
      if (result.ok) {
        if (config?.extensionToken) {
          await navigator.clipboard.writeText(config.extensionToken);
        }
        setMessage(t(startedKey));
      } else if (result.error === 'choose-browser') {
        setChoices(result.browsers ?? []);
      } else if (result.error === 'firefox-not-found') {
        setError(result.detail ? `${t(notFoundKey)} (${result.detail})` : t(notFoundKey));
      } else if (result.error === 'no-release') {
        setError(t('chatLan.extensionInstallErrorNoRelease'));
      } else {
        setError(t('chatLan.extensionInstallErrorDownload'));
      }
    } catch {
      setError(t('chatLan.extensionInstallErrorDownload'));
    } finally {
      setInstalling(false);
    }
  };

  const installFirefoxExtension = (browserId?: string) => runInstall('firefox', browserId);
  const installThunderbirdExtension = (browserId?: string) => runInstall('thunderbird', browserId);

  if (!config) {
    return (
      <div className="flex items-center gap-2 text-text-muted py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-4 py-5 border-b border-border-muted">
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Wifi className="w-4 h-4" />
          {t('chatLan.title')}
        </label>
        <p className="mt-1 text-xs leading-5 text-text-muted">{t('chatLan.description')}</p>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={config.enabled}
          disabled={isSaving}
          onChange={(e) => void applyConfig({ enabled: e.target.checked })}
          className="rounded border-border"
        />
        <span className="text-sm text-text-primary">{t('chatLan.enable')}</span>
      </label>

      <div className="grid gap-2 max-w-md">
        <label className="text-xs text-text-muted">{t('chatLan.port')}</label>
        <div className="flex gap-2">
          <input
            type="number"
            min={1024}
            max={65535}
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-text-primary"
          />
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void applyConfig({ port: Number(portInput) })}
            className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium"
          >
            {t('common.save')}
          </button>
        </div>
      </div>

      <div className="space-y-2 max-w-xl">
        <label className="text-xs text-text-muted">{t('chatLan.token')}</label>
        <div className="flex gap-2">
          <input
            readOnly
            value={config.token}
            className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-text-primary font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => void copyToken()}
            className="p-2 rounded-lg border border-border"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void regenerateToken()}
            className="p-2 rounded-lg border border-border"
            title={t('chatLan.regenerateToken')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="space-y-2 max-w-xl">
        <label className="text-xs text-text-muted">{t('chatLan.extensionToken')}</label>
        <div className="flex gap-2">
          <input
            readOnly
            value={config.extensionToken}
            className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-text-primary font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => void copyExtensionToken()}
            className="p-2 rounded-lg border border-border"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void regenerateExtensionToken()}
            className="p-2 rounded-lg border border-border"
            title={t('chatLan.regenerateExtensionToken')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border-muted bg-background-secondary/50 p-3 space-y-2 max-w-xl">
        <p className="text-xs font-medium text-text-primary flex items-center gap-1.5">
          <Puzzle className="w-3.5 h-3.5" />
          {t('chatLan.extensionInstallTitle')}
        </p>
        <p className="text-[11px] text-text-muted">{t('chatLan.extensionInstallHint')}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isInstallingExtension}
            onClick={() => void installFirefoxExtension()}
            className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium flex items-center gap-2"
          >
            {isInstallingExtension && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('chatLan.extensionInstallButton')}
          </button>
          <button
            type="button"
            onClick={() =>
              void window.electronAPI.openExternal(
                'https://github.com/Emilien-Etadam/lygodactylus/releases'
              )
            }
            className="px-3 py-2 rounded-lg border border-border text-sm text-text-primary"
          >
            {t('chatLan.extensionInstallOpenReleases')}
          </button>
        </div>
        {browserChoices && browserChoices.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-text-muted">{t('chatLan.extensionChooseBrowser')}</p>
            <div className="flex flex-wrap gap-2">
              {browserChoices.map((browser) => (
                <button
                  key={browser.id}
                  type="button"
                  disabled={isInstallingExtension}
                  onClick={() => void installFirefoxExtension(browser.id)}
                  className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-primary"
                >
                  {browser.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {extensionInstallError && (
          <p className="text-xs text-red-500 break-all">{extensionInstallError}</p>
        )}
      </div>

      <div className="rounded-lg border border-border-muted bg-background-secondary/50 p-3 space-y-2 max-w-xl">
        <p className="text-xs font-medium text-text-primary flex items-center gap-1.5">
          <Puzzle className="w-3.5 h-3.5" />
          {t('chatLan.extensionTbInstallTitle')}
        </p>
        <p className="text-[11px] text-text-muted">{t('chatLan.extensionTbInstallHint')}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isInstallingTb}
            onClick={() => void installThunderbirdExtension()}
            className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium flex items-center gap-2"
          >
            {isInstallingTb && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('chatLan.extensionTbInstallButton')}
          </button>
        </div>
        <p className="text-[11px] text-text-muted">{t('chatLan.extensionTbSignatureNote')}</p>
        {tbBrowserChoices && tbBrowserChoices.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-text-muted">{t('chatLan.extensionChooseBrowser')}</p>
            <div className="flex flex-wrap gap-2">
              {tbBrowserChoices.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  disabled={isInstallingTb}
                  onClick={() => void installThunderbirdExtension(client.id)}
                  className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-primary"
                >
                  {client.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {tbInstallError && <p className="text-xs text-red-500 break-all">{tbInstallError}</p>}
      </div>

      <div className="grid gap-2 max-w-xl">
        <label className="text-xs text-text-muted">{t('chatLan.publicUrl')}</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={publicUrlInput}
            onChange={(e) => setPublicUrlInput(e.target.value)}
            placeholder="https://chat.example.com"
            className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-text-primary font-mono text-xs"
          />
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void applyConfig({ publicUrl: publicUrlInput })}
            className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium"
          >
            {t('common.save')}
          </button>
        </div>
        <p className="text-[11px] text-text-muted">{t('chatLan.publicUrlHint')}</p>
      </div>

      {status?.running && status.urls.length > 0 && (
        <div className="rounded-lg border border-border-muted bg-background-secondary/50 p-3 space-y-1">
          <p className="text-xs font-medium text-text-primary">{t('chatLan.urls')}</p>
          {status.urls.map((url) => (
            <p key={url} className="text-xs font-mono text-accent break-all">
              {url}
            </p>
          ))}
          <p className="text-[11px] text-text-muted pt-1">{t('chatLan.wireguardHint')}</p>
        </div>
      )}

      {pairingUrls.length > 0 && config.token && (
        <div className="rounded-lg border border-border-muted bg-background-secondary/50 p-3 space-y-2">
          <p className="text-xs font-medium text-text-primary flex items-center gap-1.5">
            <QrCode className="w-3.5 h-3.5" />
            {t('chatLan.qrTitle')}
          </p>
          {pairingUrls.length > 1 && (
            <select
              value={qrUrl ?? ''}
              onChange={(e) => setQrUrl(e.target.value)}
              className="w-full max-w-sm px-2 py-1.5 rounded-lg bg-background border border-border text-text-primary font-mono text-xs"
            >
              {pairingUrls.map((url) => (
                <option key={url} value={url}>
                  {url}
                </option>
              ))}
            </select>
          )}
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt={t('chatLan.qrTitle')}
              className="rounded-lg bg-white p-1 w-[180px] h-[180px]"
            />
          )}
          <p className="text-[11px] text-text-muted">{t('chatLan.qrHint')}</p>
          <p className="text-[11px] text-text-muted flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            {t('chatLan.installHint')}
          </p>
        </div>
      )}

      {message && <p className="text-xs text-text-muted">{message}</p>}
    </div>
  );
}
