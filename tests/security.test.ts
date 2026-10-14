import { describe, expect, it, vi } from 'vitest';
import { assertPublicDestination, canonicalUrl, publicIp, validateUrl } from '../server/security';
import { groundedMemory, parseAiJson, topicCounts } from '../server/ai';
import { summarySchema } from '../shared/domain';

describe('URL取得とAIの境界', () => {
  it.each([
    'file:///etc/passwd',
    'http://localhost',
    'http://127.0.0.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://10.0.0.1',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'https://user:password@example.com',
    'https://example.com:8080',
    'http://foo.local',
  ])('公開記事ではないURLを拒否する: %s', (value) => {
    expect(() => validateUrl(value)).toThrow();
  });
  it('意味のあるクエリは残して追跡情報だけ除去する', () => {
    expect(canonicalUrl('https://example.com/read?id=42&utm_source=ios&lang=ja#top')).toBe(
      'https://example.com/read?id=42&lang=ja',
    );
  });
  it('IPv4・IPv6の私有・予約範囲を拒否する', () => {
    expect(publicIp('8.8.8.8')).toBe(true);
    expect(publicIp('2606:4700:4700::1111')).toBe(true);
    for (const value of [
      '192.168.0.1',
      '172.16.0.1',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      'fd00::1',
      'fe80::1',
    ])
      expect(publicIp(value)).toBe(false);
  });
  it('公開名のDNSが内部アドレスを含む場合も拒否する', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            Status: 0,
            Answer: [
              { type: 1, data: '8.8.8.8' },
              { type: 1, data: '10.0.0.1' },
            ],
          }),
        ),
    ) as unknown as typeof fetch;
    await expect(assertPublicDestination(new URL('https://example.com'), fetcher)).rejects.toThrow(
      '公開ネットワーク',
    );
  });
  it('DNS障害時に接続を許可しない', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(
      assertPublicDestination(new URL('https://example.com'), fetcher),
    ).rejects.toThrow();
  });
  it('AIのJSONを検証し、不正な形を拒否する', () => {
    expect(
      parseAiJson(
        { response: '```json\n{"overview":"概要","keyPoints":["要点"],"topics":["認証"]}\n```' },
        summarySchema,
      ).overview,
    ).toBe('概要');
    expect(() => parseAiJson({ response: '{"overview":"概要"}' }, summarySchema)).toThrow();
  });
  it('存在しない根拠IDをメモリから除く', () => {
    const result = groundedMemory(
      {
        interests: [],
        knowledge: [
          { text: '根拠あり', articleIds: ['allowed', 'foreign'] },
          { text: '不明', articleIds: ['unknown'] },
        ],
        questions: [],
      },
      new Set(['allowed']),
    );
    expect(result.knowledge).toEqual([{ text: '根拠あり', articleIds: ['allowed'] }]);
  });
  it('同じ記事内の重複トピックを二重に数えない', () => {
    const result = topicCounts([
      {
        articleId: 'a',
        title: 'a',
        summary: { overview: '概要', keyPoints: ['要点'], topics: ['認証', '認証'] },
        note: '',
        savedAt: '',
        project: '',
      },
    ]);
    expect(result).toEqual([{ topic: '認証', count: 1 }]);
  });
});
