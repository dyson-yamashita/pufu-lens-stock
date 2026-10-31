import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { testApp, mockStep } from './helpers';
import { runPufu } from '../server/pufu';
import type { Job } from '../server/env';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
  app.env.LOCAL_DEMO_ENABLED = 'true';
  await app.env.DB.batch([
    app.env.DB.prepare(
      "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status) VALUES ('article','alice','https://example.com','https://example.com','記事','example.com','ready')",
    ),
    app.env.DB.prepare(
      "INSERT INTO stocks(id,user_id,project_id,article_id) VALUES ('stock','alice','alice-project','article')",
    ),
    app.env.DB.prepare(
      "INSERT INTO questions(id,stock_id,source,text,status) VALUES ('question','stock','user','残す問い','ready')",
    ),
  ]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.dispose();
});

const remove = (id: string, options = {}) =>
  app.request(`/api/v1/pufus/${id}`, { method: 'DELETE', ...options });
async function saved() {
  const score = JSON.parse(
    await readFile(new URL('./fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
  );
  const response = await app.request('/api/v1/pufus', {
    method: 'POST',
    body: {
      project_id: 'alice-project',
      question_id: 'question',
      stock_ids: ['stock'],
      request_id: crypto.randomUUID(),
      score,
    },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { pufu: { id: string } }).pufu.id;
}

it('指定したプ譜の全局面・振り返り・コメント・関連付けを削除し、元の問い・ストックと別のプ譜を保持する', async () => {
  const id = await saved();
  const other = await saved();
  await app.env.DB.batch([
    app.env.DB.prepare(
      'INSERT INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at) SELECT pufu_id,2,score_json,created_at,updated_at FROM pufu_phases WHERE pufu_id=? AND number=1',
    ).bind(id),
    app.env.DB.prepare('UPDATE pufu_scores SET current_phase=2,is_favorite=1 WHERE id=?').bind(id),
    app.env.DB.prepare(
      "INSERT INTO comments(id,target_type,target_id,phase,author_id,author_kind,body) VALUES ('reflection','pufu',?,1,'alice','user','振り返り'),('comment','pufu',?,2,'alice','user','コメント'),('keep','question','question',NULL,'alice','user','残すコメント')",
    ).bind(id, id),
  ]);
  expect((await remove(id)).status).toBe(200);
  expect((await app.request(`/api/v1/pufus/${id}`)).status).toBe(404);
  expect((await app.request(`/api/v1/pufus/${other}`)).status).toBe(200);
  for (const table of ['pufu_phases', 'pufu_questions', 'pufu_stocks', 'pufu_phase_requests']) {
    expect(
      (await app.env.DB.prepare(`SELECT * FROM ${table} WHERE pufu_id=?`).bind(id).all()).results,
    ).toEqual([]);
  }
  expect((await app.env.DB.prepare('SELECT id FROM comments').all()).results).toEqual([
    { id: 'keep' },
  ]);
  expect((await app.request('/api/v1/questions/question')).status).toBe(200);
  expect((await app.request('/api/v1/stocks/stock')).status).toBe(200);
  expect(await (await app.request('/api/v1/pufus')).json()).toMatchObject({
    total: 1,
    pufus: [{ id: other }],
  });
  expect((await remove(id)).status).toBe(404);
});

it.each(['queued', 'generating', 'failed'])(
  '%sのプ譜を削除して未完了ジョブを止め、生成完了や再実行で復活させない',
  async (status) => {
    const response = await app.request('/api/v1/questions/question/pufus', {
      method: 'POST',
      body: { task: '実行する課題', request_id: crypto.randomUUID() },
    });
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    await app.env.DB.prepare('UPDATE pufu_scores SET status=? WHERE id=?').bind(status, id).run();
    const job = (await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='pufu' AND target_id=?",
    )
      .bind(id)
      .first<Job>())!;
    // 生成中は削除を挟み、生成結果の遅延保存も再現する。
    const step = mockStep();
    let deleted = false;
    const racingStep = {
      ...step,
      do: async (name: string, ...args: unknown[]) => {
        const value = await (step.do as (name: string, ...args: unknown[]) => Promise<unknown>)(
          name,
          ...args,
        );
        if (status === 'generating' && name === 'generate-pufu') {
          expect((await remove(id)).status).toBe(200);
          deleted = true;
        }
        return value;
      },
    } as typeof step;
    if (status === 'generating') await runPufu(app.env, job, racingStep);
    else {
      expect((await remove(id)).status).toBe(200);
      deleted = true;
    }
    expect(deleted).toBe(true);
    expect(
      await app.env.DB.prepare('SELECT status FROM processing_jobs WHERE id=?')
        .bind(job.id)
        .first(),
    ).toEqual({ status: 'done' });
    await runPufu(app.env, job, mockStep());
    expect((await app.request(`/api/v1/pufus/${id}`)).status).toBe(404);
    expect(
      (await app.env.DB.prepare('SELECT * FROM pufu_phases WHERE pufu_id=?').bind(id).all())
        .results,
    ).toEqual([]);
    expect((await app.request(`/api/v1/pufus/${id}/retry`, { method: 'POST' })).status).toBe(404);
  },
);

it('他ユーザー・未認証・別サイト・保存用トークンによる削除を拒否する', async () => {
  const id = await saved();
  expect((await remove(id, { user: 'bob' })).status).toBe(404);
  expect((await remove('missing')).status).toBe(404);
  expect((await remove(id, { headers: { Cookie: '' } })).status).toBe(401);
  expect((await remove(id, { headers: { Origin: 'https://evil.example.com' } })).status).toBe(403);
  const { token } = (await (
    await app.request('/api/v1/tokens', { method: 'POST', body: { name: '保存用' } })
  ).json()) as { token: string };
  expect((await remove(id, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(403);
  expect((await app.request(`/api/v1/pufus/${id}`)).status).toBe(200);
});

it.each(['saved', 'generated'])(
  '削除後の%s作成POSTの再送を拒否し、新しいリクエストIDでは作成できる',
  async (kind) => {
    const score = JSON.parse(
      await readFile(new URL('./fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
    );
    const request_id = crypto.randomUUID();
    const path =
      kind === 'saved' ? '/api/v1/pufus' : '/api/v1/projects/alice-project/pufus/generate';
    const body =
      kind === 'saved'
        ? { project_id: 'alice-project', request_id, score }
        : { request_id, task: '生成する課題' };
    const create = (input = body) => app.request(path, { method: 'POST', body: input });
    const first = await create();
    expect(first.status).toBe(kind === 'saved' ? 201 : 202);
    const id = `pufu-alice-${request_id}`;
    expect((await remove(id)).status).toBe(200);
    expect((await create()).status).toBe(409);
    expect((await app.request(`/api/v1/pufus/${id}`)).status).toBe(404);
    expect(
      (await app.env.DB.prepare('SELECT * FROM pufu_phases WHERE pufu_id=?').bind(id).all())
        .results,
    ).toEqual([]);
    expect((await create({ ...body, request_id: crypto.randomUUID() })).status).toBe(
      kind === 'saved' ? 201 : 202,
    );
    expect(
      await app.env.DB.prepare('SELECT * FROM deleted_pufus WHERE id=?').bind(id).first(),
    ).toEqual({ id, user_id: 'alice' });
    // 退会時の連鎖削除では、新たな履歴を作らず既存の履歴も除去する。
    vi.spyOn(app.env.ARTICLE_WORKFLOW, 'get').mockRejectedValue(new Error('instance.not_found'));
    expect((await app.request('/api/v1/me', { method: 'DELETE' })).status).toBe(200);
    expect((await app.env.DB.prepare('SELECT * FROM deleted_pufus').all()).results).toEqual([]);
  },
);
