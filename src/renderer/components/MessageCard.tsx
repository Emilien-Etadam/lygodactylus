// MessageCard — top-level chat message renderer.
// Delegates block rendering to ContentBlockView and its sub-components.
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, XCircle, GitBranch, Pencil } from 'lucide-react';
import type { Message, ContentBlock, ToolUseContent, ToolResultContent } from '../types';
import { useAppStore } from '../store';
import { useAppConfig } from '../store/selectors';
import { ContentBlockView } from './message/ContentBlockView';
import { CopyButton } from './message/CopyButton';
import { SpeakButton } from './message/SpeakButton';
import { MessageSourcesCard } from './message/MessageSourcesCard';
import {
  collectWebSourcesForAssistantMessage,
  getAssistantPlainText,
  getTurnMessages,
} from '../utils/web-citation-sources';
import type { WebCitationSource } from '../../shared/web-citation';

interface MessageCardProps {
  message: Message;
  isStreaming?: boolean;
  onFork?: () => void;
  onEditPrompt?: () => void;
}

function messageHasText(message: Message): boolean {
  return getAssistantPlainText(message).trim().length > 0;
}

export const MessageCard = memo(function MessageCard({
  message,
  isStreaming,
  onFork,
  onEditPrompt,
}: MessageCardProps) {
  const { t } = useTranslation();
  const appConfig = useAppConfig();
  const speechEnabled = appConfig?.speechSynthesisEnabled === true;
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isQueued = message.localStatus === 'queued';
  const isCancelled = message.localStatus === 'cancelled';
  const sessionMessages = useAppStore((s) =>
    message.sessionId ? (s.sessionStates[message.sessionId]?.messages ?? []) : []
  );
  const traceSteps = useAppStore((s) =>
    message.sessionId ? (s.sessionStates[message.sessionId]?.traceSteps ?? []) : []
  );

  const contentBlocks = useMemo(() => {
    const rawContent = message.content as unknown;
    return Array.isArray(rawContent)
      ? (rawContent as ContentBlock[])
      : [{ type: 'text', text: String(rawContent ?? '') } as ContentBlock];
  }, [message.content]);
  // Build a set of tool_result IDs that have a matching tool_use (for merging)
  const mergedResultIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of contentBlocks) {
      if (b.type === 'tool_use') {
        const tu = b as ToolUseContent;
        const result = contentBlocks.find(
          (r) => r.type === 'tool_result' && (r as ToolResultContent).toolUseId === tu.id
        );
        if (result) ids.add((result as ToolResultContent).toolUseId);
      }
    }
    return ids;
  }, [contentBlocks]);

  // Extract text content for copying / speech
  const textContent = useMemo(
    () =>
      contentBlocks
        .filter((block) => block.type === 'text')
        .map((block) => (block as { type: 'text'; text: string }).text)
        .join('\n'),
    [contentBlocks]
  );

  const webSources = useMemo((): WebCitationSource[] => {
    if (isUser || isSystem || !message.sessionId) {
      return [];
    }
    return collectWebSourcesForAssistantMessage(sessionMessages, message, traceSteps);
  }, [isUser, isSystem, message, sessionMessages, traceSteps]);

  const showSourcesCard = useMemo(() => {
    if (webSources.length === 0 || !textContent.trim()) {
      return false;
    }
    const turnMessages = getTurnMessages(sessionMessages, message);
    const textAssistants = turnMessages.filter(
      (item) => item.role === 'assistant' && messageHasText(item)
    );
    const lastTextAssistant = textAssistants[textAssistants.length - 1];
    return lastTextAssistant?.id === message.id;
  }, [webSources.length, textContent, sessionMessages, message]);

  const hasCopyableText = textContent.length > 0;

  return (
    <div className="animate-fade-in" data-message-id={message.id} id={`message-${message.id}`}>
      {isUser ? (
        // User message - compact styling with smaller padding and radius
        <div className="flex items-start gap-2 justify-end group">
          <div
            className={`message-user px-4 py-3 rounded-[1.65rem] max-w-[80%] min-w-0 break-words ${
              isQueued ? 'opacity-70 border-dashed' : ''
            } ${isCancelled ? 'opacity-60' : ''}`}
          >
            {isQueued && (
              <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
                <Clock className="w-3 h-3" />
                <span>{t('messageCard.queued')}</span>
              </div>
            )}
            {isCancelled && (
              <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
                <XCircle className="w-3 h-3" />
                <span>{t('messageCard.cancelled')}</span>
              </div>
            )}
            {contentBlocks.length === 0 ? (
              <span className="text-text-muted italic">{t('messageCard.emptyMessage')}</span>
            ) : (
              contentBlocks.map((block, index) => (
                <ContentBlockView
                  key={
                    'id' in block ? (block as { id: string }).id : `block-${block.type}-${index}`
                  }
                  block={block}
                  isUser={isUser}
                  isStreaming={isStreaming}
                />
              ))
            )}
          </div>
          <div className="mt-1 flex flex-col gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all">
            {hasCopyableText && (
              <CopyButton text={textContent} title={t('messageCard.copyMessage')} />
            )}
            {onFork && (
              <button
                type="button"
                onClick={onFork}
                className="w-6 h-6 flex items-center justify-center rounded-md bg-surface-muted hover:bg-surface-active transition-colors"
                title={t('messageCard.forkFromMessage')}
              >
                <GitBranch className="w-3 h-3 text-text-muted" />
              </button>
            )}
            {onEditPrompt && (
              <button
                type="button"
                onClick={onEditPrompt}
                className="w-6 h-6 flex items-center justify-center rounded-md bg-surface-muted hover:bg-surface-active transition-colors"
                title={t('messageCard.editPrompt')}
              >
                <Pencil className="w-3 h-3 text-text-muted" />
              </button>
            )}
          </div>
        </div>
      ) : isSystem ? (
        <div className="space-y-1.5">
          {contentBlocks.map((block, index) => (
            <ContentBlockView
              key={'id' in block ? (block as { id: string }).id : `block-${block.type}-${index}`}
              block={block}
              isUser={false}
              isStreaming={isStreaming}
              allBlocks={contentBlocks}
              message={message}
            />
          ))}
        </div>
      ) : (
        // Assistant message — no bubble, direct content (Claude style)
        <div className="group/assistant space-y-1.5">
          {hasCopyableText && !isStreaming && (
            <div className="flex justify-end gap-1 opacity-0 group-hover/assistant:opacity-100 transition-opacity -mb-1">
              {speechEnabled && <SpeakButton messageId={message.id} text={textContent} />}
              <CopyButton text={textContent} title={t('messageCard.copyMessage')} />
            </div>
          )}
          {contentBlocks.map((block, index) => {
            // Skip tool_result blocks that are merged into their tool_use card
            if (
              block.type === 'tool_result' &&
              mergedResultIds.has((block as ToolResultContent).toolUseId)
            ) {
              return null;
            }
            return (
              <ContentBlockView
                key={'id' in block ? (block as { id: string }).id : `block-${block.type}-${index}`}
                block={block}
                isUser={isUser}
                isStreaming={isStreaming}
                allBlocks={contentBlocks}
                message={message}
                citationSources={webSources}
              />
            );
          })}
          {showSourcesCard && <MessageSourcesCard sources={webSources} />}
        </div>
      )}
    </div>
  );
});
