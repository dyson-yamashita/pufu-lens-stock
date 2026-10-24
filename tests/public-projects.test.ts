import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testApp, mockEvent, mockStep } from './helpers';
import { ArticleWorkflow } from '../server/workflows';
import type { Job } from '../server/env';
import type {
  Publication,
  PublicList,
  PublicProject,
  PublicStock,
  PublicQuestion,
  PublicPufu,
} from '../shared/public-project';
import { elementKeys, type PufuScore } from '../shared/pufu';
import { hash } from '../server/security';
import { createApp } from '../server/api';

function score(text: string): PufuScore {
  const node = (id: string) => ({
    uuid: id,
    text,
    comment: { color: 'blue' as const, text: `振り返り：${text}` },
  });
  return {
    gainingGoal: node('goal'),
    winCondition: node('win'),
    purposes: [{ ...node('purpose'), measures: [{ ...node('measure'), color: 'green' }] }],
    elements: Object.fromEntries(
      elementKeys.map((key) => [key, node(key)]),
    ) as PufuScore['elements'],
  };
}
describe('公開プロジェクトの参照専用API', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  const anonymous = { headers: { Cookie: '' } };
  const publication = (id = 'alice-project', is_public = true, options = {}) =>
    app.request(`/api/v1/projects/${id}/publication`, {
      method: 'PATCH',
      body: { is_public, public_description: '公開用の紹介文' },
      ...options,
    });
  async function publish(id = 'alice-project') {
    const response = await publication(id);
    expect(response.status).toBe(200);
    return ((await response.json()) as { publication: Publication }).publication.public_id!;
  }
  const get = (path: string) => app.request(`/api/public/projects${path}`, anonymous);
  const root = (key: string) => `/${key}`;
  beforeEach(async () => {
    app = await testApp();
    await app.env.DB.batch([
      app.env.DB.prepare(
        "UPDATE projects SET description='SECRET_INTERNAL_DESCRIPTION' WHERE id='alice-project'",
      ),
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,status,summary_json,input_text,error,model) VALUES ('article','alice','https://example.com/a','https://example.com/a','公開する記事','example.com','ready',?,'SECRET_BODY','SECRET_ERROR','SECRET_MODEL')",
      ).bind(
        JSON.stringify({
          overview: '公開する要約',
          keyPoints: ['要点'],
          topics: ['テーマ'],
          private_extra: 'SECRET_SUMMARY_EXTRA',
        }),
      ),
      app.env.DB.prepare(
        "INSERT INTO stocks (id,user_id,project_id,article_id,note) VALUES ('stock','alice','alice-project','article','SECRET_NOTE'),('private-stock','alice','alice-second','article','SECRET_OTHER_NOTE')",
      ),
      app.env.DB.prepare(
        "INSERT INTO questions (id,project_id,stock_id,source,text,status) VALUES ('question','alice-project','stock','ai','公開する問い？','ready'),('independent','alice-project',NULL,'user','記事に紐づかない問い？','ready'),('pending','alice-project','stock','user','SECRET_PENDING','generating'),('private-question','alice-second','private-stock','user','SECRET_PRIVATE_QUESTION','ready')",
      ),
      app.env.DB.prepare(
        "INSERT INTO pufu_scores (id,user_id,question_id,task,input_json,generated_json,score_json,editor_version,status,current_phase,error,model) VALUES ('pufu','alice','question','公開する課題','{\"userMemory\":\"SECRET_USER_MEMORY\",\"projectMemory\":\"SECRET_PROJECT_MEMORY\",\"note\":\"SECRET_CONTEXT_NOTE\"}','SECRET_GENERATED',?,'0.9.14','ready',2,'SECRET_PUFU_ERROR','SECRET_PUFU_MODEL'),('private-pufu','alice','private-question','SECRET_PRIVATE_TASK','{}',NULL,?,'0.9.14','ready',1,NULL,NULL),('pending-pufu','alice','question','SECRET_PENDING_TASK','{}',NULL,NULL,'0.9.14','queued',1,NULL,NULL)",
      ).bind(JSON.stringify(score('古い本文')), JSON.stringify(score('秘密の局面'))),
      app.env.DB.prepare(
        "INSERT INTO pufu_phases (pufu_id,number,score_json,created_at,updated_at) VALUES ('pufu',1,?,'2026-10-01','2026-10-01'),('pufu',2,?,'2026-10-02','2026-10-02')",
      ).bind(JSON.stringify(score('SECRET_OLD_PHASE')), JSON.stringify(score('公開する最新局面'))),
    ]);
  });
  afterEach(async () => {
    await app.dispose();
  });

  it.each(['queued', 'generating', 'failed'])(
    '短文メモの問いが%sでも、最後に確定した公開問いとプ譜を閲覧できる',
    async (status) => {
      await app.env.DB.prepare("UPDATE articles SET summary_json=? WHERE id='article'")
        .bind(
          JSON.stringify({
            overview: '短い本文',
            keyPoints: ['短い本文'],
            topics: [],
            shortSource: true,
          }),
        )
        .run();
      const key = await publish();
      const response = await app.request('/api/v1/stocks/stock', {
        method: 'PATCH',
        body: { note: '公開した問いに反映する理由', project_id: 'alice-project' },
      });
      expect(response.status).toBe(200);
      expect(
        await app.env.DB.prepare("SELECT status FROM questions WHERE id='question'").first(),
      ).toEqual({ status: 'queued' });
      if (status !== 'queued')
        await app.env.DB.prepare("UPDATE questions SET status=? WHERE id='question'")
          .bind(status)
          .run();
      expect(await (await get(`${root(key)}/questions`)).json()).toMatchObject({
        total: 2,
        items: expect.arrayContaining([
          expect.objectContaining({ id: 'question', text: '公開する問い？' }),
        ]),
      });
      for (const path of ['/stocks/stock', '/questions/question', '/pufus/pufu']) {
        const publicResponse = await get(`${root(key)}${path}`);
        expect(publicResponse.status).toBe(200);
        const text = await publicResponse.text();
        expect(text).toContain('公開する問い？');
        expect(text).not.toContain('公開した問いに反映する理由');
      }
      if (status === 'queued') {
        app.env.LOCAL_DEMO_ENABLED = 'true';
        const job = await app.env.DB.prepare(
          "SELECT * FROM processing_jobs WHERE kind='question' AND target_id='stock' ORDER BY revision DESC LIMIT 1",
        ).first<Job>();
        await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
        const regenerated = await get(`${root(key)}/questions/question`);
        expect(regenerated.status).toBe(200);
        const text = await regenerated.text();
        expect(text).toContain('短い本文');
        expect(text).not.toContain('公開した問いに反映する理由');
      }
    },
  );

  it('既存・新規プロジェクトは非公開で、公開設定は所有者のセッションと同一Originでのみ変更できる', async () => {
    const initial = await app.request('/api/v1/projects/alice-project/publication');
    expect(await initial.json()).toMatchObject({
      publication: { is_public: false, public_id: null, public_description: '' },
    });
    expect((await get('')).status).toBe(200);
    expect(await (await get('')).json()).toMatchObject({ total: 0, items: [] });
    expect((await publication('alice-project', true, anonymous)).status).toBe(401);
    expect((await publication('alice-project', true, { user: 'bob' })).status).toBe(404);
    expect(
      (await publication('alice-project', true, { headers: { Origin: 'https://evil.example' } }))
        .status,
    ).toBe(403);
    expect(
      (await app.request('/api/v1/projects/alice-project/publication', { user: 'bob' })).status,
    ).toBe(404);
    const created = await app.request('/api/v1/projects', {
      method: 'POST',
      body: { name: '新規プロジェクト' },
    });
    const { id } = (await created.json()) as { id: string };
    expect(await (await app.request(`/api/v1/projects/${id}/publication`)).json()).toMatchObject({
      publication: { is_public: false, public_id: null },
    });
  });
  it('公開設定を外部連携用のトークンやMCPから変更・取得できない', async () => {
    await app.env.DB.prepare(
      "INSERT INTO api_tokens (id,user_id,name,token_hash,prefix,project_id) VALUES ('token','alice','token',?,'pls_test','alice-project')",
    )
      .bind(await hash('pls_test_publication_123456789'))
      .run();
    for (const method of ['GET', 'PATCH']) {
      const response = await app.request('/api/v1/projects/alice-project/publication', {
        method,
        headers: { Authorization: 'Bearer pls_test_publication_123456789' },
        ...(method === 'PATCH' ? { body: { is_public: true, public_description: '' } } : {}),
      });
      expect(response.status).toBe(403);
      const mcp = createApp({
        kind: 'mcp',
        tokenProjectId: null,
        user: { id: 'alice', name: 'Alice', email: 'alice@example.com', bio: '', avatar_url: null },
      });
      const viaMcp = await mcp.request(
        'http://localhost:5173/api/v1/projects/alice-project/publication',
        {
          method,
          ...(method === 'PATCH'
            ? { body: JSON.stringify({ is_public: true, public_description: '' }) }
            : {}),
        },
        app.env,
        app.ctx,
      );
      expect(viaMcp.status).toBe(403);
    }
  });
  it('公開後は匿名で一覧と本文以外の要約・問い・最新のプ譜を閲覧でき、内部情報を返さない', async () => {
    const key = await publish();
    const paths = [
      '',
      root(key),
      `${root(key)}/stocks`,
      `${root(key)}/stocks/stock`,
      `${root(key)}/questions`,
      `${root(key)}/questions/question`,
      `${root(key)}/pufus/pufu`,
    ];
    for (const path of paths) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      const text = await response.text();
      expect(text).not.toContain('SECRET_');
      expect(text).not.toContain('alice@example.com');
      expect(text).not.toContain('input_json');
      expect(text).not.toContain('context');
    }
    const stocks = (await (await get(`${root(key)}/stocks`)).json()) as PublicList<PublicStock>;
    expect(stocks.items).toHaveLength(1);
    expect(stocks.items[0]).toEqual({
      id: 'stock',
      title: '公開する記事',
      source_url: 'https://example.com/a',
      domain: 'example.com',
      created_at: expect.any(String),
      summary: { overview: '公開する要約', keyPoints: ['要点'], topics: ['テーマ'] },
    });
    const questions = (await (
      await get(`${root(key)}/questions`)
    ).json()) as PublicList<PublicQuestion>;
    expect(questions.total).toBe(2);
    expect(questions.items.find((q) => q.id === 'independent')).toMatchObject({
      stock_id: null,
      pufu_count: 0,
    });
    expect(questions.items.find((q) => q.id === 'question')?.pufu_count).toBe(1);
    const pufu = (await (await get(`${root(key)}/pufus/pufu`)).json()) as { pufu: PublicPufu };
    expect(pufu.pufu.current_phase).toBe(2);
    expect(pufu.pufu.score.gainingGoal.text).toBe('公開する最新局面');
    expect(pufu.pufu.score.elements.people.comment.text).toBe('振り返り：公開する最新局面');
  });
  it('ストック詳細は同じ保存先・ストックの完成した問いだけを返し、AI生成やジョブを起動しない', async () => {
    const key = await publish();
    const ai = vi.fn(async () => {
      throw new Error('公開アクセスでAIを起動しない');
    });
    app.env.AI = { run: ai };
    await app.env.DB.prepare(
      "INSERT INTO questions (id,project_id,stock_id,source,text,status) VALUES ('manual-stock','alice-project','stock','user','自分の関連する問い','ready')",
    ).run();
    const response = await get(`${root(key)}/stocks/stock`);
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      stock: PublicStock;
      questions: PublicQuestion[];
      total: number;
      has_more: boolean;
    };
    expect(data.stock.summary?.keyPoints).toEqual(['要点']);
    expect(data.questions.map((q) => q.id).sort()).toEqual(['manual-stock', 'question']);
    expect(data.questions.find((q) => q.id === 'question')).toMatchObject({
      source: 'ai',
      pufu_count: 1,
    });
    expect(data.total).toBe(2);
    expect(data.has_more).toBe(false);
    expect(ai).not.toHaveBeenCalled();
    expect(app.env.ARTICLE_WORKFLOW!.create).not.toHaveBeenCalled();
    expect(await app.env.DB.prepare('SELECT COUNT(*) AS n FROM processing_jobs').first()).toEqual({
      n: 0,
    });
    await app.env.DB.prepare("DELETE FROM questions WHERE stock_id='stock'").run();
    expect(await (await get(`${root(key)}/stocks/stock`)).json()).toMatchObject({
      questions: [],
      total: 0,
      has_more: false,
    });
  });
  it('公開URLから別のプロジェクトの問い・プ譜・生成途中の情報へアクセスできない', async () => {
    const key = await publish();
    const other = await publish('alice-second');
    for (const path of [
      `${root(key)}/stocks/private-stock`,
      `${root(other)}/stocks/stock`,
      `${root(key)}/questions/private-question`,
      `${root(key)}/pufus/private-pufu`,
      `${root(other)}/pufus/pufu`,
      `${root(key)}/questions/pending`,
      `${root(key)}/pufus/pending-pufu`,
      '/alice-project',
      '/unknown/stocks',
      '/unknown/questions',
      `${root(key)}/stocks/stock/content`,
      `${root(key)}/memory`,
    ]) {
      expect((await get(path)).status).toBe(404);
    }
    expect((await app.request('/api/v1/pufus/pufu', anonymous)).status).toBe(401);
  });
  it('公開の読み取りは書き込み・ジョブ起動を行わず、局面が未移行でも保存済みのプ譜を参照する', async () => {
    const key = await publish();
    await app.env.DB.prepare("DELETE FROM pufu_phases WHERE pufu_id='pufu'").run();
    const before = await app.env.DB.prepare('SELECT COUNT(*) AS n FROM processing_jobs').first();
    const response = await get(`${root(key)}/pufus/pufu`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      pufu: { score: { gainingGoal: { text: '古い本文' } } },
    });
    expect(await app.env.DB.prepare('SELECT COUNT(*) AS n FROM processing_jobs').first()).toEqual(
      before,
    );
    expect(await app.env.DB.prepare('SELECT COUNT(*) AS n FROM pufu_phases').first()).toEqual({
      n: 0,
    });
    expect(app.env.ARTICLE_WORKFLOW!.create).not.toHaveBeenCalled();
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      for (const path of [
        root(key),
        `${root(key)}/stocks`,
        `${root(key)}/stocks/stock`,
        `${root(key)}/questions/question`,
        `${root(key)}/pufus/pufu`,
      ]) {
        expect(
          (
            await app.request(`/api/public/projects${path}`, {
              ...anonymous,
              method,
              body: { score: score('悪意の編集') },
            })
          ).status,
        ).toBe(404);
      }
    }
    expect(
      await app.env.DB.prepare("SELECT score_json FROM pufu_scores WHERE id='pufu'").first(),
    ).toEqual({ score_json: JSON.stringify(score('古い本文')) });
  });
  it('非公開化で一覧と全参照を止め、再公開しても同じURLを使え、削除時もアクセスできない', async () => {
    const key = await publish();
    const paths = [
      root(key),
      `${root(key)}/stocks`,
      `${root(key)}/stocks/stock`,
      `${root(key)}/questions`,
      `${root(key)}/questions/question`,
      `${root(key)}/pufus/pufu`,
    ];
    await publication('alice-project', false);
    expect(await (await get('')).json()).toMatchObject({ items: [], total: 0 });
    for (const path of paths) expect((await get(path)).status).toBe(404);
    expect(await publish()).toBe(key);
    await app.env.DB.prepare("DELETE FROM projects WHERE id='alice-project'").run();
    for (const path of paths) expect((await get(path)).status).toBe(404);
  });
  it('公開後の追加・変更と所属変更を現在のプロジェクトで判定する', async () => {
    const key = await publish();
    await app.env.DB.prepare("UPDATE questions SET text='更新した問い' WHERE id='question'").run();
    expect(await (await get(`${root(key)}/questions/question`)).json()).toMatchObject({
      question: { text: '更新した問い' },
    });
    await app.env.DB.prepare("DELETE FROM stocks WHERE id='private-stock'").run();
    await app.env.DB.prepare("UPDATE stocks SET project_id='alice-second' WHERE id='stock'").run();
    expect((await get(`${root(key)}/pufus/pufu`)).status).toBe(404);
    expect((await get(`${root(key)}/stocks/stock`)).status).toBe(404);
    expect(await (await get(root(key))).json()).toMatchObject({
      project: { stock_count: 0, question_count: 1 },
    });
    await app.env.DB.prepare(
      "INSERT INTO questions (id,project_id,source,text,status) VALUES ('new','alice-project','user','公開後の新しい問い','ready')",
    ).run();
    expect(await (await get(`${root(key)}/questions`)).json()).toMatchObject({ total: 2 });
  });
  it('ストック・問い・問いに紐づくプ譜を件数制限つきでページ分割する', async () => {
    const key = await publish();
    await app.env.DB.batch(
      Array.from({ length: 13 }, (_, i) => [
        app.env.DB.prepare(
          "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,status) VALUES (?,'alice',?,?,?,'example.com','ready')",
        ).bind(
          `page-article-${i}`,
          `https://example.com/${i}`,
          `https://example.com/${i}`,
          `記事 ${i}`,
        ),
        app.env.DB.prepare(
          "INSERT INTO stocks (id,user_id,project_id,article_id) VALUES (?,'alice','alice-project',?)",
        ).bind(`page-stock-${i}`, `page-article-${i}`),
        app.env.DB.prepare(
          "INSERT INTO questions (id,project_id,stock_id,source,text,status) VALUES (?,'alice-project','stock','user',?,'ready')",
        ).bind(`page-question-${i}`, `問い ${i}`),
        app.env.DB.prepare(
          "INSERT INTO pufu_scores (id,user_id,question_id,task,input_json,score_json,editor_version,status) VALUES (?,'alice','question',?,'{}',?,'0.9.14','ready')",
        ).bind(`page-pufu-${i}`, `課題 ${i}`, JSON.stringify(score(`局面 ${i}`))),
      ]).flat(),
    );
    for (const [path, field, total] of [
      ['stocks', 'items', 14],
      ['questions', 'items', 15],
      ['questions/question', 'pufus', 14],
      ['stocks/stock', 'questions', 14],
    ] as const) {
      const first = (await (await get(`${root(key)}/${path}`)).json()) as Record<string, unknown>;
      const second = (await (await get(`${root(key)}/${path}?page=2`)).json()) as Record<
        string,
        unknown
      >;
      const firstItems = first[field] as { id: string }[];
      const secondItems = second[field] as { id: string }[];
      expect(firstItems).toHaveLength(12);
      expect(first.has_more).toBe(true);
      expect(secondItems).toHaveLength(total - 12);
      expect(second.has_more).toBe(false);
      expect(new Set([...firstItems, ...secondItems].map((item) => item.id)).size).toBe(total);
      expect((await get(`${root(key)}/${path}?page=1.5`)).status).toBe(400);
    }
  });
  it('公開設定の型と文字数を検証し、一覧の件数を制限して安定した順でページを取得する', async () => {
    for (const body of [
      { is_public: 1, public_description: '' },
      { is_public: true, public_description: 'a'.repeat(1001) },
      { is_public: true, public_description: '', description: 'secret' },
    ]) {
      expect(
        (await app.request('/api/v1/projects/alice-project/publication', { method: 'PATCH', body }))
          .status,
      ).toBe(400);
    }
    await app.env.DB.batch(
      Array.from({ length: 14 }, (_, i) =>
        app.env.DB.prepare(
          "INSERT INTO projects (id,user_id,name,is_public,public_id,published_at) VALUES (?,'alice',?,1,?,'2026-10-17')",
        ).bind(`directory-${i}`, `Project ${i}`, `public-${String(i).padStart(2, '0')}`),
      ),
    );
    const first = (await (await get('')).json()) as PublicList<PublicProject>;
    const second = (await (await get('?page=2')).json()) as PublicList<PublicProject>;
    expect(first.items).toHaveLength(12);
    expect(first.has_more).toBe(true);
    expect(second.items).toHaveLength(2);
    expect(second.has_more).toBe(false);
    expect(new Set([...first.items, ...second.items].map((p) => p.public_id)).size).toBe(14);
    expect(first.items[0].public_id).toBe('public-13');
    for (const query of ['0', '-1', '1.5', 'Infinity', '5001'])
      expect((await get(`?page=${query}`)).status).toBe(400);
  });
});
