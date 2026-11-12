import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testApp, mockStep } from './helpers';
import { neuronMicros, saveAiUsage } from '../server/ai-neurons';
import { aiStep, invokeAi } from '../server/usage';
import { embedSearchText } from '../server/search-ai';
import type { Job } from '../server/env';
import type { ProfileUsage } from '../shared/profile-usage';

const gemma = '@cf/google/gemma-4-26b-a4b-it';
const deepseek = '@cf/deepseek-ai/deepseek-v4.1-flash-1017';
const response = {
  response: 'answer',
  usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
};
it('モデル・入出力・キャッシュを反映し、推論トークンを二重計上しない', () => {
  expect(neuronMicros(gemma, response)).toBe(11_818_300);
  expect(
    neuronMicros(deepseek, {
      ...response,
      usage: {
        ...response.usage,
        prompt_tokens_details: { cached_tokens: 400 },
        completion_tokens_details: { reasoning_tokens: 50 },
      },
    }),
  ).toBe(27_490_900);
  expect(neuronMicros('@cf/baai/bge-m3', { usage: { total_tokens: 1000 } })).toBe(1_075_000);
  expect(neuronMicros(gemma, { usage: { prompt_tokens: 0, completion_tokens: 0 } })).toBe(0);
});
it.each([
  ['unknown-model', response],
  [gemma, { response: 'answer' }],
  [gemma, { usage: { prompt_tokens: 1 } }],
  [gemma, { usage: { prompt_tokens: -1, completion_tokens: 1 } }],
  [gemma, { usage: { prompt_tokens: 1.5, completion_tokens: 1 } }],
  [gemma, { usage: { prompt_tokens: Infinity, completion_tokens: 1 } }],
  [
    gemma,
    {
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        prompt_tokens_details: { cached_tokens: 2 },
      },
    },
  ],
  [gemma, { usage: { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1 } }],
])('未対応モデル・欠損・不正値を0に換算しない: %s %j', (model, value) => {
  expect(neuronMicros(model, value)).toBeNull();
});

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  await app.dispose();
  vi.restoreAllMocks();
});
const job = async (id: string, user = 'alice'): Promise<Job> => {
  await app.env.DB.prepare(
    "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision) VALUES (?,?,'article',?,1)",
  )
    .bind(id, user, id)
    .run();
  return { id, user_id: user, kind: 'article', target_id: id, revision: 1, status: 'pending' };
};
const invoke = () => invokeAi(app.env, { messages: [], max_tokens: 100, temperature: 0 });
const allUsage = async (user = 'alice') => {
  const result = await app.request('/api/v1/me/usage', { user });
  expect(result.status).toBe(200);
  return ((await result.json()) as ProfileUsage).periods.all;
};
it('形式不正でも使用量を残し、実再試行は加算、完了キャッシュは再計上しない', async () => {
  const run = vi.fn(async () => response);
  app.env.AI = { run };
  const work = await job('retry-meter');
  await expect(
    aiStep(app.env, work, mockStep(), 'generate', async () => {
      await invoke();
      throw new Error('invalid output');
    }),
  ).rejects.toThrow('invalid output');
  expect(await allUsage()).toMatchObject({ ai_neurons: 11.8183, ai_unmeasured_calls: 0 });
  const operation = async () => {
    await invoke();
    return { answer: 'done' };
  };
  await aiStep(app.env, work, mockStep(), 'generate', operation);
  await aiStep(app.env, work, mockStep(), 'generate', operation);
  expect(run).toHaveBeenCalledTimes(2);
  expect(await allUsage()).toMatchObject({ ai_neurons: 23.6366, ai_unmeasured_calls: 0 });
  await app.env.DB.prepare('DELETE FROM ai_attempts').run();
  expect(await allUsage()).toMatchObject({ ai_neurons: 23.6366, ai_unmeasured_calls: 0 });
});
it('同時実行でもユーザー別に隔離し、同一試行内の複数モデルの使用量も合算する', async () => {
  app.env.AI = {
    run: vi.fn(async () => {
      await Promise.resolve();
      return response;
    }),
  };
  const alice = await job('alice-meter');
  const bob = await job('bob-meter', 'bob');
  await Promise.all([
    aiStep(app.env, alice, mockStep(), 'generate', async () => {
      await invoke();
      await invokeAi(
        { ...app.env, AI_MODEL: deepseek },
        { messages: [], max_tokens: 1, temperature: 0 },
      );
      return {};
    }),
    aiStep(app.env, bob, mockStep(), 'generate', async () => {
      await invoke();
      return {};
    }),
  ]);
  expect(await allUsage()).toMatchObject({ ai_neurons: 50.0004, ai_unmeasured_calls: 0 });
  expect(await allUsage('bob')).toMatchObject({ ai_neurons: 11.8183, ai_unmeasured_calls: 0 });
});
it('使用量なし・通信失敗を未計測として残し、通信失敗でAIを自動再発行しない', async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({ response: 'answer' })
    .mockRejectedValue(new Error('network'));
  app.env.AI = { run };
  await aiStep(app.env, await job('no-usage'), mockStep(), 'generate', async () => {
    await invoke();
    return {};
  });
  const work = await job('network');
  const operation = async () => {
    await invoke();
    return {};
  };
  await expect(aiStep(app.env, work, mockStep(), 'generate', operation)).rejects.toThrow(
    '応答を確認',
  );
  await expect(aiStep(app.env, work, mockStep(), 'generate', operation)).rejects.toThrow(
    '再試行上限',
  );
  expect(run).toHaveBeenCalledTimes(2);
  expect(await allUsage()).toMatchObject({ ai_neurons: 0, ai_unmeasured_calls: 2 });
});
it('計測の保存失敗があっても生成を再発行しない', async () => {
  const run = vi.fn(async () => response);
  app.env.AI = { run };
  const work = await job('db-failure');
  const env = {
    ...app.env,
    DB: new Proxy(app.env.DB, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            if (sql.includes('UPDATE ai_attempts SET usage_model'))
              throw new Error('fixture unavailable');
            return target.prepare(sql);
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  };
  const operation = async () => {
    await invoke();
    return { answer: 'done' };
  };
  await aiStep(env, work, mockStep(), 'generate', operation);
  await aiStep(env, work, mockStep(), 'generate', operation);
  expect(run).toHaveBeenCalledOnce();
  expect(await allUsage()).toMatchObject({ ai_neurons: 0, ai_unmeasured_calls: 1 });
});
it('意味検索のNeuronsを同じ基準で記録し、usageがない応答は未計測にする', async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({ data: [Array(1024).fill(0.5)], usage: { total_tokens: 1000 } })
    .mockResolvedValue({ data: [Array(1024).fill(0.5)] });
  app.env.AI = { run };
  await embedSearchText(app.env, 'alice', 'query', 'query');
  await embedSearchText(app.env, 'alice', 'index', 'index');
  expect(await allUsage()).toMatchObject({ ai_neurons: 1.075, ai_unmeasured_calls: 1 });
});
it('再保存は重複計上せず、退会後の遅延応答でも集計を復活させない', async () => {
  await app.env.DB.prepare("INSERT INTO ai_attempts(id,user_id) VALUES ('meter','alice')").run();
  await saveAiUsage(app.env, 'alice', 'meter', gemma, 1_000_001, true);
  await saveAiUsage(app.env, 'alice', 'meter', gemma, 9_000_000, true);
  expect(await allUsage()).toMatchObject({ ai_neurons: 1.000001, ai_unmeasured_calls: 0 });
  expect((await app.request('/api/v1/me', { method: 'DELETE', body: {} })).status).toBe(200);
  await saveAiUsage(app.env, 'alice', 'meter', gemma, 1_000_001, true);
  expect((await app.env.DB.prepare('SELECT * FROM ai_usage_daily').all()).results).toEqual([]);
});
