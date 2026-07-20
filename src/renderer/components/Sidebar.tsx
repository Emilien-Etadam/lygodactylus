import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Moon,
  Sun,
  Monitor,
  Settings,
  Search as SearchIcon,
  Plus,
  ListChecks,
  Check,
  X,
  FolderPlus,
  Folder as FolderIcon,
} from 'lucide-react';
import type { ChatFolder, Session } from '../types';
import type { SessionMessageSearchHit } from '../../shared/session-message-search';
import {
  partitionSessionsByFolder,
  type SessionTreeNode,
} from '../utils/sidebar-session-tree';

import sidebarLogoSrc from '../assets/logo.png';

type SessionGroup = {
  key: string;
  label: string;
  sessions: Session[];
};

type SearchResultGroup = {
  sessionId: string;
  sessionTitle: string;
  folderName?: string;
  hits: SessionMessageSearchHit[];
};

type SessionContextMenuState = {
  sessionId: string;
  x: number;
  y: number;
};

type FolderContextMenuState = {
  folderId: string;
  x: number;
  y: number;
};

export function Sidebar() {
  const { t } = useTranslation();
  const sessions = useAppStore((s) => s.sessions);
  const folders = useAppStore((s) => s.folders);
  const setFolders = useAppStore((s) => s.setFolders);
  const updateSession = useAppStore((s) => s.updateSession);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const settings = useAppStore((s) => s.settings);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setMessages = useAppStore((s) => s.setMessages);
  const setTraceSteps = useAppStore((s) => s.setTraceSteps);
  const setScrollToMessageRequest = useAppStore((s) => s.setScrollToMessageRequest);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const isConfigured = useAppStore((s) => s.isConfigured);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const {
    deleteSession,
    batchDeleteSessions,
    getSessionMessages,
    getSessionTraceSteps,
    isElectron,
  } = useIPC();
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SessionMessageSearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<SessionContextMenuState | null>(null);
  const [folderMenu, setFolderMenu] = useState<FolderContextMenuState | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRequestIdRef = useRef(0);
  const folderById = useMemo(() => {
    const map = new Map<string, ChatFolder>();
    for (const folder of folders) {
      map.set(folder.id, folder);
    }
    return map;
  }, [folders]);

  const normalizedQuery = useMemo(() => searchQuery.trim(), [searchQuery]);
  const isSearchActive = normalizedQuery.length > 0;

  const filteredSessions = useMemo(() => {
    // While a full-text query is active, the session list is replaced by search results.
    if (isSearchActive) return [];
    return sessions;
  }, [sessions, isSearchActive]);

  const { folderTrees, rootNodes } = useMemo(
    () => partitionSessionsByFolder(filteredSessions, folders),
    [filteredSessions, folders]
  );

  const groupedRootSessions = useMemo(() => {
    const rootSessions = rootNodes.map((node) => node.session);
    return groupSessionsByDate(rootSessions, t);
  }, [rootNodes, t]);

  const rootNodesBySessionId = useMemo(() => {
    const map = new Map<string, SessionTreeNode>();
    for (const node of rootNodes) {
      map.set(node.session.id, node);
    }
    return map;
  }, [rootNodes]);

  const collectVisibleSessionIds = useCallback(
    (nodes: SessionTreeNode[]): string[] => {
      const ids: string[] = [];
      const walk = (list: SessionTreeNode[]) => {
        for (const node of list) {
          ids.push(node.session.id);
          if (node.children.length > 0) {
            walk(node.children);
          }
        }
      };
      walk(nodes);
      return ids;
    },
    []
  );

  const visibleSessionIds = useMemo(() => {
    const ids: string[] = [];
    for (const { folder, nodes } of folderTrees) {
      if (folder.collapsed) continue;
      ids.push(...collectVisibleSessionIds(nodes));
    }
    ids.push(...collectVisibleSessionIds(rootNodes));
    return ids;
  }, [collectVisibleSessionIds, folderTrees, rootNodes]);

  const groupedSearchResults = useMemo((): SearchResultGroup[] => {
    const groups = new Map<string, SearchResultGroup>();
    for (const hit of searchHits) {
      const existing = groups.get(hit.sessionId);
      if (existing) {
        existing.hits.push(hit);
      } else {
        const session = sessions.find((item) => item.id === hit.sessionId);
        const folderName =
          session?.folderId && folderById.has(session.folderId)
            ? folderById.get(session.folderId)?.name
            : undefined;
        groups.set(hit.sessionId, {
          sessionId: hit.sessionId,
          sessionTitle: hit.sessionTitle || t('sidebar.searchUntitled'),
          folderName,
          hits: [hit],
        });
      }
    }
    return Array.from(groups.values());
  }, [folderById, searchHits, sessions, t]);

  // Debounced full-text search across all conversations.
  useEffect(() => {
    if (!isSearchActive) {
      setSearchHits([]);
      setIsSearching(false);
      return;
    }

    if (!isElectron || !window.electronAPI?.session?.searchMessages) {
      // Fallback: local title filter when IPC is unavailable.
      const q = normalizedQuery.toLowerCase();
      setSearchHits(
        sessions
          .filter((session) => session.title.toLowerCase().includes(q))
          .map((session) => ({
            sessionId: session.id,
            sessionTitle: session.title,
            messageId: null,
            role: null,
            timestamp: session.updatedAt || session.createdAt,
            excerpt: session.title,
            highlights: [],
          }))
      );
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const requestId = ++searchRequestIdRef.current;
    const timer = window.setTimeout(() => {
      void window.electronAPI.session
        .searchMessages({ query: normalizedQuery, limit: 40 })
        .then((hits) => {
          if (requestId !== searchRequestIdRef.current) return;
          setSearchHits(Array.isArray(hits) ? hits : []);
        })
        .catch((error: unknown) => {
          console.error('[Sidebar] Conversation search failed:', error);
          if (requestId !== searchRequestIdRef.current) return;
          setSearchHits([]);
        })
        .finally(() => {
          if (requestId === searchRequestIdRef.current) {
            setIsSearching(false);
          }
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [isElectron, isSearchActive, normalizedQuery, sessions]);

  // Exit select mode when sidebar collapses
  useEffect(() => {
    if (sidebarCollapsed && isSelectMode) {
      setIsSelectMode(false);
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    }
  }, [sidebarCollapsed, isSelectMode]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchHits([]);
    setIsSearching(false);
  }, []);

  // Escape clears search first, otherwise exits select mode.
  // Ctrl/Cmd+Shift+F focuses the conversation search field.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (sidebarCollapsed) {
          toggleSidebar();
        }
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }

      if (e.key === 'Escape') {
        if (isSearchActive) {
          clearSearch();
          searchInputRef.current?.blur();
          return;
        }
        if (isSelectMode) {
          setIsSelectMode(false);
          setSelectedIds(new Set());
          setShowDeleteConfirm(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSearch, isSearchActive, isSelectMode, sidebarCollapsed, toggleSidebar]);

  // Reset selection when search query changes to avoid deleting hidden sessions
  useEffect(() => {
    if (isSelectMode) {
      setSelectedIds(new Set());
    }
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
  }, []);

  const toggleSelectSession = useCallback((sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const allVisibleSelected =
    visibleSessionIds.length > 0 && visibleSessionIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = useCallback(() => {
    if (allVisibleSelected) {
      // Deselect all visible, keep others
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleSessionIds) {
          next.delete(id);
        }
        return next;
      });
    } else {
      // Select all visible, keep existing selections
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleSessionIds) {
          next.add(id);
        }
        return next;
      });
    }
  }, [allVisibleSelected, visibleSessionIds]);

  const handleBatchDelete = useCallback(() => {
    const visibleSet = new Set(visibleSessionIds);
    const ids = Array.from(selectedIds).filter((id) => visibleSet.has(id));
    if (ids.length === 0) return;
    batchDeleteSessions(ids);
    exitSelectMode();
  }, [selectedIds, visibleSessionIds, batchDeleteSessions, exitSelectMode]);

  const handleSessionClick = useCallback(
    async (sessionId: string, messageId?: string | null) => {
      setShowSettings(false);

      const switching = activeSessionId !== sessionId;
      if (switching) {
        setActiveSession(sessionId);
      }

      // Read sessionStates at call-time from the store rather than closing over
      // the selector value. The selector returns a new object reference every
      // time any session's state changes (patchSession spreads the whole map),
      // so including it in deps would rebuild this callback on every streaming
      // tick and cause a React #185 "Maximum update depth exceeded" loop when
      // rapidly switching sessions on slow renderers (e.g. Windows).
      const currentSessionStates = useAppStore.getState().sessionStates;

      const existingMessages = currentSessionStates[sessionId]?.messages;
      if ((!existingMessages || existingMessages.length === 0) && isElectron) {
        try {
          const messages = await getSessionMessages(sessionId);
          if (messages && messages.length > 0) {
            setMessages(sessionId, messages);
          }
        } catch (error) {
          console.error('[Sidebar] Failed to load messages:', error);
        }
      }

      const existingSteps = currentSessionStates[sessionId]?.traceSteps;
      if ((!existingSteps || existingSteps.length === 0) && isElectron) {
        try {
          const steps = await getSessionTraceSteps(sessionId);
          setTraceSteps(sessionId, steps || []);
        } catch (error) {
          console.error('[Sidebar] Failed to load trace steps:', error);
        }
      }

      if (messageId) {
        setScrollToMessageRequest({ sessionId, messageId });
      }
    },
    [
      activeSessionId,
      getSessionMessages,
      getSessionTraceSteps,
      isElectron,
      setActiveSession,
      setMessages,
      setScrollToMessageRequest,
      setShowSettings,
      setTraceSteps,
    ]
  );

  const handleNewSession = () => {
    setActiveSession(null);
    setShowSettings(false);
  };

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteSession(sessionId);
  };

  const closeMenus = useCallback(() => {
    setSessionMenu(null);
    setFolderMenu(null);
  }, []);

  useEffect(() => {
    if (!sessionMenu && !folderMenu) return;
    const onPointerDown = () => closeMenus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenus();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeMenus, folderMenu, sessionMenu]);

  const refreshFoldersFromApi = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.folders?.list) return;
    try {
      const next = await window.electronAPI.folders.list();
      if (Array.isArray(next)) {
        setFolders(next);
      }
    } catch (error) {
      console.error('[Sidebar] Failed to list folders:', error);
    }
  }, [isElectron, setFolders]);

  useEffect(() => {
    void refreshFoldersFromApi();
  }, [refreshFoldersFromApi]);

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || !isElectron || !window.electronAPI?.folders?.create) {
      setIsCreatingFolder(false);
      setNewFolderName('');
      return;
    }
    try {
      const folder = await window.electronAPI.folders.create({ name });
      setFolders([...folders, folder].sort((a, b) => a.position - b.position));
    } catch (error) {
      console.error('[Sidebar] Failed to create folder:', error);
    } finally {
      setIsCreatingFolder(false);
      setNewFolderName('');
    }
  }, [folders, isElectron, newFolderName, setFolders]);

  const handleToggleFolderCollapsed = useCallback(
    async (folder: ChatFolder) => {
      const nextCollapsed = !folder.collapsed;
      setFolders(
        folders.map((item) =>
          item.id === folder.id ? { ...item, collapsed: nextCollapsed } : item
        )
      );
      if (!isElectron || !window.electronAPI?.folders?.update) return;
      try {
        await window.electronAPI.folders.update(folder.id, { collapsed: nextCollapsed });
      } catch (error) {
        console.error('[Sidebar] Failed to toggle folder:', error);
        void refreshFoldersFromApi();
      }
    },
    [folders, isElectron, refreshFoldersFromApi, setFolders]
  );

  const handleRenameFolder = useCallback(async () => {
    if (!renamingFolderId) return;
    const name = renameFolderValue.trim();
    if (!name || !isElectron || !window.electronAPI?.folders?.update) {
      setRenamingFolderId(null);
      setRenameFolderValue('');
      return;
    }
    try {
      const updated = await window.electronAPI.folders.update(renamingFolderId, { name });
      if (updated) {
        setFolders(folders.map((item) => (item.id === updated.id ? updated : item)));
      }
    } catch (error) {
      console.error('[Sidebar] Failed to rename folder:', error);
    } finally {
      setRenamingFolderId(null);
      setRenameFolderValue('');
    }
  }, [folders, isElectron, renameFolderValue, renamingFolderId, setFolders]);

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      if (!isElectron || !window.electronAPI?.folders?.delete) return;
      try {
        const result = await window.electronAPI.folders.delete(folderId);
        if (result?.success) {
          setFolders(folders.filter((item) => item.id !== folderId));
          for (const session of sessions) {
            if (session.folderId === folderId) {
              updateSession(session.id, { folderId: null });
            }
          }
        }
      } catch (error) {
        console.error('[Sidebar] Failed to delete folder:', error);
      } finally {
        closeMenus();
      }
    },
    [closeMenus, folders, isElectron, sessions, setFolders, updateSession]
  );

  const handleAssignSessionFolder = useCallback(
    async (sessionId: string, folderId: string | null) => {
      if (!isElectron || !window.electronAPI?.folders?.assign) return;
      try {
        const result = await window.electronAPI.folders.assign({ sessionId, folderId });
        if (result?.success) {
          updateSession(sessionId, { folderId });
        }
      } catch (error) {
        console.error('[Sidebar] Failed to assign session folder:', error);
      } finally {
        closeMenus();
      }
    },
    [closeMenus, isElectron, updateSession]
  );

  const toggleTheme = () => {
    const next =
      settings.theme === 'dark' ? 'light' : settings.theme === 'light' ? 'system' : 'dark';
    updateSettings({ theme: next });
  };

  const themeIcon =
    settings.theme === 'dark' ? (
      <Sun className="w-4 h-4" />
    ) : settings.theme === 'light' ? (
      <Moon className="w-4 h-4" />
    ) : (
      <Monitor className="w-4 h-4" />
    );

  if (sidebarCollapsed) {
    return (
      <aside className="w-[4.05rem] bg-surface/96 border-r border-border-muted flex flex-col overflow-hidden">
        <div className="px-3 pt-4 pb-3 flex flex-col items-center gap-2 border-b border-border-muted">
          <button
            onClick={toggleSidebar}
            className="w-9 h-9 rounded-2xl flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
            title={t('context.expandPanel')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={handleNewSession}
            className="w-9 h-9 rounded-2xl flex items-center justify-center bg-background hover:bg-surface-hover transition-colors text-text-primary border border-border-subtle"
            title={t('sidebar.newTask')}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-3 py-4">
          <button
            onClick={toggleSidebar}
            className="rounded-2xl px-2 py-3 text-[11px] leading-4 text-center text-text-muted hover:bg-surface-hover transition-colors"
            title={t('sidebar.expandToView')}
          >
            {t('sidebar.expandToView')}
          </button>
        </div>

        <div className="px-3 py-3 border-t border-border-muted flex flex-col items-center gap-2">
          <button
            onClick={toggleTheme}
            className="w-9 h-9 rounded-2xl flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
            title={t('sidebar.themeToggle')}
          >
            {themeIcon}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="w-9 h-9 rounded-2xl flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary relative"
            title={t('sidebar.settings')}
          >
            <Settings className="w-4 h-4" />
            {!isConfigured && (
              <span className="absolute right-2 top-2 w-1.5 h-1.5 rounded-full bg-accent" />
            )}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[15.75rem] bg-surface/96 border-r border-border-muted flex flex-col overflow-hidden">
      <div className="px-4 pt-5 pb-4 border-b border-border-muted">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <img
              src={sidebarLogoSrc}
              alt={t('common.appLogoAlt')}
              className="w-10 h-10 rounded-2xl object-cover border border-border-subtle bg-background/60 flex-shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-[1.34rem] leading-none font-semibold tracking-[-0.035em] text-text-primary">
                Lygodactylus
              </h1>
            </div>
          </div>
          <button
            onClick={toggleSidebar}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary flex-shrink-0"
            title={t('context.collapsePanel')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={handleNewSession}
            className="flex-1 flex items-center gap-2 rounded-xl bg-background/60 px-3 py-2 text-left text-text-primary hover:bg-surface-hover transition-colors"
          >
            <Plus className="w-4 h-4 text-text-secondary flex-shrink-0" />
            <span className="text-[13px] font-medium">{t('sidebar.newTask')}</span>
          </button>
          {isElectron && window.electronAPI?.folders && (
            <button
              type="button"
              onClick={() => {
                setIsCreatingFolder(true);
                setNewFolderName('');
              }}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors flex-shrink-0"
              title={t('sidebar.newFolder')}
              aria-label={t('sidebar.newFolder')}
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          )}
        </div>
        {isCreatingFolder && (
          <div className="mt-2 flex items-center gap-1.5">
            <input
              autoFocus
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateFolder();
                if (e.key === 'Escape') {
                  setIsCreatingFolder(false);
                  setNewFolderName('');
                }
              }}
              placeholder={t('sidebar.folderNamePlaceholder')}
              className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleCreateFolder()}
              className="px-2 py-1.5 rounded-lg text-[12px] font-medium bg-accent text-white"
            >
              {t('common.add')}
            </button>
          </div>
        )}

        {sessions.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('sidebar.search')}
                aria-label={t('sidebar.search')}
                className="w-full rounded-xl border border-transparent bg-background/50 pl-9 pr-8 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border focus:bg-background transition-colors"
              />
              {isSearchActive && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary"
                  title={t('sidebar.searchClear')}
                  aria-label={t('sidebar.searchClear')}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button
              onClick={() => {
                if (isSelectMode) {
                  exitSelectMode();
                } else {
                  setIsSelectMode(true);
                }
              }}
              className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                isSelectMode
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }`}
              title={t('sidebar.manage')}
            >
              <ListChecks className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {isSearchActive ? (
          isSearching ? (
            <div className="px-3 py-6">
              <p className="text-sm text-text-secondary">{t('sidebar.searchSearching')}</p>
            </div>
          ) : groupedSearchResults.length === 0 ? (
            <div className="px-3 py-6">
              <p className="text-sm text-text-secondary">{t('sidebar.searchNoResults')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groupedSearchResults.map((group) => (
                <section key={group.sessionId}>
                  <div className="px-3 pb-1 text-[11px] font-medium tracking-[0.04em] text-text-muted truncate">
                    {group.sessionTitle}
                  </div>
                  {group.folderName ? (
                    <div className="px-3 pb-2 text-[10px] text-text-muted/80 truncate">
                      {group.folderName}
                    </div>
                  ) : (
                    <div className="pb-1" />
                  )}
                  <div className="space-y-0.5">
                    {group.hits.map((hit, index) => {
                      const isActive = activeSessionId === hit.sessionId;
                      return (
                        <button
                          type="button"
                          key={`${hit.sessionId}:${hit.messageId ?? 'title'}:${index}`}
                          onClick={() => {
                            void handleSessionClick(hit.sessionId, hit.messageId);
                          }}
                          className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors ${
                            isActive ? 'bg-surface-hover/80' : 'hover:bg-surface-hover/60'
                          }`}
                        >
                          <div className="text-[11px] text-text-muted mb-0.5">
                            {hit.messageId
                              ? hit.role === 'assistant'
                                ? t('sidebar.searchRoleAssistant')
                                : t('sidebar.searchRoleUser')
                              : t('sidebar.searchTitleMatch')}
                          </div>
                          <HighlightedExcerpt
                            excerpt={hit.excerpt}
                            highlights={hit.highlights}
                          />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : folders.length === 0 && groupedRootSessions.length === 0 ? (
          <div className="px-3 py-6">
            <p className="text-sm text-text-secondary">{t('sidebar.noTasks')}</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t('sidebar.noTasksHint')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {folderTrees.map(({ folder, nodes }) => (
              <section key={folder.id}>
                <div
                  className="flex items-center gap-1 px-2 pb-1.5 group/folder"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setFolderMenu({ folderId: folder.id, x: e.clientX, y: e.clientY });
                    setSessionMenu(null);
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void handleToggleFolderCollapsed(folder)}
                    className="flex-1 min-w-0 flex items-center gap-1.5 text-left rounded-md px-1 py-0.5 hover:bg-surface-hover/50 transition-colors"
                    title={
                      folder.collapsed ? t('sidebar.expandFolder') : t('sidebar.collapseFolder')
                    }
                  >
                    {folder.collapsed ? (
                      <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0" />
                    )}
                    <FolderIcon className="w-3 h-3 text-text-muted flex-shrink-0" />
                    {renamingFolderId === folder.id ? (
                      <input
                        autoFocus
                        type="text"
                        value={renameFolderValue}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameFolderValue(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') void handleRenameFolder();
                          if (e.key === 'Escape') {
                            setRenamingFolderId(null);
                            setRenameFolderValue('');
                          }
                        }}
                        onBlur={() => void handleRenameFolder()}
                        className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-text-primary focus:outline-none"
                      />
                    ) : (
                      <span className="text-[11px] font-medium tracking-[0.04em] text-text-muted truncate">
                        {folder.name}
                      </span>
                    )}
                  </button>
                </div>
                {!folder.collapsed && (
                  <div className="space-y-0.5">
                    {nodes.length === 0 ? (
                      <p className="px-3 py-1 text-[11px] text-text-muted">
                        {t('sidebar.folderEmpty')}
                      </p>
                    ) : (
                      nodes.map((node) => (
                        <SessionTreeRows
                          key={node.session.id}
                          node={node}
                          depth={0}
                          activeSessionId={activeSessionId}
                          hoveredSession={hoveredSession}
                          isSelectMode={isSelectMode}
                          selectedIds={selectedIds}
                          onHover={setHoveredSession}
                          onSelectToggle={toggleSelectSession}
                          onOpen={(sessionId) => void handleSessionClick(sessionId)}
                          onDelete={handleDeleteSession}
                          onContextMenu={(sessionId, x, y) => {
                            setSessionMenu({ sessionId, x, y });
                            setFolderMenu(null);
                          }}
                          t={t}
                        />
                      ))
                    )}
                  </div>
                )}
              </section>
            ))}

            {groupedRootSessions.map((group) => (
              <section key={group.key}>
                <div className="px-3 pb-2 text-[11px] font-medium tracking-[0.04em] text-text-muted">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.sessions.map((session) => {
                    const node = rootNodesBySessionId.get(session.id);
                    if (!node) return null;
                    return (
                      <SessionTreeRows
                        key={session.id}
                        node={node}
                        depth={0}
                        activeSessionId={activeSessionId}
                        hoveredSession={hoveredSession}
                        isSelectMode={isSelectMode}
                        selectedIds={selectedIds}
                        onHover={setHoveredSession}
                        onSelectToggle={toggleSelectSession}
                        onOpen={(sessionId) => void handleSessionClick(sessionId)}
                        onDelete={handleDeleteSession}
                        onContextMenu={(sessionId, x, y) => {
                          setSessionMenu({ sessionId, x, y });
                          setFolderMenu(null);
                        }}
                        t={t}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {sessionMenu && isElectron && window.electronAPI?.folders && (
        <div
          className="fixed z-50 min-w-[11rem] rounded-lg border border-border bg-surface shadow-lg py-1"
          style={{ left: sessionMenu.x, top: sessionMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.06em] text-text-muted">
            {t('sidebar.moveToFolder')}
          </div>
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-hover"
            onClick={() => void handleAssignSessionFolder(sessionMenu.sessionId, null)}
          >
            {t('sidebar.noFolder')}
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="w-full px-3 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-hover truncate"
              onClick={() => void handleAssignSessionFolder(sessionMenu.sessionId, folder.id)}
            >
              {folder.name}
            </button>
          ))}
        </div>
      )}

      {folderMenu && isElectron && window.electronAPI?.folders && (
        <div
          className="fixed z-50 min-w-[10rem] rounded-lg border border-border bg-surface shadow-lg py-1"
          style={{ left: folderMenu.x, top: folderMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-hover"
            onClick={() => {
              const folder = folderById.get(folderMenu.folderId);
              setRenamingFolderId(folderMenu.folderId);
              setRenameFolderValue(folder?.name ?? '');
              closeMenus();
            }}
          >
            {t('sidebar.renameFolder')}
          </button>
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-[12px] text-error hover:bg-surface-hover"
            onClick={() => void handleDeleteFolder(folderMenu.folderId)}
          >
            {t('sidebar.deleteFolder')}
          </button>
        </div>
      )}

      {isSelectMode ? (
        <div className="px-3 py-3 border-t border-border-muted">
          {showDeleteConfirm ? (
            <div className="border border-error/30 bg-error/10 rounded-lg px-3 py-3">
              <p className="text-[13px] text-text-primary mb-3">
                {t('sidebar.batchDeleteConfirm', { count: selectedIds.size })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[13px] font-medium text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  {t('sidebar.cancel')}
                </button>
                <button
                  onClick={handleBatchDelete}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-error text-white hover:bg-error/90 transition-colors"
                >
                  {t('sidebar.confirmDelete')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <button
                  onClick={toggleSelectAll}
                  className="text-[12px] font-medium text-accent hover:text-accent/80 transition-colors"
                >
                  {allVisibleSelected ? t('sidebar.deselectAll') : t('sidebar.selectAll')}
                </button>
                <span className="text-[12px] text-text-muted">
                  {t('sidebar.nSelected', { count: selectedIds.size })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={exitSelectMode}
                  className="flex-1 px-3 py-2 rounded-xl text-[13px] font-medium text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  {t('sidebar.cancel')}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={selectedIds.size === 0}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-error text-white hover:bg-error/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('common.delete')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="px-3 py-3 border-t border-border-muted">
          <div className="flex items-center gap-2 rounded-2xl bg-background/50 px-3 py-2.5">
            <button
              onClick={() => setShowSettings(true)}
              className="flex-1 min-w-0 flex items-center gap-2 text-left text-text-secondary hover:text-text-primary transition-colors"
            >
              <Settings className="w-4 h-4 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-text-primary">
                  {t('sidebar.settings')}
                </div>
                <div className="text-[11px] text-text-muted truncate">
                  {isConfigured ? t('sidebar.apiConfigured') : t('sidebar.apiNotConfigured')}
                </div>
              </div>
            </button>

            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors flex-shrink-0"
              title={t('sidebar.themeToggle')}
            >
              {themeIcon}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function SessionTreeRows({
  node,
  depth,
  activeSessionId,
  hoveredSession,
  isSelectMode,
  selectedIds,
  onHover,
  onSelectToggle,
  onOpen,
  onDelete,
  onContextMenu,
  t,
}: {
  node: SessionTreeNode;
  depth: number;
  activeSessionId: string | null;
  hoveredSession: string | null;
  isSelectMode: boolean;
  selectedIds: Set<string>;
  onHover: (sessionId: string | null) => void;
  onSelectToggle: (sessionId: string) => void;
  onOpen: (sessionId: string) => void;
  onDelete: (e: React.MouseEvent, sessionId: string) => void;
  onContextMenu: (sessionId: string, x: number, y: number) => void;
  t: (key: string) => string;
}) {
  const session = node.session;
  const isActive = activeSessionId === session.id;
  const isSelected = selectedIds.has(session.id);
  const isSubChat = Boolean(session.parentSessionId);

  return (
    <>
      <div
        onClick={() => {
          if (isSelectMode) {
            onSelectToggle(session.id);
          } else {
            onOpen(session.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(session.id, e.clientX, e.clientY);
        }}
        onMouseEnter={() => onHover(session.id)}
        onMouseLeave={() => onHover(null)}
        className={`group relative cursor-pointer rounded-lg py-1.5 transition-colors ${
          isSelectMode && isSelected
            ? 'bg-accent-muted/20'
            : isActive && !isSelectMode
              ? 'bg-surface-hover/80'
              : 'hover:bg-surface-hover/60'
        }`}
        style={{ paddingLeft: `${10 + depth * 12}px`, paddingRight: '10px' }}
      >
        <div className={`flex items-center gap-2 ${!isSelectMode ? 'pr-6' : ''}`}>
          {isSelectMode && (
            <div
              className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                isSelected
                  ? 'bg-accent text-white'
                  : 'border border-border-muted bg-background'
              }`}
            >
              {isSelected && <Check className="w-2.5 h-2.5" />}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-5 text-text-primary truncate">
              {isSubChat ? (
                <span className="text-text-muted mr-1" aria-hidden="true">
                  {t('sidebar.subChatBadge')}
                </span>
              ) : null}
              {session.title}
            </div>
          </div>
        </div>

        {!isSelectMode && hoveredSession === session.id && (
          <button
            onClick={(e) => onDelete(e, session.id)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-text-muted hover:text-error hover:bg-surface-active transition-colors"
            title={t('common.delete')}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      {node.children.map((child) => (
        <SessionTreeRows
          key={child.session.id}
          node={child}
          depth={depth + 1}
          activeSessionId={activeSessionId}
          hoveredSession={hoveredSession}
          isSelectMode={isSelectMode}
          selectedIds={selectedIds}
          onHover={onHover}
          onSelectToggle={onSelectToggle}
          onOpen={onOpen}
          onDelete={onDelete}
          onContextMenu={onContextMenu}
          t={t}
        />
      ))}
    </>
  );
}

function HighlightedExcerpt({
  excerpt,
  highlights,
}: {
  excerpt: string;
  highlights: Array<[number, number]>;
}) {
  if (!excerpt) {
    return <div className="text-[12px] leading-4 text-text-muted">…</div>;
  }

  if (!highlights.length) {
    return (
      <div className="text-[12px] leading-4 text-text-secondary line-clamp-3 whitespace-pre-wrap">
        {excerpt}
      </div>
    );
  }

  const parts: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of highlights) {
    const safeStart = Math.max(0, Math.min(excerpt.length, start));
    const safeEnd = Math.max(safeStart, Math.min(excerpt.length, end));
    if (safeStart > cursor) {
      parts.push({ text: excerpt.slice(cursor, safeStart), hit: false });
    }
    if (safeEnd > safeStart) {
      parts.push({ text: excerpt.slice(safeStart, safeEnd), hit: true });
    }
    cursor = Math.max(cursor, safeEnd);
  }
  if (cursor < excerpt.length) {
    parts.push({ text: excerpt.slice(cursor), hit: false });
  }

  return (
    <div className="text-[12px] leading-4 text-text-secondary line-clamp-3 whitespace-pre-wrap">
      {parts.map((part, index) =>
        part.hit ? (
          <mark
            key={`${index}-${part.text}`}
            className="bg-accent/20 text-text-primary rounded-sm px-0.5"
          >
            {part.text}
          </mark>
        ) : (
          <span key={`${index}-${part.text}`}>{part.text}</span>
        )
      )}
    </div>
  );
}

function groupSessionsByDate(sessions: Session[], t: (key: string) => string): SessionGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfPreviousWeek = startOfToday - 7 * 86_400_000;

  const buckets: SessionGroup[] = [
    { key: 'today', label: t('sidebar.today'), sessions: [] },
    { key: 'yesterday', label: t('sidebar.yesterday'), sessions: [] },
    { key: 'previousWeek', label: t('sidebar.previousWeek'), sessions: [] },
    { key: 'older', label: t('sidebar.older'), sessions: [] },
  ];

  const sortedSessions = [...sessions].sort(
    (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
  );
  for (const session of sortedSessions) {
    const timestamp = session.updatedAt || session.createdAt;
    if (timestamp >= startOfToday) {
      buckets[0].sessions.push(session);
    } else if (timestamp >= startOfYesterday) {
      buckets[1].sessions.push(session);
    } else if (timestamp >= startOfPreviousWeek) {
      buckets[2].sessions.push(session);
    } else {
      buckets[3].sessions.push(session);
    }
  }

  return buckets.filter((bucket) => bucket.sessions.length > 0);
}
