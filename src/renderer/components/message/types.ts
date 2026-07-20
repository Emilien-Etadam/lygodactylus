// Shared types for MessageCard sub-components
import type {
  Message,
  ContentBlock,
  ToolUseContent,
  ToolResultContent,
} from '../../types';
import type { WebCitationSource } from '../../../shared/web-citation';

export type { Message, ContentBlock, ToolUseContent, ToolResultContent };

export interface ContentBlockViewProps {
  block: ContentBlock;
  isUser: boolean;
  isStreaming?: boolean;
  /** All blocks in the same message, used to locate the paired tool_result */
  allBlocks?: ContentBlock[];
  /** The full message, used to search across all session messages */
  message?: Message;
  /** Numbered web sources for the current turn; enables [n] linkification */
  citationSources?: WebCitationSource[];
}

export interface ToolBlockBaseProps {
  allBlocks?: ContentBlock[];
  message?: Message;
}

// TodoWrite item shape as emitted by the AI tool
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  id?: string;
  /** Optional short form displayed in the header while in progress */
  activeForm?: string;
}
