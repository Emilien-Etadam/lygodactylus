import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useActiveSessionId,
  useCurrentSession,
  useActiveSessionMessages,
  useActivePartialContent,
  useActiveTurn,
  usePendingTurns,
  useActiveExecutionClock,
  useAppConfig,
} from '../store/selectors';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { useChatAttachments } from '../hooks/useChatAttachments';
import { MessageCard } from './MessageCard';
import type { Message, ContentBlock, SessionMode } from '../types';
import { formatAttachmentSize } from '../../shared/long-paste';
import type { PluginSlashCommandInfo } from '../../shared/plugin-slash-commands';
import {
  parseSlashCommand,
  filterSlashCommands,
  getSlashCommandQuery,
  hasExactSlashCommandQuery,
  normalizePluginSlashPromptForExpansion,
  type SlashCommandDefinition,
} from '../../shared/slash-commands';
import { getAtMentionQuery, isAtMentionUrlQuery } from '../../shared/at-mentions';
import { buildPresetInsertionText, type PromptPreset } from '../../shared/prompt-presets';
import { SlashCommandMenu } from './SlashCommandMenu';
import { MentionMenu, type MentionSuggestion } from './MentionMenu';
import { PresetPickerDialog } from './PresetPickerDialog';
import { PresetVariableDialog } from './PresetVariableDialog';
import { ThinkingLevelToggle } from './ThinkingLevelToggle';
import { PlanActToggle } from './PlanActToggle';
import {
  Send,
  Square,
  Plus,
  Loader2,
  Plug,
  X,
  Clock,
  ChevronDown,
  StickyNote,
  FileText,
  Zap,
} from 'lucide-react';
import { MemoryContextBar } from './MemoryContextBar';
import { stopSpeechSynthesis } from '../utils/speech-synthesis';
import { computeTokensPerSecondFromText, formatTokensPerSecond } from '../utils/generation-stats';

export function ChatView() {
  const { t } = useTranslation();
  // Scoped selectors — each subscription only re-renders when its slice changes
  const activeSessionId = useActiveSessionId();
  const activeSession = useCurrentSession();
  const messages = useActiveSessionMessages();
  const { partialMessage, partialThinking } = useActivePartialContent();
  const activeTurn = useActiveTurn();
  const pendingTurns = usePendingTurns();
  const executionClock = useActiveExecutionClock();
  const appConfig = useAppConfig();
  const modelStatsEnabled = appConfig?.modelStatsEnabled !== false;
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const pluginCommandsRevision = useAppStore((s) => s.pluginCommandsRevision);
  const streamStartedAt = useAppStore((s) =>
    s.activeSessionId ? (s.sessionStates[s.activeSessionId]?.streamStartedAt ?? null) : null
  );
  const tokensPerSecondByMessageId = useAppStore((s) =>
    s.activeSessionId ? (s.sessionStates[s.activeSessionId]?.tokensPerSecondByMessageId ?? {}) : {}
  );
  const {
    continueSession,
    compactSession,
    handoffSession,
    forkSessionFromMessage,
    rewindSessionForEdit,
    stopSession,
    setSessionMemoryEnabled,
    setSessionMode,
    isElectron,
  } = useIPC();
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const memoryContextItems = useAppStore((state) =>
    activeSessionId ? (state.sessionStates[activeSessionId]?.memoryContextItems ?? []) : []
  );
  const globalMemoryEnabled = appConfig?.memoryEnabled !== false;
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeConnectors, setActiveConnectors] = useState<
    { id: string; name: string; connected: boolean; toolCount: number }[]
  >([]);
  const [showConnectorLabel, setShowConnectorLabel] = useState(true);
  const headerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const connectorMeasureRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleAttachmentNotice = useCallback(
    (notice: {
      id: string;
      type: 'info' | 'warning' | 'error';
      message: string;
      messageKey?: string;
    }) => {
      setGlobalNotice(notice);
    },
    [setGlobalNotice]
  );
  const {
    pastedImages,
    attachedFiles,
    setAttachedFiles,
    isDragging,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeImage,
    removeFile,
    clearAttachments,
    buildContentBlocks,
  } = useChatAttachments({
    isComposingRef,
    onNotice: handleAttachmentNotice,
    t,
  });
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const [slashHighlightIndex, setSlashHighlightIndex] = useState(0);
  const [pluginSlashCommands, setPluginSlashCommands] = useState<PluginSlashCommandInfo[]>([]);
  const [mentionMenuDismissed, setMentionMenuDismissed] = useState(false);
  const [mentionHighlightIndex, setMentionHighlightIndex] = useState(0);
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestion[]>([]);
  const workingDir = useAppStore((s) => s.workingDir);
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const [presetPickerItems, setPresetPickerItems] = useState<PromptPreset[]>([]);
  const [pendingPreset, setPendingPreset] = useState<PromptPreset | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const prevPartialLengthRef = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRequestRef = useRef<number | null>(null);
  const isScrollingRef = useRef(false);

  const hasActiveTurn = Boolean(activeTurn);
  const pendingCount = pendingTurns.length;
  const isSessionRunning = activeSession?.status === 'running';
  const canStop = isSessionRunning || hasActiveTurn || pendingCount > 0;
  const sessionMode: SessionMode = activeSession?.mode === 'plan' ? 'plan' : 'act';
  const showSwitchToAct =
    sessionMode === 'plan' && !canStop && messages.some((message) => message.role === 'assistant');

  const handleSessionModeChange = useCallback(
    (mode: SessionMode) => {
      if (!activeSession || canStop || mode === sessionMode) {
        return;
      }
      void setSessionMode(activeSession.id, mode);
    },
    [activeSession, canStop, sessionMode, setSessionMode]
  );

  const slashQuery = useMemo(() => {
    if (pastedImages.length > 0 || attachedFiles.length > 0) {
      return null;
    }
    return getSlashCommandQuery(prompt);
  }, [prompt, pastedImages.length, attachedFiles.length]);

  const slashSuggestions = useMemo(
    () => (slashQuery === null ? [] : filterSlashCommands(slashQuery, pluginSlashCommands)),
    [slashQuery, pluginSlashCommands]
  );

  const showSlashMenu = !slashMenuDismissed && slashQuery !== null && slashSuggestions.length > 0;

  const mentionQuery = useMemo(() => {
    if (showSlashMenu) {
      return null;
    }
    return getAtMentionQuery(prompt);
  }, [prompt, showSlashMenu]);

  const showMentionMenu =
    !mentionMenuDismissed &&
    mentionQuery !== null &&
    (mentionSuggestions.length > 0 || mentionQuery !== '');

  const insertPromptDraft = useCallback((nextPrompt: string) => {
    setPrompt(nextPrompt);
    if (textareaRef.current) {
      textareaRef.current.value = nextPrompt;
      textareaRef.current.focus();
      const end = nextPrompt.length;
      textareaRef.current.setSelectionRange(end, end);
    }
    setSlashMenuDismissed(false);
    setSlashHighlightIndex(0);
  }, []);

  const applySelectedPreset = useCallback(
    (preset: PromptPreset) => {
      setPresetPickerOpen(false);
      setPresetPickerItems([]);
      if (preset.variables.length === 0) {
        const platform =
          typeof window !== 'undefined' && window.electronAPI?.platform
            ? window.electronAPI.platform
            : undefined;
        insertPromptDraft(
          buildPresetInsertionText(preset, {}, platform ? { os: platform } : undefined)
        );
        setPendingPreset(null);
        return;
      }
      setPendingPreset(preset);
    },
    [insertPromptDraft]
  );

  const openPresetFlow = useCallback(
    async (name?: string) => {
      if (!isElectron || !window.electronAPI?.presets) {
        setGlobalNotice({
          id: `notice-presets-unavailable-${Date.now()}`,
          type: 'warning',
          message: t('presets.unavailable'),
          messageKey: 'presets.unavailable',
        });
        return;
      }

      try {
        if (name?.trim()) {
          const preset = await window.electronAPI.presets.getByName(name.trim());
          if (!preset) {
            setGlobalNotice({
              id: `notice-preset-missing-${Date.now()}`,
              type: 'warning',
              message: t('presets.notFound', { name: name.trim() }),
              messageKey: 'presets.notFound',
              messageValues: { name: name.trim() },
            });
            return;
          }
          applySelectedPreset(preset);
          return;
        }

        const presets = await window.electronAPI.presets.list();
        setPresetPickerItems(presets);
        setPresetPickerOpen(true);
      } catch {
        setGlobalNotice({
          id: `notice-presets-load-${Date.now()}`,
          type: 'warning',
          message: t('presets.loadFailed'),
          messageKey: 'presets.loadFailed',
        });
      }
    },
    [applySelectedPreset, isElectron, setGlobalNotice, t]
  );

  const applySlashCommand = useCallback(
    (definition: SlashCommandDefinition) => {
      if (definition.kind === 'builtin' && definition.id === 'preset') {
        setPrompt('');
        if (textareaRef.current) {
          textareaRef.current.value = '';
        }
        setSlashMenuDismissed(false);
        setSlashHighlightIndex(0);
        void openPresetFlow();
        return;
      }
      setPrompt(`${definition.command} `);
      setSlashMenuDismissed(false);
      setSlashHighlightIndex(0);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [openPresetFlow]
  );

  useEffect(() => {
    if (!prompt.trimStart().startsWith('/')) {
      setSlashMenuDismissed(false);
    }
  }, [prompt]);

  useEffect(() => {
    setSlashHighlightIndex(0);
  }, [slashQuery, slashSuggestions.length]);

  useEffect(() => {
    if (mentionQuery === null) {
      setMentionMenuDismissed(false);
      setMentionSuggestions([]);
      return;
    }
    setMentionMenuDismissed(false);
  }, [mentionQuery]);

  useEffect(() => {
    setMentionHighlightIndex(0);
  }, [mentionQuery, mentionSuggestions.length]);

  useEffect(() => {
    if (mentionQuery === null) {
      return;
    }

    let cancelled = false;
    const cwd = activeSession?.cwd || workingDir || '';
    const timer = window.setTimeout(() => {
      void (async () => {
        const next: MentionSuggestion[] = [];
        if (isAtMentionUrlQuery(mentionQuery)) {
          next.push({ kind: 'url', url: mentionQuery });
        }

        if (isElectron && cwd && window.electronAPI?.workspace?.searchPaths) {
          try {
            const paths = await window.electronAPI.workspace.searchPaths(cwd, mentionQuery, 20);
            for (const entry of paths) {
              next.push({
                kind: entry.kind,
                relativePath: entry.relativePath,
              });
            }
          } catch {
            // Optional autocomplete: keep URL suggestion only / empty list.
          }
        }

        if (!cancelled) {
          setMentionSuggestions(next);
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mentionQuery, activeSession?.cwd, workingDir, isElectron]);

  const applyMentionSuggestion = useCallback(
    (suggestion: MentionSuggestion) => {
      const insertion =
        suggestion.kind === 'url' ? suggestion.url : suggestion.relativePath.replace(/\\/g, '/');
      const atIndex = prompt.lastIndexOf('@');
      const nextPrompt =
        atIndex >= 0 ? `${prompt.slice(0, atIndex + 1)}${insertion} ` : `${prompt}@${insertion} `;
      setPrompt(nextPrompt);
      setMentionMenuDismissed(false);
      setMentionHighlightIndex(0);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.value = nextPrompt;
          textareaRef.current.focus();
        }
      });
    },
    [prompt]
  );

  const refreshPluginSlashCommands = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.plugins?.listCommands) {
      setPluginSlashCommands([]);
      return;
    }

    try {
      const commands = await window.electronAPI.plugins.listCommands();
      setPluginSlashCommands(commands);
    } catch {
      setPluginSlashCommands([]);
    }
  }, [isElectron]);

  useEffect(() => {
    void refreshPluginSlashCommands();
  }, [refreshPluginSlashCommands, pluginCommandsRevision]);

  const displayedMessages = useMemo(() => {
    if (!activeSessionId) return messages;
    // Show streaming message if we have partial text OR partial thinking
    const hasStreamingContent = partialMessage || partialThinking;
    if (!hasStreamingContent || !activeTurn?.userMessageId) return messages;
    const anchorIndex = messages.findIndex((message) => message.id === activeTurn.userMessageId);
    if (anchorIndex === -1) return messages;

    let insertIndex = anchorIndex + 1;
    while (insertIndex < messages.length) {
      if (messages[insertIndex].role === 'user') break;
      insertIndex += 1;
    }

    const contentBlocks: ContentBlock[] = [];
    if (partialThinking) {
      contentBlocks.push({ type: 'thinking', thinking: partialThinking });
    }
    if (partialMessage) {
      contentBlocks.push({ type: 'text', text: partialMessage });
    }

    const streamingMessage: Message = {
      id: `partial-${activeSessionId}`,
      sessionId: activeSessionId,
      role: 'assistant',
      content: contentBlocks,
      timestamp: Date.now(),
    };

    return [...messages.slice(0, insertIndex), streamingMessage, ...messages.slice(insertIndex)];
  }, [activeSessionId, activeTurn?.userMessageId, messages, partialMessage, partialThinking]);

  // Format execution time for display
  const formatExecutionTime = useCallback((ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  }, []);

  // --- Real-time execution timer ---
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    const isActive = Boolean(
      (executionClock?.startAt && executionClock.endAt === null) || streamStartedAt != null
    );
    if (!isActive) {
      return;
    }
    setClockNow(Date.now());
    const interval = setInterval(() => {
      setClockNow(Date.now());
    }, 100);
    return () => clearInterval(interval);
  }, [executionClock?.startAt, executionClock?.endAt, streamStartedAt]);

  const liveElapsed =
    executionClock?.startAt == null
      ? 0
      : Math.max(0, (executionClock.endAt ?? clockNow) - executionClock.startAt);
  const timerActive = Boolean(executionClock?.startAt && executionClock.endAt === null);

  const liveTokensPerSecond = useMemo(() => {
    if (!modelStatsEnabled || streamStartedAt == null) {
      return null;
    }
    const generated = `${partialMessage}${partialThinking}`;
    if (!generated) {
      return null;
    }
    return computeTokensPerSecondFromText(generated, streamStartedAt, clockNow);
  }, [clockNow, modelStatsEnabled, partialMessage, partialThinking, streamStartedAt]);

  // Debounced scroll function to prevent scroll conflicts
  const scrollToBottom = useRef(
    (behavior: ScrollBehavior = 'auto', immediate: boolean = false, force: boolean = false) => {
      // Cancel any pending scroll requests
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
      if (scrollRequestRef.current) {
        cancelAnimationFrame(scrollRequestRef.current);
        scrollRequestRef.current = null;
      }

      const performScroll = () => {
        if (!force && !isUserAtBottomRef.current) return;

        // Mark as scrolling to prevent concurrent scrolls
        isScrollingRef.current = true;

        messagesEndRef.current?.scrollIntoView({ behavior });

        // Reset scrolling flag after a short delay
        setTimeout(
          () => {
            isScrollingRef.current = false;
          },
          behavior === 'smooth' ? 300 : 50
        );
      };

      if (immediate) {
        performScroll();
      } else {
        // Use RAF + timeout for debouncing
        scrollRequestRef.current = requestAnimationFrame(() => {
          scrollTimeoutRef.current = setTimeout(performScroll, 16); // ~1 frame delay
        });
      }
    }
  ).current;

  const updateScrollState = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const atBottom = distanceToBottom <= 80;
    isUserAtBottomRef.current = atBottom;
    setShowScrollToBottom(!atBottom);
  }, []);

  const handleScrollToBottomClick = () => {
    isUserAtBottomRef.current = true;
    setShowScrollToBottom(false);
    scrollToBottom('smooth', true, true);
  };

  const scrollToMessageRequest = useAppStore((s) => s.scrollToMessageRequest);
  const setScrollToMessageRequest = useAppStore((s) => s.setScrollToMessageRequest);

  useEffect(() => {
    if (!scrollToMessageRequest || !activeSessionId) return;
    if (scrollToMessageRequest.sessionId !== activeSessionId) return;

    const messageId = scrollToMessageRequest.messageId;
    const tryScroll = (): boolean => {
      const el = document.getElementById(`message-${messageId}`);
      if (!el) return false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-accent/50');
      window.setTimeout(() => {
        el.classList.remove('ring-2', 'ring-accent/50');
      }, 1600);
      setScrollToMessageRequest(null);
      return true;
    };

    if (tryScroll()) return;

    // Messages may still be hydrating — retry briefly.
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (tryScroll() || attempts >= 20) {
        window.clearInterval(timer);
        if (attempts >= 20) {
          setScrollToMessageRequest(null);
        }
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [activeSessionId, messages.length, scrollToMessageRequest, setScrollToMessageRequest]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    updateScrollState();
    // While the user is reading older messages, avoid auto-scrolling that jumps the viewport
    const onScroll = () => updateScrollState();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [updateScrollState]);

  useEffect(() => {
    updateScrollState();
  }, [displayedMessages.length, activeSessionId, updateScrollState]);

  useEffect(() => {
    const messageCount = messages.length;
    const partialLength = partialMessage.length + partialThinking.length;
    const hasNewMessage = messageCount !== prevMessageCountRef.current;
    const isStreamingTick = partialLength !== prevPartialLengthRef.current && !hasNewMessage;

    // Skip scroll if already scrolling (prevent conflicts)
    if (isScrollingRef.current) {
      prevMessageCountRef.current = messageCount;
      prevPartialLengthRef.current = partialLength;
      return;
    }

    if (isUserAtBottomRef.current) {
      if (!isStreamingTick) {
        // New message - use smooth scroll but with debounce
        const behavior: ScrollBehavior = hasNewMessage ? 'smooth' : 'auto';
        scrollToBottom(behavior, false);
      } else {
        // Streaming tick - use instant scroll with debounce
        scrollToBottom('auto', false);
      }
    }

    prevMessageCountRef.current = messageCount;
    prevPartialLengthRef.current = partialLength;
  }, [messages.length, partialMessage.length, partialThinking.length]);

  // Additional scroll trigger for content height changes (e.g., TodoWrite expand/collapse)
  useEffect(() => {
    const container = scrollContainerRef.current;
    const messagesContainer = messagesContainerRef.current;
    if (!container || !messagesContainer) return;

    const resizeObserver = new ResizeObserver(() => {
      // Don't interfere with ongoing scrolls
      if (!isScrollingRef.current && isUserAtBottomRef.current) {
        // Scroll to bottom when content height changes
        scrollToBottom('auto', false);
      }
    });

    resizeObserver.observe(messagesContainer);

    return () => {
      resizeObserver.disconnect();
    };
  }, []); // ResizeObserver is stable — no need to recreate on message count changes

  // Cleanup scroll timeouts on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (scrollRequestRef.current) {
        cancelAnimationFrame(scrollRequestRef.current);
      }
    };
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeSessionId]);

  // Stop offline TTS when switching sessions or when a new agent stream starts.
  useEffect(() => {
    stopSpeechSynthesis();
  }, [activeSessionId]);

  useEffect(() => {
    if (isSessionRunning) {
      stopSpeechSynthesis();
    }
  }, [isSessionRunning]);

  const handleFileSelect = async () => {
    if (!isElectron || !window.electronAPI) {
      console.log('[ChatView] Not in Electron, file selection not available');
      return;
    }

    try {
      const filePaths = await window.electronAPI.selectFiles();
      if (filePaths.length === 0) return;

      // Get file info for each selected file
      const newFiles = filePaths.map((filePath) => {
        const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
        return {
          name: fileName,
          path: filePath,
          size: 0, // Will be set by backend when copying
          type: 'application/octet-stream',
        };
      });

      setAttachedFiles((prev) => [...prev, ...newFiles]);
    } catch (error) {
      console.error('[ChatView] Error selecting files:', error);
    }
  };

  // Load active MCP connectors
  useEffect(() => {
    if (isElectron && typeof window !== 'undefined' && window.electronAPI) {
      const loadConnectors = async () => {
        try {
          const statuses = await window.electronAPI.mcp.getServerStatus();
          const active =
            (
              statuses as Array<{ id: string; name: string; connected: boolean; toolCount: number }>
            )?.filter((s) => s.connected && s.toolCount > 0) || [];
          setActiveConnectors(active);
        } catch (err) {
          console.error('Failed to load MCP connectors:', err);
        }
      };
      loadConnectors();
      // Refresh every 5 seconds
      const interval = setInterval(loadConnectors, 5000);
      return () => clearInterval(interval);
    }
  }, [isElectron]);

  useEffect(() => {
    const titleEl = titleRef.current;
    const headerEl = headerRef.current;
    const measureEl = connectorMeasureRef.current;
    if (!titleEl || !headerEl || !measureEl) {
      setShowConnectorLabel(true);
      return;
    }
    const updateLabelVisibility = () => {
      const isTruncated = titleEl.scrollWidth > titleEl.clientWidth;
      const headerStyle = window.getComputedStyle(headerEl);
      const paddingLeft = Number.parseFloat(headerStyle.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(headerStyle.paddingRight) || 0;
      const contentWidth = headerEl.clientWidth - paddingLeft - paddingRight;
      const titleWidth = titleEl.getBoundingClientRect().width;
      const rightColumnWidth = Math.max(0, (contentWidth - titleWidth) / 2);
      const connectorFullWidth = measureEl.getBoundingClientRect().width;
      setShowConnectorLabel(!isTruncated && rightColumnWidth >= connectorFullWidth);
    };
    updateLabelVisibility();
    const observer = new ResizeObserver(() => {
      updateLabelVisibility();
    });
    observer.observe(titleEl);
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, [activeSession?.title, activeConnectors.length]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    // Get value from ref to handle both controlled and uncontrolled cases
    const currentPrompt = textareaRef.current?.value || prompt;

    if (
      (!currentPrompt.trim() && pastedImages.length === 0 && attachedFiles.length === 0) ||
      !activeSessionId ||
      isSubmitting
    )
      return;

    setIsSubmitting(true);
    try {
      const textOnly =
        currentPrompt.trim() &&
        pastedImages.length === 0 &&
        attachedFiles.length === 0 &&
        currentPrompt.trim();
      if (textOnly) {
        const command = parseSlashCommand(textOnly, pluginSlashCommands);
        if (command.kind === 'compact') {
          await compactSession(activeSessionId, command.instructions);
          setPrompt('');
          if (textareaRef.current) {
            textareaRef.current.value = '';
          }
          return;
        }
        if (command.kind === 'handoff') {
          await handoffSession(activeSessionId, command.instructions);
          setPrompt('');
          if (textareaRef.current) {
            textareaRef.current.value = '';
          }
          return;
        }
        if (command.kind === 'preset') {
          setPrompt('');
          if (textareaRef.current) {
            textareaRef.current.value = '';
          }
          await openPresetFlow(command.name);
          return;
        }
        if (command.kind === 'unknown') {
          setGlobalNotice({
            id: `notice-unknown-slash-${Date.now()}`,
            type: 'warning',
            message: t('chat.slashCommands.unknownCommand', {
              command: `/${command.token}`,
            }),
            messageKey: 'chat.slashCommands.unknownCommand',
            messageValues: { command: `/${command.token}` },
          });
          return;
        }
      }

      const promptText = textOnly
        ? normalizePluginSlashPromptForExpansion(textOnly, pluginSlashCommands)
        : currentPrompt.trim();
      const contentBlocks = buildContentBlocks(promptText);

      // Send message with content blocks
      await continueSession(activeSessionId, contentBlocks);

      // Clean up
      setPrompt('');
      if (textareaRef.current) {
        textareaRef.current.value = '';
      }
      clearAttachments();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStop = () => {
    if (activeSessionId) {
      stopSession(activeSessionId);
    }
  };

  const handleForkMessage = async (message: Message) => {
    if (!activeSessionId || isSubmitting) {
      return;
    }
    await forkSessionFromMessage(activeSessionId, message.id);
  };

  const handleEditPrompt = async (message: Message) => {
    if (!activeSessionId || isSubmitting) {
      return;
    }
    const result = await rewindSessionForEdit(activeSessionId, message.id);
    if (!result.success) {
      return;
    }

    const nextPrompt = result.promptText ?? '';
    setPrompt(nextPrompt);
    if (textareaRef.current) {
      textareaRef.current.value = nextPrompt;
      textareaRef.current.focus();
      const end = nextPrompt.length;
      textareaRef.current.setSelectionRange(end, end);
    }
    clearAttachments();
  };

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <span>{t('chat.loadingConversation')}</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div
        ref={headerRef}
        className="relative h-12 border-b border-border-muted grid grid-cols-[1fr_auto_1fr] items-center px-4 lg:px-8 bg-background/88 backdrop-blur-md"
      >
        <div className="text-[11px] font-medium tracking-[0.08em] uppercase text-text-muted">
          Lygodactylus
        </div>
        <div className="flex items-center justify-center gap-2 min-w-0">
          <h2
            ref={titleRef}
            className="text-[15px] font-medium text-text-primary text-center truncate max-w-[40vw] lg:max-w-[32rem]"
          >
            {activeSession.title}
          </h2>
          {sessionMode === 'plan' && (
            <span className="shrink-0 px-2 py-0.5 rounded-full border border-accent/30 bg-accent/10 text-[11px] font-medium text-accent">
              {t('chat.planModeBadge')}
            </span>
          )}
        </div>
        {activeConnectors.length > 0 && (
          <>
            <div
              ref={connectorMeasureRef}
              aria-hidden="true"
              className="absolute left-0 top-0 -z-10 opacity-0 pointer-events-none"
            >
              <div className="flex items-center gap-2 px-2 py-1 rounded-lg border border-mcp/20">
                <Plug className="w-3.5 h-3.5" />
                <span className="text-xs font-medium whitespace-nowrap">
                  {t('chat.connectorCount', { count: activeConnectors.length })}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-mcp/8 border border-mcp/15 justify-self-end">
              <Plug className="w-3.5 h-3.5 text-mcp" />
              <span className="text-xs text-mcp font-medium">
                {showConnectorLabel
                  ? t('chat.connectorCount', { count: activeConnectors.length })
                  : activeConnectors.length}
              </span>
            </div>
          </>
        )}
      </div>

      {globalMemoryEnabled && activeSession && (
        <MemoryContextBar
          items={memoryContextItems}
          memoryEnabled={activeSession.memoryEnabled}
          onToggleMemory={(enabled) => {
            void setSessionMemoryEnabled(activeSession.id, enabled);
          }}
          onOpenSourceSession={(sessionId) => setActiveSession(sessionId)}
        />
      )}

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div
          ref={messagesContainerRef}
          className="w-full max-w-[920px] mx-auto py-8 px-5 lg:px-8 space-y-5"
        >
          {displayedMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-28 text-text-muted space-y-3 text-center">
              <p className="text-[11px] uppercase tracking-[0.16em] text-text-muted/80">
                Lygodactylus
              </p>
              <p className="text-base text-text-secondary">{t('chat.startConversation')}</p>
            </div>
          ) : (
            displayedMessages.map((message) => {
              const isStreaming =
                typeof message.id === 'string' && message.id.startsWith('partial-');
              const tokensPerSecond =
                modelStatsEnabled && message.role === 'assistant'
                  ? isStreaming
                    ? liveTokensPerSecond
                    : (tokensPerSecondByMessageId[message.id] ?? null)
                  : null;
              return (
                <div key={message.id}>
                  <MessageCard
                    message={message}
                    isStreaming={isStreaming}
                    onFork={
                      message.role === 'user' && !isStreaming
                        ? () => void handleForkMessage(message)
                        : undefined
                    }
                    onEditPrompt={
                      message.role === 'user' && !isStreaming
                        ? () => void handleEditPrompt(message)
                        : undefined
                    }
                  />
                  {tokensPerSecond != null && (
                    <div className="flex items-center gap-1.5 text-[11px] text-text-muted mt-1 ml-0.5">
                      <Zap className="w-3 h-3" />
                      <span>
                        {t('messageCard.tokensPerSecond', {
                          rate: formatTokensPerSecond(tokensPerSecond),
                        })}
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Processing indicator - show when we have an active turn but no streaming content yet */}
          {hasActiveTurn &&
            (!partialMessage || partialMessage.trim() === '') &&
            !partialThinking && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-full bg-background/80 border border-border-subtle max-w-fit">
                <Loader2 className="w-4 h-4 text-accent animate-spin" />
                <span className="text-sm text-text-secondary">{t('chat.processing')}</span>
              </div>
            )}

          {/* Real-time execution timer */}
          {liveElapsed > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted mt-1 ml-0.5">
              <Clock className="w-3 h-3" />
              <span>
                {timerActive
                  ? formatExecutionTime(liveElapsed)
                  : t('messageCard.executionTime', { time: formatExecutionTime(liveElapsed) })}
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="relative border-t border-border-muted bg-background/92 backdrop-blur-md">
        {showScrollToBottom && (
          <button
            type="button"
            onClick={handleScrollToBottomClick}
            className="absolute left-1/2 -translate-x-1/2 -top-5 z-10 w-8 h-8 rounded-full flex items-center justify-center bg-background/95 border border-border-muted shadow-soft text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
            title={t('chat.scrollToBottom')}
            aria-label={t('chat.scrollToBottom')}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
        <div className="max-w-[920px] mx-auto px-5 lg:px-8 py-5">
          {showSwitchToAct && (
            <div className="flex justify-center mb-3">
              <button
                type="button"
                onClick={() => handleSessionModeChange('act')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-accent/40 bg-accent/10 text-accent text-xs font-medium hover:bg-accent/15 transition-colors"
              >
                <Zap className="w-3.5 h-3.5" />
                {t('chat.switchToAct')}
              </button>
            </div>
          )}
          <form
            onSubmit={handleSubmit}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="relative w-full"
          >
            {showSlashMenu && (
              <SlashCommandMenu
                suggestions={slashSuggestions}
                highlightedIndex={slashHighlightIndex}
                onSelect={applySlashCommand}
                onHighlight={setSlashHighlightIndex}
              />
            )}
            {!showSlashMenu && showMentionMenu && (
              <MentionMenu
                suggestions={mentionSuggestions}
                highlightedIndex={mentionHighlightIndex}
                onSelect={applyMentionSuggestion}
                onHighlight={setMentionHighlightIndex}
              />
            )}

            {/* Image previews */}
            {pastedImages.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 mb-3">
                {pastedImages.map((img, index) => (
                  <div key={img.url || `pasted-image-${index}`} className="relative group">
                    <img
                      src={img.url}
                      alt={t('common.pastedImageAlt', { index: index + 1 })}
                      className="w-full aspect-square object-cover rounded-lg border border-border block"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* File attachments */}
            {attachedFiles.length > 0 && (
              <div className="space-y-2 mb-3">
                {attachedFiles.map((file, index) => (
                  <div
                    key={file.path || `attached-file-${index}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-muted border border-border group"
                  >
                    {file.isTextNote ? (
                      <StickyNote className="w-4 h-4 text-accent flex-shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-accent flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary truncate">
                        {file.isTextNote
                          ? t('chat.textNoteLabel', { size: formatAttachmentSize(file.size) })
                          : file.name}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="w-6 h-6 rounded-full bg-error/10 hover:bg-error/20 text-error flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              className={`flex items-end gap-2 p-3.5 rounded-[1.75rem] bg-background/88 border border-border-muted shadow-soft transition-colors ${
                isDragging ? 'ring-2 ring-accent bg-accent/5' : ''
              }`}
            >
              <button
                type="button"
                onClick={handleFileSelect}
                className="w-9 h-9 rounded-2xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                title={t('welcome.attachFiles')}
              >
                <Plus className="w-5 h-5" />
              </button>

              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                }}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (showSlashMenu) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSlashHighlightIndex((index) => (index + 1) % slashSuggestions.length);
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSlashHighlightIndex(
                        (index) => (index - 1 + slashSuggestions.length) % slashSuggestions.length
                      );
                      return;
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setSlashMenuDismissed(true);
                      return;
                    }
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const selected = slashSuggestions[slashHighlightIndex];
                      if (selected) {
                        applySlashCommand(selected);
                      }
                      return;
                    }
                  }

                  if (showMentionMenu && mentionSuggestions.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setMentionHighlightIndex((index) => (index + 1) % mentionSuggestions.length);
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setMentionHighlightIndex(
                        (index) =>
                          (index - 1 + mentionSuggestions.length) % mentionSuggestions.length
                      );
                      return;
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setMentionMenuDismissed(true);
                      return;
                    }
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const selected = mentionSuggestions[mentionHighlightIndex];
                      if (selected) {
                        applyMentionSuggestion(selected);
                      }
                      return;
                    }
                  }

                  // Enter to send, Shift+Enter for new line
                  if (e.key === 'Enter' && !e.shiftKey) {
                    if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) {
                      return;
                    }
                    if (
                      showSlashMenu &&
                      slashQuery !== null &&
                      !hasExactSlashCommandQuery(slashQuery, pluginSlashCommands)
                    ) {
                      e.preventDefault();
                      const selected = slashSuggestions[slashHighlightIndex];
                      if (selected) {
                        applySlashCommand(selected);
                      }
                      return;
                    }
                    if (showMentionMenu && mentionSuggestions.length > 0) {
                      e.preventDefault();
                      const selected = mentionSuggestions[mentionHighlightIndex];
                      if (selected) {
                        applyMentionSuggestion(selected);
                      }
                      return;
                    }
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={t('chat.typeMessage')}
                disabled={isSubmitting}
                rows={1}
                className="flex-1 resize-none bg-transparent border-none outline-none text-text-primary placeholder:text-text-muted text-[15px] py-2"
              />

              <div className="flex items-center gap-2">
                <PlanActToggle
                  mode={sessionMode}
                  disabled={canStop}
                  onChange={handleSessionModeChange}
                />

                {/* Reasoning level toggle */}
                <ThinkingLevelToggle />

                {/* Model display */}
                <span className="hidden sm:inline-flex px-2.5 py-1 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted">
                  {appConfig?.model || t('chat.noModel')}
                </span>

                {canStop && (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="w-9 h-9 rounded-2xl flex items-center justify-center bg-error/10 text-error hover:bg-error/20 transition-colors"
                    title={t('chat.stop')}
                  >
                    <Square className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={
                    (!prompt.trim() &&
                      !textareaRef.current?.value.trim() &&
                      pastedImages.length === 0 &&
                      attachedFiles.length === 0) ||
                    isSubmitting
                  }
                  className="w-9 h-9 rounded-2xl flex items-center justify-center bg-accent text-background disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
                  title={t('chat.sendMessage')}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>

            <p className="text-[11px] text-text-muted/60 text-center mt-2.5">
              {t('chat.disclaimer')}
            </p>
          </form>
        </div>
      </div>

      {presetPickerOpen && (
        <PresetPickerDialog
          presets={presetPickerItems}
          onSelect={(preset) => applySelectedPreset(preset)}
          onClose={() => {
            setPresetPickerOpen(false);
            setPresetPickerItems([]);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        />
      )}

      {pendingPreset && (
        <PresetVariableDialog
          preset={pendingPreset}
          onConfirm={(values) => {
            const platform =
              typeof window !== 'undefined' && window.electronAPI?.platform
                ? window.electronAPI.platform
                : undefined;
            insertPromptDraft(
              buildPresetInsertionText(
                pendingPreset,
                values,
                platform ? { os: platform } : undefined
              )
            );
            setPendingPreset(null);
          }}
          onClose={() => {
            setPendingPreset(null);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        />
      )}
    </div>
  );
}
