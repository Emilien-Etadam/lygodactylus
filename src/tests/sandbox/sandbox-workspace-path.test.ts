import { describe, expect, it } from 'vitest';
import {
  extractWslDistro,
  resolveSandboxBashCwd,
  rewriteVirtualWorkspacePaths,
  shellEscapePosixPath,
  toWindowsReachablePath,
  wslUncPathToUnix,
  wslUnixPathToWindowsUnc,
} from '../../main/sandbox/sandbox-workspace-path';

describe('sandbox workspace path helpers', () => {
  const sandboxPath = '/home/ubuntu/.claude/sandbox/session-1';

  it('converts WSL unix paths to Windows UNC paths', () => {
    expect(wslUnixPathToWindowsUnc('Ubuntu-24.04', sandboxPath)).toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.claude\\sandbox\\session-1'
    );
  });

  it('converts Windows UNC paths back to unix paths', () => {
    expect(
      wslUncPathToUnix('\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.claude\\sandbox\\session-1')
    ).toBe(sandboxPath);
  });

  it('rewrites virtual /workspace references in shell commands', () => {
    expect(rewriteVirtualWorkspacePaths('ls /workspace && cat /workspace/a.txt', sandboxPath)).toBe(
      `ls ${sandboxPath} && cat ${sandboxPath}/a.txt`
    );
  });

  it('maps virtual cwd values to the sandbox root', () => {
    expect(resolveSandboxBashCwd('/workspace', sandboxPath)).toBe(sandboxPath);
    expect(resolveSandboxBashCwd('/workspace/src', sandboxPath)).toBe(`${sandboxPath}/src`);
    expect(
      resolveSandboxBashCwd(
        '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.claude\\sandbox\\session-1',
        sandboxPath
      )
    ).toBe(sandboxPath);
  });

  it('escapes posix shell paths safely', () => {
    expect(shellEscapePosixPath("/tmp/o'reilly")).toBe("/tmp/o'\\''reilly");
  });

  it('extracts the distro name from WSL UNC paths', () => {
    expect(extractWslDistro('\\\\wsl.localhost\\Ubuntu-24.04\\home\\pc')).toBe('Ubuntu-24.04');
    expect(extractWslDistro('\\\\wsl$\\Debian\\home')).toBe('Debian');
    expect(extractWslDistro('C:\\home\\pc')).toBeNull();
    expect(extractWslDistro('/home/pc')).toBeNull();
  });

  describe('toWindowsReachablePath', () => {
    it('rewrites a bare WSL unix path to UNC on Windows when a distro is known', () => {
      expect(toWindowsReachablePath('/home/pc/breve-ia.html', 'Ubuntu-24.04', 'win32')).toBe(
        '\\\\wsl.localhost\\Ubuntu-24.04\\home\\pc\\breve-ia.html'
      );
    });

    it('leaves the path unchanged when translation does not apply', () => {
      // no distro (sandbox off)
      expect(toWindowsReachablePath('/home/pc/x', null, 'win32')).toBe('/home/pc/x');
      // not on Windows
      expect(toWindowsReachablePath('/home/pc/x', 'Ubuntu', 'linux')).toBe('/home/pc/x');
      // already a Windows drive path
      expect(toWindowsReachablePath('C:\\home\\pc\\x', 'Ubuntu', 'win32')).toBe('C:\\home\\pc\\x');
      // already a UNC path
      expect(toWindowsReachablePath('\\\\wsl.localhost\\U\\x', 'Ubuntu', 'win32')).toBe(
        '\\\\wsl.localhost\\U\\x'
      );
      // relative path
      expect(toWindowsReachablePath('rel/x', 'Ubuntu', 'win32')).toBe('rel/x');
      // posix-style double-slash (not a plain WSL path)
      expect(toWindowsReachablePath('//server/share', 'Ubuntu', 'win32')).toBe('//server/share');
    });
  });
});
