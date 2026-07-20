/**
 * Reject slash commands that must not reach the model on the main process
 * (LAN chat, scheduled prompts, etc.). Client-only commands like /preset are
 * expanded in the renderer before send.
 */
import { mt } from '../i18n';
import {
  parseSlashCommand,
  type ParsedSlashCommand,
} from '../../shared/slash-commands';
import type { PluginSlashCommandInfo } from '../../shared/plugin-slash-commands';

export type MainSlashRejectionError = Error & { alreadyReportedToUser?: boolean };

function throwAlreadyReported(message: string): never {
  const error = new Error(message) as MainSlashRejectionError;
  error.alreadyReportedToUser = true;
  throw error;
}

function formatPresetCommand(parsed: Extract<ParsedSlashCommand, { kind: 'preset' }>): string {
  return parsed.name ? `/preset ${parsed.name}` : '/preset';
}

/**
 * Throws a localized, alreadyReportedToUser error for unknown or client-only
 * slash commands. Safe no-op for normal messages and supported builtins/plugins.
 */
export function assertMainProcessAcceptsSlashPrompt(
  prompt: string,
  pluginSlashCommands: readonly PluginSlashCommandInfo[] = []
): void {
  const slashParsed = parseSlashCommand(prompt.trim(), pluginSlashCommands);

  if (slashParsed.kind === 'unknown') {
    throwAlreadyReported(mt('errUnknownSlashCommand', { command: `/${slashParsed.token}` }));
  }

  if (slashParsed.kind === 'preset') {
    throwAlreadyReported(
      mt('errPresetSlashClientOnly', { command: formatPresetCommand(slashParsed) })
    );
  }
}
