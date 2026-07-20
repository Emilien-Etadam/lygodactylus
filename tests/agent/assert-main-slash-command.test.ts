import { afterEach, describe, expect, it } from 'vitest';

import { assertMainProcessAcceptsSlashPrompt } from '../../src/main/agent/assert-main-slash-command';
import { DEFAULT_BACKEND_LANGUAGE, mt, setBackendLanguage } from '../../src/main/i18n';

afterEach(() => setBackendLanguage(DEFAULT_BACKEND_LANGUAGE));

describe('assertMainProcessAcceptsSlashPrompt', () => {
  it('rejects /preset on the main process with a localized alreadyReportedToUser error', () => {
    setBackendLanguage('fr');
    expect(() => assertMainProcessAcceptsSlashPrompt('/preset x')).toThrow(
      mt('errPresetSlashClientOnly', { command: '/preset x' })
    );

    try {
      assertMainProcessAcceptsSlashPrompt('/preset x');
      expect.unreachable('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error & { alreadyReportedToUser?: boolean }).alreadyReportedToUser).toBe(
        true
      );
      expect((error as Error).message).toContain('/preset x');
      expect((error as Error).message).not.toContain('{{command}}');
    }
  });

  it('rejects bare /preset the same way', () => {
    setBackendLanguage('en');
    expect(() => assertMainProcessAcceptsSlashPrompt('/preset')).toThrow(
      mt('errPresetSlashClientOnly', { command: '/preset' })
    );
  });

  it('still rejects unknown slash commands', () => {
    setBackendLanguage('en');
    expect(() => assertMainProcessAcceptsSlashPrompt('/not-a-real-command')).toThrow(
      mt('errUnknownSlashCommand', { command: '/not-a-real-command' })
    );
  });

  it('allows normal prompts through', () => {
    expect(() => assertMainProcessAcceptsSlashPrompt('Summarize the file')).not.toThrow();
  });
});
