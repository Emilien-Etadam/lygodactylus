/**
 * @module main/main-app-state
 *
 * Shared mutable main-process state accessed across window, IPC, and lifecycle modules.
 */
import type { BrowserWindow, Tray } from 'electron';
import type { SessionManager } from './session/session-manager';
import type { SkillsManager } from './skills/skills-manager';
import type { PluginRuntimeService } from './skills/plugin-runtime-service';
import type { MarketplaceService } from './catalog/marketplace-service';
import type { MemoryService } from './memory/memory-service';
import type { ScheduledTaskManager } from './schedule/scheduled-task-manager';
import type { WatchManager } from './watch/watch-manager';

export const mainAppState = {
  mainWindow: null as BrowserWindow | null,
  quickAskWindow: null as BrowserWindow | null,
  quickAskShortcutRegistered: false,
  quickAskShortcutError: null as string | null,
  quickAskSelectionShortcutRegistered: false,
  quickAskSelectionShortcutError: null as string | null,
  sessionManager: null as SessionManager | null,
  skillsManager: null as SkillsManager | null,
  pluginRuntimeService: null as PluginRuntimeService | null,
  marketplaceService: null as MarketplaceService | null,
  memoryService: null as MemoryService | null,
  scheduledTaskManager: null as ScheduledTaskManager | null,
  watchManager: null as WatchManager | null,
  tray: null as Tray | null,
  currentWorkingDir: null as string | null,
  isCleaningUp: false,
};
