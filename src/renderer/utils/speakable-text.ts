/**
 * Convert markdown message content into plain text suitable for speechSynthesis.
 * Strips code, tables, math, and raw URLs while keeping link labels and punctuation.
 */

const FENCED_CODE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const DISPLAY_MATH_RE = /\$\$[\s\S]*?\$\$/g;
const INLINE_MATH_RE = /\$[^$\n]+\$/g;
const LATEX_INLINE_RE = /\\\([\s\S]*?\\\)/g;
const LATEX_DISPLAY_RE = /\\\[[\s\S]*?\\\]/g;
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\([^)]+\)/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\([^)]+\)/g;
const RAW_URL_RE = /https?:\/\/\S+/gi;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/gm;
const TABLE_SEPARATOR_RE = /^\s*\|?[\s:—-]+\|[\s|:—-]*$/gm;
const HEADING_RE = /^#{1,6}\s+/gm;
const BLOCKQUOTE_RE = /^>\s?/gm;
const UNORDERED_LIST_RE = /^[ \t]*[-*+]\s+/gm;
const ORDERED_LIST_RE = /^[ \t]*\d+\.\s+/gm;
const BOLD_RE = /(\*\*|__)(.+?)\1/g;
const ITALIC_RE = /(\*|_)([^*_\n]+?)\1/g;
const HORIZONTAL_RULE_RE = /^[ \t]*([-*_])\1{2,}[ \t]*$/gm;

export function toSpeakableText(markdown: string): string {
  if (!markdown) {
    return '';
  }

  let text = markdown;

  text = text.replace(FENCED_CODE_RE, '');
  text = text.replace(INLINE_CODE_RE, '');
  text = text.replace(DISPLAY_MATH_RE, '');
  text = text.replace(INLINE_MATH_RE, '');
  text = text.replace(LATEX_INLINE_RE, '');
  text = text.replace(LATEX_DISPLAY_RE, '');
  text = text.replace(MARKDOWN_IMAGE_RE, '$1');
  text = text.replace(MARKDOWN_LINK_RE, '$1');
  text = text.replace(RAW_URL_RE, '');
  text = text.replace(TABLE_ROW_RE, '');
  text = text.replace(TABLE_SEPARATOR_RE, '');
  text = text.replace(HEADING_RE, '');
  text = text.replace(BLOCKQUOTE_RE, '');
  text = text.replace(UNORDERED_LIST_RE, '');
  text = text.replace(ORDERED_LIST_RE, '');
  text = text.replace(HORIZONTAL_RULE_RE, '');
  text = text.replace(BOLD_RE, '$2');
  text = text.replace(ITALIC_RE, '$2');

  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]{2,}/g, ' ');

  return text.trim();
}
