/**
 * @module shared/firefox-extension
 *
 * Shared types for the one-click browser-extension install flow, referenced by
 * the main process (installer + IPC), the preload bridge, and the renderer.
 */

export type FirefoxExtensionInstallError =
  | 'no-release'
  | 'download-failed'
  | 'firefox-not-found'
  | 'choose-browser';

export interface FirefoxExtensionInstallResult {
  ok: boolean;
  error?: FirefoxExtensionInstallError;
  detail?: string;
  version?: string;
  xpiPath?: string;
  /** Id of the browser the .xpi was opened with (on success). */
  browser?: string;
  /** Candidate browsers when more than one is installed (choose-browser). */
  browsers?: { id: string; name: string }[];
}
