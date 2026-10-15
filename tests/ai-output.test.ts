import { describe, expect, it, vi } from 'vitest';
import { buildMemory, type Source } from '../server/ai';
import type { Env } from '../server/env';

const source: Source = {
  articleId: 'article-1',
  title: '非同期処理',
  summary: { overview: '再試行の設計。', keyPoints: ['重複を防ぐ。'], topics: ['非同期処理'] },
  note: '',
  savedAt: '2026-10-15',
  project: '設計',
};
const context = { name: '設計', description: '', scope: 'user' };

describe('Workers AIへの出力形式の指定', () => {
  it('メモリの件数・文字数・根拠IDの制約をJSON Schemaで伝え、構造化された応答を保存形式にする', async () => {
    const memory = {
      interests: ['非同期処理への関心'],
      knowledge: [{ text: '再試行では重複を防ぐ。', articleIds: [source.articleId] }],
      questions: ['再送をどう検証するか？'],
    };
    const run = vi.fn<NonNullable<Env['AI']>['run']>().mockResolvedValue({ response: memory });
    const env = { AI: { run }, AI_MODEL: '@cf/test' } as unknown as Env;
    expect(await buildMemory(env, [source], context)).toEqual(memory);
    expect(run.mock.calls[0][1]).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: {
          type: 'object',
          required: ['interests', 'knowledge', 'questions'],
          properties: {
            interests: { maxItems: 8, items: { maxLength: 300 } },
            knowledge: {
              maxItems: 12,
              items: {
                required: ['text', 'articleIds'],
                properties: {
                  text: { maxLength: 500 },
                  articleIds: { minItems: 1, maxItems: 20 },
                },
              },
            },
            questions: { maxItems: 6, items: { maxLength: 300 } },
          },
        },
      },
    });
  });

  it('AIが指定を守らず上限を超えた場合は、不正なメモリを公開しない', async () => {
    const run = vi.fn().mockResolvedValue({
      response: { interests: Array(9).fill('関心'), knowledge: [], questions: [] },
    });
    const env = { AI: { run }, AI_MODEL: '@cf/test' } as unknown as Env;
    await expect(buildMemory(env, [source], context)).rejects.toThrow('AIの出力形式');
  });
});
