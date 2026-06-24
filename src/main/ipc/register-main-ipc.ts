/**
 * @module main/ipc/register-main-ipc
 */
import { registerClientShellIpc } from './ipc-client-shell';
import { registerConfigMcpIpc } from './ipc-config-mcp';
import { registerSkillsPluginsWindowIpc } from './ipc-skills-plugins-window';
import { registerSandboxLogsIpc } from './ipc-sandbox-logs';
import { registerRemoteScheduleMemoryIpc } from './ipc-remote-schedule-memory';

export function registerMainIpc(): void {
  registerClientShellIpc();
  registerConfigMcpIpc();
  registerSkillsPluginsWindowIpc();
  registerSandboxLogsIpc();
  registerRemoteScheduleMemoryIpc();
}
