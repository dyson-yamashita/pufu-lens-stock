import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/api/app';
import type { Env } from '../server/env';
import { articleMemoryStatements } from '../server/infrastructure/db';
import { scheduledMaintenance } from '../server/infrastructure/jobs/jobs';
import { ArticleWorkflow } from '../server/infrastructure/jobs/workflows';
import { queueWeeklyReflections } from '../server/features/questions/reflection-repository';
import { reflectionDay, reflectionWeekStart, type ReflectionList } from '../shared/reflections';
import type { User } from '../shared/domain';
import { mockEvent, mockStep, testApp } from './helpers';

const day = 86400000;
const apiPath = '/api/v1/reflections';

describe('期間を選んで振り返る', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });

  async function saveStock(id: string, at: number, project = 'alice-project', user = 'alice') {
    const db = app.env.DB;
    await db.batch([
      db
        .prepare(
          `INSERT INTO articles(id,user_id,canonical_url,source_url,source_type,domain,title,status,input_text)
        VALUES (?,?,?,'','text','',?,'ready',?)`,
        )
        .bind(id, user, `text:${id}`, id, `${id}の記録`),
      db
        .prepare(
          'INSERT INTO stocks(id,user_id,project_id,article_id,created_at,note) VALUES(?,?,?,?,?,?)',
        )
        .bind(id, user, project, id, new Date(at).toISOString(), `${id}を観察した`),
    ]);
  }
  const model = (output: unknown) => {
    const run = vi.fn<NonNullable<Env['AI']>['run']>(async () => ({ response: output }));
    app.env.AI = { run };
    return run;
  };
  async function runQueued() {
    const job = await app.env.DB.prepare(
      `SELECT id FROM processing_jobs WHERE purpose='reflection' AND status IN ('pending','dispatched')`,
    ).first<{ id: string }>();
    expect(job).not.toBeNull();
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
  }
  async function list(query = '', user = 'alice') {
    const response = await app.request(apiPath + query, { user });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return ((await response.json()) as ReflectionList).reflections;
  }
  function create(
    from: string,
    to = from,
    request_id = crypto.randomUUID(),
    project_id = 'alice-project',
  ) {
    return app.request(apiPath, { method: 'POST', body: { project_id, from, to, request_id } });
  }
  const update = (id: string, body: object, user = 'alice') =>
    app.request(`${apiPath}/${id}`, { method: 'PATCH', body, user });

  it('週をまたいだ3件から自動追加し、未回答を見送った後は次の期間で1件だけ追加する', async () => {
    const week = reflectionWeekStart(Date.now()) - 7 * day;
    const db = app.env.DB;
    await saveStock('最初の観察', week - 9 * day);
    await saveStock('次の観察', week - 8 * day);
    await saveStock('別の保存先', week - 8 * day, 'alice-second');
    await queueWeeklyReflections(app.env, week - 1);
    expect(await db.prepare('SELECT id FROM reflections').first()).toBeNull();
    await saveStock('最後の観察', week - 1);
    await db.batch([
      db
        .prepare(
          `INSERT INTO memories(id,user_id,project_id,revision,text,data_json,article_count,model)
        VALUES ('memory','alice','alice-project',1,'',?,3,'test')`,
        )
        .bind(
          JSON.stringify({ interests: ['説明より観察を優先する'], knowledge: [], questions: [] }),
        ),
      db.prepare(
        `INSERT INTO pufu_scores(id,user_id,project_id,title,task,input_json,editor_version,status)
        VALUES ('score','alice','alice-project','説明を減らすプ譜','迷わず使えるようにする','{}','test','ready'),
        ('foreign-score','bob','bob-project','他人のプ譜','他人の目標','{}','test','ready')`,
      ),
      db.prepare(
        `INSERT INTO questions(id,stock_id,source,text,status)
        VALUES ('related-question','最初の観察','user','観察から得た問い','ready')`,
      ),
      db.prepare("INSERT INTO pufu_questions VALUES ('score','related-question')"),
      db.prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<5)
        INSERT INTO pufu_scores(id,user_id,project_id,task,input_json,editor_version,status,updated_at)
        SELECT 'unrelated-'||i,'alice','alice-project','無関係の目標','{}','test','ready','2099-01-01' FROM n`,
      ),
    ]);
    const text = 'どの観察が説明文を減らす判断につながりましたか？';
    const ai = model({ question: { text, stocks: [1, 3], pufus: [1] } });
    await scheduledMaintenance(app.env, week);
    await queueWeeklyReflections(app.env, week + 600000);
    await runQueued();
    const [question] = await list();
    expect(question).toMatchObject({
      is_weekly: 1,
      status: 'ready',
      text,
      end_at: new Date(week).toISOString(),
      stocks: [{ id: '最初の観察' }, { id: '最後の観察' }],
      pufus: [{ id: 'score', title: '説明を減らすプ譜' }],
    });
    expect(ai).toHaveBeenCalledTimes(1);
    const context = JSON.parse(ai.mock.calls[0][1].messages[1].content);
    expect(context.stocks.map((stock: { title: string }) => stock.title)).toEqual([
      '最初の観察',
      '次の観察',
      '最後の観察',
    ]);
    expect(context.memory.interests).toEqual(['説明より観察を優先する']);
    expect(context.pufus[0]).toMatchObject({
      title: '説明を減らすプ譜',
      goal: '迷わず使えるようにする',
    });
    expect(JSON.stringify(context)).not.toContain('他人の目標');
    for (const [index, id] of ['週明け', '週の途中', '週末'].entries())
      await saveStock(id, week + index * day);
    const nextWeek = week + 7 * day;
    await queueWeeklyReflections(app.env, nextWeek);
    expect(await list()).toHaveLength(1);
    expect((await update(question.id, { action: 'dismiss', generation: 1 })).status).toBe(200);
    model({ question: { text: '週明けの判断で何を優先しましたか？', stocks: [1, 2], pufus: [] } });
    await Promise.all([
      queueWeeklyReflections(app.env, nextWeek),
      queueWeeklyReflections(app.env, nextWeek),
    ]);
    await runQueued();
    const [next] = await list();
    expect(next.id).not.toBe(question.id);
    expect(next.start_at).toBe(question.end_at);
    expect(next.stocks.map(({ id }) => id)).toEqual(['週明け', '週の途中']);
    expect(await list()).toHaveLength(1);
  });

  it.each(['summary', 'note'])(
    '空の試行のあとに既存ストックの%sを使えるようになると再検討する',
    async (changed) => {
      const week = reflectionWeekStart(Date.now()) - 7 * day;
      const db = app.env.DB;
      for (const index of [1, 2, 3]) await saveStock(`記録${index}`, week - index * day);
      await saveStock('要約待ち', week - 1000);
      await db.batch([
        db.prepare("UPDATE articles SET input_text=NULL,status='queued' WHERE id='要約待ち'"),
        db.prepare("UPDATE stocks SET note='' WHERE id='要約待ち'"),
      ]);
      const ai = model({
        question: { text: '存在しない記録に基づく問い？', stocks: [4], pufus: [] },
      });
      await queueWeeklyReflections(app.env, week);
      await runQueued();
      expect(await list()).toEqual([]);
      const nextWeek = week + 7 * day;
      await queueWeeklyReflections(app.env, nextWeek);
      expect(await db.prepare('SELECT COUNT(*) AS count FROM reflections').first()).toEqual({
        count: 1,
      });
      expect(ai).toHaveBeenCalledTimes(1);
      if (changed === 'summary') {
        await db.batch([
          ...articleMemoryStatements(app.env, 'alice', {
            id: '要約待ち',
            generation: 1,
            queue: true,
          }),
          db.prepare("UPDATE articles SET status='ready',summary_json=? WHERE id='要約待ち'").bind(
            JSON.stringify({
              overview: '要約完了後の記録',
              keyPoints: ['反応を観察'],
              topics: [],
            }),
          ),
        ]);
      } else {
        const edited = await app.request(`/api/v1/stocks/${encodeURIComponent('要約待ち')}`, {
          method: 'PATCH',
          body: { project_id: 'alice-project', note: '新しい観察メモ' },
        });
        expect(edited.status).toBe(200);
      }
      await queueWeeklyReflections(app.env, nextWeek);
      model({
        question: { text: '観察の目の付け所はどう変わりましたか？', stocks: [1, 4], pufus: [] },
      });
      await runQueued();
      expect((await list())[0].stocks.map(({ id }) => id)).toContain('要約待ち');
    },
  );

  it('同時処理枠が1なら、別プロジェクトからの手動要求を同時に受けても1件だけ予約する', async () => {
    const timestamp = reflectionWeekStart(Date.now()) - day;
    const date = reflectionDay(timestamp);
    await saveStock('one', timestamp);
    await saveStock('two', timestamp, 'alice-second');
    app.env.AI_CONCURRENT_JOBS = '1';
    const responses = await Promise.all([
      create(date),
      create(date, date, crypto.randomUUID(), 'alice-second'),
    ]);
    expect(responses.map((res) => res.status).sort()).toEqual([202, 429]);
    expect(await list()).toHaveLength(1);
    expect(
      await app.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM ai_operations WHERE user_id='alice' AND kind='question'",
      ).first(),
    ).toEqual({ count: 1 });
  });

  it('自動追加オフでも指定した日本時間の1日・1件から作り、別案と回答を本人だけに保存する', async () => {
    const db = app.env.DB;
    await db
      .prepare(
        `UPDATE projects SET auto_generate_questions=0,is_public=1,public_id='reflection-public'
      WHERE id='alice-project'`,
      )
      .run();
    const timestamp = reflectionWeekStart(Date.now()) - 2 * day;
    const date = reflectionDay(timestamp);
    await saveStock('日付境界の手前', timestamp - 1);
    await saveStock('当日のストック', timestamp);
    await saveStock('翌日のストック', timestamp + day);
    await saveStock('他人のストック', timestamp, 'bob-project', 'bob');
    await queueWeeklyReflections(app.env, reflectionWeekStart(Date.now()));
    expect(await db.prepare('SELECT id FROM reflections').first()).toBeNull();

    const request = crypto.randomUUID();
    expect((await create(date, date, request, 'bob-project')).status).toBe(404);
    expect((await create('2000-01-01')).status).toBe(422);
    expect((await create('2026-02-30')).status).toBe(400);
    const created = await create(date, date, request);
    expect(created.status).toBe(202);
    const { id } = (await created.json()) as { id: string };
    const replay = await create(date, date, request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ id });
    expect((await create('2000-01-01', date, request)).status).toBe(409);
    expect((await create(date)).status).toBe(409);
    const ai = model({ question: { text: 'どこに注目しましたか？', stocks: [1], pufus: [] } });
    await runQueued();
    const context = JSON.parse(ai.mock.calls[0][1].messages[1].content);
    expect(context.stocks).toMatchObject([{ title: '当日のストック' }]);
    const [original] = await list();
    expect(original).toMatchObject({ id, stocks: [{ id: '当日のストック' }] });
    app.env.AI_QUESTION_DAILY_LIMIT = '1';
    for (const limited of [
      await create(date),
      await update(id, { action: 'alternative', generation: 1 }),
    ]) {
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(3600);
      expect(await limited.json()).toMatchObject({ retry_at: expect.any(String) });
    }
    expect((await create(date, date, request)).status).toBe(200);
    expect(await list()).toEqual([original]);
    app.env.AI_QUESTION_DAILY_LIMIT = undefined;
    expect((await update(id, { action: 'alternative', generation: 1 })).status).toBe(202);
    const alternative = '同じ場面でもう一度試すなら何を変えますか？';
    model({ question: { text: alternative, stocks: [1], pufus: [] } });
    await runQueued();
    expect((await list())[0]).toMatchObject({ text: alternative, generation: 2 });
    expect((await update(id, { action: 'alternative', generation: 2 })).status).toBe(202);
    model({ question: { text: 'どこに注目しましたか?', stocks: [1], pufus: [] } });
    await runQueued();
    expect((await list())[0]).toMatchObject({
      status: 'empty',
      text: alternative,
      generation: 3,
    });
    expect((await update(id, { action: 'answer', generation: 1, answer: '古い回答' })).status).toBe(
      409,
    );
    const reply = { action: 'answer', generation: 3, answer: '手順が変わったときの反応。' };
    expect((await update(id, reply, 'bob')).status).toBe(404);
    expect(
      (
        await app.request(`${apiPath}/${id}`, {
          method: 'PATCH',
          body: reply,
          headers: { Origin: 'https://example.com' },
        })
      ).status,
    ).toBe(403);
    expect((await update(id, reply)).status).toBe(200);
    expect((await list())[0]).toMatchObject({ answer: reply.answer, status: 'ready' });
    expect(await list('', 'bob')).toEqual([]);
    expect((await app.request(apiPath, { headers: { Cookie: '' } })).status).toBe(401);
    const issued = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: '振り返りの権限確認' },
    });
    expect(issued.status).toBe(201);
    const { token } = (await issued.json()) as { token: string };
    expect(
      (
        await app.request(apiPath, {
          headers: { Cookie: '', Authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(403);
    const { user } = (await (await app.request('/api/v1/me')).json()) as { user: User };
    const mcp = createApp({ kind: 'mcp', user, tokenProjectId: 'alice-project' });
    expect(
      (await mcp.fetch(new Request(`${app.env.APP_URL}${apiPath}`), app.env, app.ctx)).status,
    ).toBe(403);
    const published = await app.request('/api/public/projects/reflection-public/questions', {
      headers: { Cookie: '' },
    });
    expect(await published.json()).toMatchObject({ items: [] });
  });

  it.each(['stock', 'project'])(
    '生成中に%sが元の保存先からなくなると結果を確定しない',
    async (target) => {
      const timestamp = reflectionWeekStart(Date.now()) - day;
      const date = reflectionDay(timestamp);
      await saveStock('source', timestamp);
      const created = await create(date);
      expect(created.status).toBe(202);
      app.env.AI = {
        run: async () => {
          const changed =
            target === 'stock'
              ? await app.request('/api/v1/stocks/source', {
                  method: 'PATCH',
                  body: { project_id: 'alice-second', note: 'メモ' },
                })
              : await app.request('/api/v1/projects/alice-project', { method: 'DELETE' });
          expect(changed.status).toBe(200);
          return {
            response: { question: { text: '前の記録からの問い？', stocks: [1], pufus: [] } },
          };
        },
      };
      await runQueued();
      if (target === 'stock') {
        expect(await list()).toMatchObject([{ text: null, status: 'empty', stocks: [] }]);
      } else {
        expect(await list()).toEqual([]);
        const cached = await app.env.DB.prepare(
          "SELECT result_json FROM ai_calls WHERE job_id IN (SELECT id FROM processing_jobs WHERE purpose='reflection')",
        ).first();
        expect(cached).toEqual({ result_json: null });
      }
    },
  );
});
