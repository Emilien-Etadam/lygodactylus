/**
 * Minimal RSS 2.0 / Atom parser (no XML dependency).
 * Extracts title / link / pubDate / guid only; malformed input → [].
 */

export interface RssFeedItem {
  title: string;
  link: string;
  pubDate: string;
  guid: string;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const n = Number.parseInt(hex, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    });
}

function stripTags(value: string): string {
  // Unwrap CDATA before tag stripping — otherwise `<![CDATA[...]]>` is treated as a tag.
  const withCdata = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
  return decodeXmlEntities(withCdata.replace(/<[^>]+>/g, '')).trim();
}

function extractTagInner(block: string, tagNames: string[]): string {
  for (const tag of tagNames) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = block.match(re);
    if (match?.[1] !== undefined) {
      return stripTags(match[1]);
    }
  }
  return '';
}

function extractLink(block: string, isAtom: boolean): string {
  if (isAtom) {
    const linkTagRe = /<link\b[^>]*>/gi;
    let alternateLink: string | undefined;
    let linkWithoutRel: string | undefined;

    for (const tagMatch of block.matchAll(linkTagRe)) {
      const tag = tagMatch[0];
      const relMatch = tag.match(/\brel\s*=\s*["']([^"']+)["']/i);
      const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
      if (!hrefMatch?.[1]) {
        continue;
      }

      const rel = relMatch?.[1]?.trim().toLowerCase() ?? '';
      if (rel === 'self') {
        continue;
      }

      const href = decodeXmlEntities(hrefMatch[1].trim());
      if (rel === 'alternate') {
        alternateLink = href;
        break;
      }
      if (!relMatch) {
        linkWithoutRel ??= href;
      }
    }

    if (alternateLink) {
      return alternateLink;
    }
    if (linkWithoutRel) {
      return linkWithoutRel;
    }
  }
  return extractTagInner(block, ['link']);
}

function extractGuid(block: string, link: string, isAtom: boolean): string {
  const guid = isAtom
    ? extractTagInner(block, ['id'])
    : extractTagInner(block, ['guid']);
  return guid || link;
}

function parseBlocks(xml: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    if (match[1] !== undefined) {
      blocks.push(match[1]);
    }
  }
  return blocks;
}

/**
 * Parse RSS 2.0 `<item>` or Atom `<entry>` elements.
 * Returns [] for empty / malformed / unrecognized XML.
 */
export function parseRssOrAtom(xml: string): RssFeedItem[] {
  if (typeof xml !== 'string' || !xml.trim()) {
    return [];
  }

  try {
    const isAtom = /<feed\b/i.test(xml) || /<entry\b/i.test(xml);
    const blocks = isAtom ? parseBlocks(xml, 'entry') : parseBlocks(xml, 'item');
    if (blocks.length === 0) {
      return [];
    }

    const items: RssFeedItem[] = [];
    for (const block of blocks) {
      const title = extractTagInner(block, ['title']);
      const link = extractLink(block, isAtom);
      const pubDate = isAtom
        ? extractTagInner(block, ['updated', 'published'])
        : extractTagInner(block, ['pubDate', 'published']);
      const guid = extractGuid(block, link, isAtom);
      if (!title && !link && !guid) {
        continue;
      }
      items.push({ title, link, pubDate, guid });
    }
    return items;
  } catch {
    return [];
  }
}
