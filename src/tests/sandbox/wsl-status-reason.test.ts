import { describe, expect, it } from 'vitest';
import { classifyWslError, describeWslUnavailableReason } from '../../main/sandbox/wsl-bridge';

describe('classifyWslError', () => {
  it('treats a missing wsl executable (ENOENT) as not-installed', () => {
    expect(classifyWslError({ code: 'ENOENT', message: 'spawn wsl ENOENT' })).toBe('not-installed');
  });

  it('treats a Windows "not recognized" error as not-installed', () => {
    expect(
      classifyWslError({ message: "'wsl' is not recognized as an internal or external command" })
    ).toBe('not-installed');
  });

  it('treats a timeout as not-ready (transient), not a missing install', () => {
    expect(classifyWslError({ killed: true, signal: 'SIGTERM', message: 'Command timed out' })).toBe(
      'not-ready'
    );
  });

  it('treats the WSL service error code as not-ready', () => {
    expect(classifyWslError({ message: 'Error: 0x8000ffff E_UNEXPECTED' })).toBe('not-ready');
  });

  it('defaults unknown errors to not-ready', () => {
    expect(classifyWslError(undefined)).toBe('not-ready');
    expect(classifyWslError({})).toBe('not-ready');
  });
});

describe('describeWslUnavailableReason', () => {
  it('does NOT tell the user to reinstall WSL2 on a cold start', () => {
    const message = describeWslUnavailableReason({ reason: 'not-ready' });
    expect(message).toMatch(/not responding yet/i);
    expect(message).not.toMatch(/wsl --install/);
  });

  it('guides toward installing a distro when none is registered', () => {
    const message = describeWslUnavailableReason({ reason: 'no-distro' });
    expect(message).toMatch(/no Linux distribution/i);
    expect(message).toMatch(/wsl --install -d/);
  });

  it('keeps the install guidance when WSL2 is genuinely absent', () => {
    expect(describeWslUnavailableReason({ reason: 'not-installed' })).toMatch(/wsl --install/);
  });

  it('falls back to the install guidance when the reason is unknown', () => {
    expect(describeWslUnavailableReason({})).toMatch(/WSL2 is not installed/);
  });
});
