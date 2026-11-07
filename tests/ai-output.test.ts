import { describe, expect, it, vi } from 'vitest';
import { buildMemory, generateQuestion, summarize, parseAiJson, type Source } from '../server/ai';
import { z } from 'zod';
import { callPufuModel, pufuInputLimit } from '../server/pufu-ai';
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

it('Gemmaの要約・問いはchoicesの最終回答を使い、thinkingを無効化する', async () => {
  const summary = source.summary;
  const question = { text: '再試行時の重複をどう防ぐか？' };
  const run = vi.fn<NonNullable<Env['AI']>['run']>();
  for (const result of [summary, question])
    run.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
    });
  const env = { AI: { run }, AI_MODEL: '@cf/google/gemma-4-26b-a4b-it' } as unknown as Env;
  expect(await summarize(env, source.title, '再試行では重複を防ぐ。'.repeat(20))).toEqual(summary);
  expect(
    await generateQuestion(env, {
      title: source.title,
      summary,
      note: '',
      project: { name: context.name, description: '' },
    }),
  ).toEqual(question);
  expect(run).toHaveBeenCalledTimes(2);
  for (const [model, input] of run.mock.calls) {
    expect(model).toBe(env.AI_MODEL);
    expect(input).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
      response_format: { json_schema: { name: 'result', strict: true } },
    });
  }
});

it.each(['@cf/google/gemma-4-26b-a4b-it', '@cf/deepseek-ai/deepseek-v4.1-flash-1017'])(
  '%sのchat応答を読み、推論文と存在しない根拠IDを保存しない',
  async (model) => {
    const run = vi.fn<NonNullable<Env['AI']>['run']>().mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              interests: [],
              knowledge: [
                { text: '再試行では重複を防ぐ。', articleIds: ['article-1', 'invented'] },
                { text: '根拠のない知識', articleIds: ['invented'] },
              ],
              questions: [],
            }),
            reasoning_content: '内部検討',
          },
        },
      ],
    });
    const result = await buildMemory(
      { AI: { run }, AI_MODEL: model } as unknown as Env,
      [source],
      context,
    );
    expect(result.knowledge).toEqual([
      { text: '再試行では重複を防ぐ。', articleIds: ['article-1'] },
    ]);
    expect(JSON.stringify(result)).not.toContain('内部検討');
    expect(run.mock.calls[0][1].response_format).toMatchObject({
      json_schema: { name: 'result', strict: true, schema: { type: 'object' } },
    });
    expect(run.mock.calls[0][1]).toMatchObject(
      model.includes('deepseek')
        ? { reasoning_effort: 'none' }
        : { chat_template_kwargs: { enable_thinking: false } },
    );
  },
);

it.each([
  { content: null, finish_reason: 'stop' },
  { content: '{"text":"回答"}', finish_reason: 'length' },
  { content: '{"text":"回答"}', finish_reason: 'content_filter' },
  { content: '{"text":7}', finish_reason: 'stop' },
])('不完全または不正なchat応答を保存しない: %j', ({ content, finish_reason }) => {
  expect(() =>
    parseAiJson(
      {
        choices: [
          {
            finish_reason,
            message: {
              content,
              reasoning_content: '{"text":"推論"}',
            },
          },
        ],
      },
      z.object({ text: z.string() }),
    ),
  ).toThrow('出力形式');
});

it('DeepSeekの抽出入力を40KBに保ち、上限超過を送信前に拒否する', async () => {
  const run = vi.fn<NonNullable<Env['AI']>['run']>();
  const env = {
    AI: { run },
    AI_MODEL: '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
  } as unknown as Env;
  expect(pufuInputLimit(env)).toBe(40000);
  await expect(
    callPufuModel(
      env,
      '指示',
      { text: 'あ'.repeat(14000) },
      z.object({ text: z.string() }),
      500,
      pufuInputLimit(env),
    ),
  ).rejects.toThrow('入力上限');
  expect(run).not.toHaveBeenCalled();
});

describe('短い本文の要約', () => {
  it.each([
    'ダークモードモードを導入',
    'PufuLensでdot用のプロジェクトを割り当ててみる',
    '新しいPufu Lensは自動で情報を収集することへのアンチテーゼ的側面がある',
  ])('短い投稿を推測で膨らませず原文だけを保存する: %s', async (text) => {
    const run = vi.fn().mockRejectedValue(new Error('短文にAIは不要'));
    const env = { AI: { run }, AI_MODEL: '@cf/test' } as unknown as Env;
    expect(await summarize(env, '用語の意味が分からないタイトル', ` \n${text}\n `)).toEqual({
      overview: text,
      keyPoints: [text],
      topics: [],
      shortSource: true,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['あ', '🐸'])(
    '空白を除いたUnicode文字数で119/120文字の境界を判定する: %s',
    async (char) => {
      const response = { overview: '長い本文の要約。', keyPoints: ['本文の要点。'], topics: [] };
      const run = vi.fn().mockResolvedValue({ response });
      const env = { AI: { run }, AI_MODEL: '@cf/test' } as unknown as Env;
      const short = await summarize(env, '境界', ` ${char.repeat(119)} `);
      expect(short.overview).toBe(char.repeat(119));
      expect(short.keyPoints).toEqual([char.repeat(119)]);
      expect(run).not.toHaveBeenCalled();
      expect(await summarize(env, '境界', char.repeat(120))).toEqual(response);
      expect(run).toHaveBeenCalledOnce();
    },
  );
});

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

it('本文採用で要点のないストックも、AI未接続のデモで問いとメモリを作成できる', async () => {
  const env = { LOCAL_DEMO_ENABLED: 'true', APP_URL: 'http://localhost:5173' } as Env;
  const overview = '原文の本文です。'.repeat(100);
  const summary = { overview, keyPoints: [], topics: [], verbatim: true as const };
  expect(
    await generateQuestion(env, {
      title: source.title,
      summary,
      note: '',
      project: { name: '設計', description: '' },
    }),
  ).toMatchObject({ text: expect.stringContaining(overview.slice(0, 100)) });
  const memory = await buildMemory(env, [{ ...source, summary }], context);
  expect(memory.knowledge).toEqual([
    { text: overview.slice(0, 500), articleIds: [source.articleId] },
  ]);
});

it('本文採用の問い生成は保存原文を変更せず長文の抜粋だけをAIへ渡す', async () => {
  const summary = {
    overview: '原文'.repeat(60000),
    keyPoints: [],
    topics: [],
    verbatim: true as const,
  };
  const run = vi.fn().mockResolvedValue({ response: { text: 'どの条件を確認する？' } });
  const env = { AI: { run }, AI_MODEL: '@cf/google/gemma-4-26b-a4b-it' } as unknown as Env;
  await generateQuestion(env, {
    title: source.title,
    summary,
    note: '',
    project: { name: '設計', description: '' },
  });
  expect(JSON.parse(run.mock.calls[0][1].messages[1].content).summary.overview).toBe(
    summary.overview.slice(0, 1600),
  );
  expect(summary.overview).toHaveLength(120000);
});
