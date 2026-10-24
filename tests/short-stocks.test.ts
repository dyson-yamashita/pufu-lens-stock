import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testApp, mockEvent, mockStep } from './helpers';
import { ArticleWorkflow, MemoryWorkflow } from '../server/workflows';
import type { Job } from '../server/env';
import type { Question, Stock } from '../shared/domain';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
  app.env.LOCAL_DEMO_ENABLED = 'true';
});
afterEach(async () => app.dispose());
async function run(kind: Job['kind'], target: string) {
  const job = await app.env.DB.prepare(
    'SELECT * FROM processing_jobs WHERE kind=? AND target_id=? ORDER BY revision DESC LIMIT 1',
  )
    .bind(kind, target)
    .first<Job>();
  expect(job).not.toBeNull();
  const Workflow = kind === 'question' || kind === 'article' ? ArticleWorkflow : MemoryWorkflow;
  await new Workflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
}
async function question(id: string) {
  return (
    (await (await app.request(`/api/v1/stocks/${id}/question`)).json()) as { question: Question }
  ).question;
}
async function save() {
  const { id } = (await (
    await app.request('/api/v1/stocks', {
      method: 'POST',
      body: {
        type: 'text',
        text: 'dot用のプロジェクトを割り当ててみる',
        project_id: 'alice-project',
      },
    })
  ).json()) as { id: string };
  const { stock } = (await (await app.request(`/api/v1/stocks/${id}`)).json()) as { stock: Stock };
  await run('article', stock.article_id);
  await run('question', id);
  return id;
}
const note = (id: string, value: string) =>
  app.request(`/api/v1/stocks/${id}`, {
    method: 'PATCH',
    body: { note: value, project_id: 'alice-project' },
  });

it('短文のメモ変更でAIの問いを再生成し、メモリへ渡すが記事要約とユーザーの問いは保持する', async () => {
  const id = await save();
  const old = await question(id);
  await app.request('/api/v1/questions', {
    method: 'POST',
    body: { stock_id: id, text: '自分の問い？' },
  });
  const text = 'エージェントとの共同作業を試したい';
  expect((await note(id, text)).status).toBe(200);
  expect(await question(id)).toMatchObject({ id: old.id, status: 'queued' });
  const response = { text: '共同作業の役割をどう分ける？' };
  const ai = vi.fn().mockResolvedValue({ response });
  app.env.AI = { run: ai };
  await run('question', id);
  expect(await question(id)).toMatchObject({ id: old.id, text: response.text, status: 'ready' });
  expect(JSON.parse(ai.mock.calls[0][1].messages[1].content).note).toBe(text);
  const detail = (await (await app.request(`/api/v1/stocks/${id}`)).json()) as { stock: Stock };
  expect(detail.stock.summary).toMatchObject({
    overview: 'dot用のプロジェクトを割り当ててみる',
    shortSource: true,
  });
  expect(detail.stock.model).toBe('source-extract');
  expect(
    await app.env.DB.prepare("SELECT text FROM questions WHERE stock_id=? AND source='user'")
      .bind(id)
      .first(),
  ).toEqual({ text: '自分の問い？' });
  ai.mockResolvedValue({ response: { interests: [], knowledge: [], questions: [] } });
  await run('project_memory', 'alice-project');
  const input = JSON.parse(ai.mock.calls[1][1].messages[1].content);
  expect(input.sources[0].note).toBe(text);
  expect(input.sources[0].summary.overview).toBe('dot用のプロジェクトを割り当ててみる');
});

it('同じメモの再送では問いを再生成せず、削除したAIの問いは復活させない', async () => {
  const id = await save();
  await note(id, '気になる理由');
  await run('question', id);
  const before = await app.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM processing_jobs WHERE kind='question'",
  ).first();
  await Promise.all([note(id, '気になる理由'), note(id, '気になる理由')]);
  expect(
    await app.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM processing_jobs WHERE kind='question'",
    ).first(),
  ).toEqual(before);
  const q = await question(id);
  await app.request(`/api/v1/questions/${q.id}`, { method: 'DELETE' });
  await note(id, '変化した理由');
  expect(await question(id)).toBeNull();
});

it('同じ記事の別保存先の問いを変えず、利用上限でもメモを保存して生成を待機する', async () => {
  const id = await save();
  const { id: other } = (await (
    await app.request('/api/v1/stocks', {
      method: 'POST',
      body: {
        type: 'text',
        text: 'dot用のプロジェクトを割り当ててみる',
        project_id: 'alice-second',
      },
    })
  ).json()) as { id: string };
  await run('question', other);
  const previous = await question(other);
  app.env.AI_QUESTION_DAILY_LIMIT = '1';
  expect((await note(id, '試してみたい理由')).status).toBe(200);
  expect(await question(other)).toEqual(previous);
  expect(
    await app.env.DB.prepare(
      "SELECT status FROM processing_jobs WHERE kind='question' AND target_id=? ORDER BY revision DESC LIMIT 1",
    )
      .bind(id)
      .first(),
  ).toEqual({ status: 'pending' });
  expect(
    (await (await app.request(`/api/v1/stocks/${id}`)).json()) as { stock: Stock },
  ).toMatchObject({ stock: { note: '試してみたい理由' } });
});

it('生成中にメモを変えたら古い結果を確定せず、新しいメモで再生成する', async () => {
  const id = await save();
  await note(id, '最初の理由');
  app.env.AI = {
    run: vi
      .fn()
      .mockImplementationOnce(async () => {
        await note(id, '更新後の理由');
        return { response: { text: '古いメモの問い？' } };
      })
      .mockResolvedValue({ response: { text: '新しいメモの問い？' } }),
  };
  await run('question', id);
  expect(await question(id)).toMatchObject({ status: 'queued' });
  expect((await question(id)).text).not.toBe('古いメモの問い？');
  await run('question', id);
  expect(await question(id)).toMatchObject({ status: 'ready', text: '新しいメモの問い？' });
});
