import { describe, expect, it } from 'vitest';
import { parseRssOrAtom } from '../../main/watch/rss-parser';
import { capRssGuids, WATCH_RSS_GUID_LIMIT } from '../../shared/watch';

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com/</link>
    <item>
      <title>First post</title>
      <link>https://example.com/first</link>
      <guid>https://example.com/first</guid>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second &amp; last</title>
      <link>https://example.com/second</link>
      <guid isPermaLink="false">post-2</guid>
      <pubDate>Tue, 02 Jan 2024 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Example</title>
  <entry>
    <title>Hello Atom</title>
    <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a</id>
    <updated>2024-03-15T10:00:00Z</updated>
    <link href="https://example.org/hello" rel="alternate"/>
  </entry>
  <entry>
    <title><![CDATA[CDATA Title]]></title>
    <id>urn:uuid:2225c695-cfb8-4ebb-bbbb-80da344efa6a</id>
    <published>2024-03-16T10:00:00Z</published>
    <link href="https://example.org/cdata"/>
  </entry>
</feed>`;

describe('parseRssOrAtom', () => {
  it('parses a real RSS 2.0 fixture', () => {
    const items = parseRssOrAtom(RSS_FIXTURE);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'First post',
      link: 'https://example.com/first',
      guid: 'https://example.com/first',
      pubDate: 'Mon, 01 Jan 2024 12:00:00 GMT',
    });
    expect(items[1]?.title).toBe('Second & last');
    expect(items[1]?.guid).toBe('post-2');
  });

  it('parses Atom entry links preferring rel="alternate" over rel="self"', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Dual links</title>
    <id>urn:uuid:self-then-alt</id>
    <link href="https://example.org/self" rel="self"/>
    <link href="https://example.org/article" rel="alternate"/>
  </entry>
</feed>`;
    const items = parseRssOrAtom(xml);
    expect(items).toHaveLength(1);
    expect(items[0]?.link).toBe('https://example.org/article');
  });

  it('parses a real Atom fixture', () => {
    const items = parseRssOrAtom(ATOM_FIXTURE);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Hello Atom',
      link: 'https://example.org/hello',
      guid: 'urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a',
      pubDate: '2024-03-15T10:00:00Z',
    });
    expect(items[1]?.title).toBe('CDATA Title');
    expect(items[1]?.link).toBe('https://example.org/cdata');
  });

  it('returns an empty list for malformed input', () => {
    expect(parseRssOrAtom('')).toEqual([]);
    expect(parseRssOrAtom('not xml at all')).toEqual([]);
    expect(parseRssOrAtom('<rss><channel><item><title>broken')).toEqual([]);
    expect(parseRssOrAtom('<html><body>no feed</body></html>')).toEqual([]);
  });
});

describe('capRssGuids', () => {
  it('keeps at most 200 guids, newest first, de-duplicated', () => {
    const guids = Array.from({ length: 250 }, (_, i) => `g-${i}`);
    const capped = capRssGuids([...guids, 'g-0', 'g-1'], WATCH_RSS_GUID_LIMIT);
    expect(capped).toHaveLength(200);
    expect(capped[0]).toBe('g-0');
    expect(capped[1]).toBe('g-1');
    expect(capped[199]).toBe('g-199');
    expect(new Set(capped).size).toBe(200);
  });
});
