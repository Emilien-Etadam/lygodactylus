/**
 * Extract image attachments from the current user turn and map them to the
 * SDK's ImageContent shape so they can be forwarded via
 * `piSession.prompt(text, { images })`.
 *
 * Without this the turn is sent as a plain string (`contextualPrompt`) and any
 * attached image is silently dropped before it reaches the provider — the model
 * receives no image and answers as if the message were empty. See
 * docs/qwen-local-reliability.md (vision was verified working server-side).
 *
 * The renderer uses an Anthropic-style block
 * (`{ type: 'image', source: { media_type, data } }`); the pi-ai SDK expects
 * `{ type: 'image', data, mimeType }`. Pure + unit-testable.
 */
import type { ImageContent as PiImageContent } from '@earendil-works/pi-ai/compat';

interface RendererImageBlock {
  type: 'image';
  source?: { type?: string; media_type?: string; data?: string };
}

function isRendererImageBlock(block: unknown): block is RendererImageBlock {
  return (
    !!block &&
    typeof block === 'object' &&
    (block as { type?: unknown }).type === 'image'
  );
}

/**
 * Map a user message's content blocks to the SDK image attachments. Skips
 * non-image blocks and malformed image blocks (missing data or media_type).
 */
export function extractPromptImages(content: unknown): PiImageContent[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const images: PiImageContent[] = [];
  for (const block of content) {
    if (!isRendererImageBlock(block)) {
      continue;
    }
    const data = block.source?.data;
    const mimeType = block.source?.media_type;
    if (typeof data === 'string' && data.length > 0 && typeof mimeType === 'string' && mimeType.length > 0) {
      images.push({ type: 'image', data, mimeType });
    }
  }
  return images;
}
