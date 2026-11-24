import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/api/app';
import type { Env } from '../server/env';
import { articleMemoryStatements } from '../server/infrastructure/db';
import { scheduledMaintenance } from '../server/infrastructure/jobs/jobs';
import { ArticleWorkflow } from '../server/infrastructure/jobs/workflows';
import { queueDueReflections } from '../server/features/questions/reflection-repository';
import { reflectionPeriodEnd, type ReflectionList } from '../shared/reflections';
import type { User } from '../shared/domain';
import { mockEvent, mockStep, testApp } from './helpers';

const day = 86400000;
const apiPath = '/api/v1/reflections';

describe('プロジェクトの自動振り返り', () => {
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
  const update = (id: string, body: object, user = 'alice') =>
    app.request(`${apiPath}/${id}`, { method: 'PATCH', body, user });

  it('週をまたいだ3件から自動追加し、前の問いが未回答でも次の期間に1件だけ追加する', async () => {
    const week = reflectionPeriodEnd(Date.now(), 'weekly') - 7 * day;
    const db = app.env.DB;
    await saveStock('最初の観察', week - 9 * day);
    await saveStock('次の観察', week - 8 * day);
    await saveStock('別の保存先', week - 8 * day, 'alice-second');
    await queueDueReflections(app.env, week - 1);
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
    await queueDueReflections(app.env, week + 600000);
    await runQueued();
    const [question] = await list();
    expect(question).toMatchObject({
      status: 'ready',
      text,
      end_at: new Date(week).toISOString(),
      stocks: [{ id: '最初の観察' }, { id: '最後の観察' }],
      pufus: [{ id: 'score', title: '説明を減らすプ譜' }],
    });
    const cards = await app.request(
      `/api/v1/questions?include_reflections=true&project_id=alice-project&q=${encodeURIComponent(text)}`,
    );
    expect(await cards.json()).toMatchObject({
      total: 1,
      questions: [
        {
          id: `reflection-${question.id}`,
          source: 'ai',
          status: 'ready',
          is_reflection: 1,
          text,
          stocks: [{ id: '最初の観察' }, { id: '最後の観察' }],
          has_pufu: 1,
        },
      ],
    });
    const details = await app.request(`/api/v1/questions/reflection-${question.id}`);
    expect(await details.json()).toMatchObject({
      question: { note: '', reflection_generation: 1 },
      pufus: [{ id: 'score' }],
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
    const nextText = '週明けの判断で何を優先しましたか？';
    model({ question: { text: nextText, stocks: [1, 2], pufus: [] } });
    await Promise.all([
      queueDueReflections(app.env, nextWeek),
      queueDueReflections(app.env, nextWeek),
    ]);
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM processing_jobs WHERE purpose='reflection' AND status='pending'",
        )
        .first(),
    ).toEqual({ count: 1 });
    await runQueued();
    const reflections = await list();
    expect(reflections).toHaveLength(2);
    expect(reflections).toContainEqual(question);
    const next = reflections.find(({ id }) => id !== question.id);
    expect(next).toMatchObject({
      status: 'ready',
      text: nextText,
      start_at: question.end_at,
      end_at: new Date(nextWeek).toISOString(),
      stocks: [{ id: '週明け' }, { id: '週の途中' }],
    });
    const pages = await Promise.all(
      [1, 2].map(async (page) => {
        const response = await app.request(
          `/api/v1/questions?include_reflections=true&project_id=alice-project&limit=2&page=${page}`,
        );
        return (await response.json()) as { total: number; questions: { id: string }[] };
      }),
    );
    expect(pages.map(({ total }) => total)).toEqual([3, 3]);
    expect(pages.map((page) => page.questions.length)).toEqual([2, 1]);
    expect(pages.flatMap((page) => page.questions.map(({ id }) => id)).sort()).toEqual(
      ['related-question', ...reflections.map(({ id }) => `reflection-${id}`)].sort(),
    );
    expect((await update(question.id, { action: 'dismiss', generation: 1 })).status).toBe(200);
    expect(await list()).toEqual([next]);
  });

  it('保存済みの振り返りを本人のカードに表示し、回答をメモとして扱う', async () => {
    const db = app.env.DB;
    await db.batch([
      db.prepare(
        "UPDATE projects SET is_public=1,public_id='reflection-public' WHERE id='alice-project'",
      ),
      db.prepare(
        `INSERT INTO reflections(id,project_id,start_at,end_at,status,text,answer,dismissed_at)
         VALUES ('old-answer','alice-project','2025-01-01','2025-01-06','ready','以前の問い？','保存済みの回答',NULL),
                ('old-dismissed','alice-project','2025-01-06','2025-01-13','ready','見送った問い？',NULL,'2025-01-14'),
                ('in-progress','alice-second','2025-01-13','2025-01-20','queued',NULL,NULL,NULL)`,
      ),
    ]);
    const path = '/api/v1/questions/reflection-old-answer';
    const collection = '/api/v1/questions?include_reflections=true';
    const projects = '/api/v1/projects?include_reflections=true';
    const result = await app.request(collection);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toMatchObject({
      total: 1,
      questions: [{ id: 'reflection-old-answer', text: '以前の問い？', is_favorite: 0 }],
    });
    expect(await (await app.request('/api/v1/questions')).json()).toMatchObject({ total: 0 });
    expect(await (await app.request(projects)).json()).toMatchObject({
      projects: expect.arrayContaining([
        expect.objectContaining({ id: 'alice-project', question_count: 1 }),
      ]),
    });
    expect(await (await app.request(path)).json()).toMatchObject({
      question: { note: '保存済みの回答' },
    });
    expect((await app.request(path, { user: 'bob' })).status).toBe(404);
    expect((await app.request(path, { headers: { Cookie: '' } })).status).toBe(401);
    const publication = await app.request('/api/public/projects/reflection-public/questions', {
      headers: { Cookie: '' },
    });
    expect(await publication.json()).toMatchObject({ items: [] });
    expect(
      (
        await app.request(
          '/api/public/projects/reflection-public/questions/reflection-old-answer',
          {
            headers: { Cookie: '' },
          },
        )
      ).status,
    ).toBe(404);
    const { user } = (await (await app.request('/api/v1/me')).json()) as { user: User };
    const mcp = createApp({ kind: 'mcp', user, tokenProjectId: 'alice-project' });
    const mcpGet = (endpoint: string) =>
      mcp.fetch(new Request(`${app.env.APP_URL}${endpoint}`), app.env, app.ctx);
    expect(await (await mcpGet(collection)).json()).toMatchObject({ total: 0 });
    expect((await mcpGet(path)).status).toBe(404);
    expect(await (await mcpGet(projects)).json()).toMatchObject({
      projects: [{ id: 'alice-project', question_count: 0 }],
    });

    expect(
      (
        await app.request(path, {
          method: 'PATCH',
          body: { note: '他人の変更', generation: 1 },
          user: 'bob',
        })
      ).status,
    ).toBe(404);
    expect(
      (await app.request(path, { method: 'PATCH', body: { project_id: 'alice-second' } })).status,
    ).toBe(400);
    const saveNote = (generation: number) =>
      app.request(path, {
        method: 'PATCH',
        body: { note: '追記した回答', generation },
      });
    await db
      .prepare("UPDATE reflections SET status='queued',generation=2 WHERE id='old-answer'")
      .run();
    expect(await (await app.request(path)).json()).toMatchObject({
      question: { note: '保存済みの回答', reflection_generation: 1 },
    });
    expect((await saveNote(2)).status).toBe(409);
    await db.prepare("UPDATE reflections SET status='ready' WHERE id='old-answer'").run();
    expect((await saveNote(1)).status).toBe(409);
    expect(await (await app.request(path)).json()).toMatchObject({
      question: { note: '保存済みの回答', reflection_generation: 2 },
    });
    const updated = await saveNote(2);
    expect(await updated.json()).toMatchObject({ question: { note: '追記した回答' } });
    const favorite = await app.request(`${path}/favorite`, {
      method: 'PATCH',
      body: { is_favorite: true },
    });
    expect(await favorite.json()).toEqual({ id: 'reflection-old-answer', is_favorite: 1 });
    expect(await (await app.request(`${collection}&favorite=true`)).json()).toMatchObject({
      total: 1,
      questions: [{ id: 'reflection-old-answer', is_favorite: 1 }],
    });
    expect((await app.request(path, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(path)).status).toBe(404);
    expect(await (await app.request(collection)).json()).toMatchObject({ total: 0 });
    expect(await (await app.request(projects)).json()).toMatchObject({
      projects: expect.arrayContaining([
        expect.objectContaining({ id: 'alice-project', question_count: 0 }),
      ]),
    });
  });

  it.each(['summary', 'note'])(
    '空の試行のあとに既存ストックの%sを使えるようになると再検討する',
    async (changed) => {
      const week = reflectionPeriodEnd(Date.now(), 'weekly') - 7 * day;
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
      await queueDueReflections(app.env, week);
      await runQueued();
      expect(await list()).toEqual([]);
      const nextWeek = week + 7 * day;
      await queueDueReflections(app.env, nextWeek);
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
      await queueDueReflections(app.env, nextWeek);
      model({
        question: { text: '観察の目の付け所はどう変わりましたか？', stocks: [1, 4], pufus: [] },
      });
      await runQueued();
      expect((await list())[0].stocks.map(({ id }) => id)).toContain('要約待ち');
    },
  );

  it.each([
    ['weekly', '2025-02-09T15:00:00Z', 1],
    ['biweekly', '2025-02-16T15:00:00Z', 8],
    ['monthly', '2025-01-31T15:00:00Z', 8],
  ])('%sの日本時間の締めまで待ち、締め時刻のストックは次回へ回す', async (period, date, age) => {
    const end = Date.parse(date);
    const settings = await app.request('/api/v1/projects/alice-project', {
      method: 'PATCH',
      body: { name: '周期の確認', reflection_period: period },
    });
    expect(settings.status).toBe(200);
    for (const offset of [0, 1, 2]) await saveStock(`対象${offset}`, end - age * day + offset);
    await saveStock('次の期間', end);
    // 隔週の締めの1週前や、月末までの最終月曜を過ぎてもまだ作らない。
    await queueDueReflections(app.env, end - 1);
    expect(await app.env.DB.prepare('SELECT id FROM reflections').first()).toBeNull();
    const ai = model({
      question: { text: '記録の変化は何ですか？', stocks: [1, 2, 3], pufus: [] },
    });
    await queueDueReflections(app.env, end);
    await runQueued();
    const [reflection] = await list();
    expect(reflection.end_at).toBe(new Date(end).toISOString());
    expect(reflection.stocks.map(({ id }) => id)).toEqual(['対象0', '対象1', '対象2']);
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it('周期を変えても、前に確認した締め以前には戻らない', async () => {
    const week = Date.parse('2025-02-09T15:00:00Z');
    for (const offset of [10, 11, 12]) await saveStock(`記録${offset}`, week - offset * day);
    model({ question: null });
    await queueDueReflections(app.env, week);
    await runQueued();
    // 空の確認後に材料の版も変わっており、過去の月初までに3件ある。
    await app.env.DB.prepare(
      "UPDATE projects SET memory_revision=memory_revision+1 WHERE id='alice-project'",
    ).run();
    await saveStock('追加の記録', week - 13 * day);
    expect(
      (
        await app.request('/api/v1/projects/alice-project', {
          method: 'PATCH',
          body: { name: '周期の確認', reflection_period: 'monthly' },
        })
      ).status,
    ).toBe(200);
    await queueDueReflections(app.env, week);
    expect(await app.env.DB.prepare('SELECT COUNT(*) AS count FROM reflections').first()).toEqual({
      count: 1,
    });
    const nextMonth = Date.parse('2025-02-28T15:00:00Z');
    await queueDueReflections(app.env, nextMonth);
    model({ question: { text: 'どの時点で考えが変わりましたか？', stocks: [1], pufus: [] } });
    await runQueued();
    expect((await list())[0].end_at).toBe(new Date(nextMonth).toISOString());
  });

  it('周期の変更を生成開始前に反映し、合わない締めの予約を取り消す', async () => {
    const week = Date.parse('2025-02-09T15:00:00Z');
    for (const offset of [1, 2, 3]) await saveStock(`記録${offset}`, week - offset * day);
    await queueDueReflections(app.env, week);
    expect(
      (
        await app.request('/api/v1/projects/alice-project', {
          method: 'PATCH',
          body: { name: '月ごとに振り返る', reflection_period: 'monthly' },
        })
      ).status,
    ).toBe(200);
    const ai = model({ question: { text: 'どんな変化がありましたか？', stocks: [1], pufus: [] } });
    await runQueued();
    expect(ai).not.toHaveBeenCalled();
    expect(await app.env.DB.prepare('SELECT id FROM reflections').first()).toBeNull();

    const month = Date.parse('2025-02-28T15:00:00Z');
    await queueDueReflections(app.env, month);
    await runQueued();
    expect(ai).toHaveBeenCalledTimes(1);
    expect((await list())[0].end_at).toBe(new Date(month).toISOString());
  });

  it('同時枠が1なら、別プロジェクトの再生成を同時に受けても1件だけ予約する', async () => {
    const week = reflectionPeriodEnd(Date.now(), 'weekly');
    for (const project of ['alice-project', 'alice-second'])
      for (const offset of [1, 2, 3])
        await saveStock(`${project}-${offset}`, week - offset * day, project);
    await queueDueReflections(app.env, week);
    model({ question: { text: '設定した周期で何に気づきましたか？', stocks: [1], pufus: [] } });
    await runQueued();
    await runQueued();
    const reflections = await list();
    expect(reflections).toHaveLength(2);
    app.env.AI_CONCURRENT_JOBS = '1';
    const responses = await Promise.all(
      reflections.map(({ id }) => update(id, { action: 'alternative', generation: 1 })),
    );
    expect(responses.map((res) => res.status).sort()).toEqual([202, 429]);
    expect((await list()).map(({ generation }) => generation).sort()).toEqual([1, 2]);
    expect(
      await app.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM ai_operations WHERE user_id='alice' AND id LIKE 'reflection-regeneration-%'",
      ).first(),
    ).toEqual({ count: 1 });
  });

  it('設定がオフの期間には追加せず、自動で届いた問いの別案と回答を本人だけに保存する', async () => {
    const db = app.env.DB;
    await db
      .prepare(
        `UPDATE projects SET auto_generate_questions=0,is_public=1,public_id='reflection-public'
      WHERE id='alice-project'`,
      )
      .run();
    const week = reflectionPeriodEnd(Date.now(), 'weekly');
    for (const index of [1, 2, 3]) await saveStock(`記録${index}`, week - index * day);
    await saveStock('次の期間', week);
    await saveStock('他人のストック', week - day, 'bob-project', 'bob');
    await queueDueReflections(app.env, week);
    expect(await db.prepare('SELECT id FROM reflections').first()).toBeNull();
    expect(
      (
        await app.request(apiPath, {
          method: 'POST',
          body: {
            project_id: 'alice-project',
            from: '2025-01-01',
            to: '2025-01-31',
            request_id: crypto.randomUUID(),
          },
        })
      ).status,
    ).toBe(404);
    expect(await db.prepare('SELECT id FROM reflections').first()).toBeNull();

    expect(
      (
        await app.request('/api/v1/projects/alice-project', {
          method: 'PATCH',
          body: { name: '反映を確認する', auto_generate_questions: true },
        })
      ).status,
    ).toBe(200);
    await queueDueReflections(app.env, week);
    const ai = model({ question: { text: 'どこに注目しましたか？', stocks: [3], pufus: [] } });
    await runQueued();
    const context = JSON.parse(ai.mock.calls[0][1].messages[1].content);
    expect(context.stocks).toMatchObject([
      { title: '記録3' },
      { title: '記録2' },
      { title: '記録1' },
    ]);
    const [original] = await list();
    const { id } = original;
    expect(original.stocks).toMatchObject([{ id: '記録1' }]);
    app.env.AI_QUESTION_DAILY_LIMIT = '1';
    const limited = await update(id, { action: 'alternative', generation: 1 });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(3600);
    expect(await limited.json()).toMatchObject({ retry_at: expect.any(String) });
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
      const week = reflectionPeriodEnd(Date.now(), 'weekly');
      await saveStock('source', week - 3 * day);
      await saveStock('second-source', week - 2 * day);
      await saveStock('third-source', week - day);
      await queueDueReflections(app.env, week);
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
        expect(await list()).toEqual([]);
        expect(
          await app.env.DB.prepare('SELECT text,status,stock_ids FROM reflections').first(),
        ).toEqual({ text: null, status: 'empty', stock_ids: '[]' });
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
