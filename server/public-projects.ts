import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from './env';
import type {
  Publication,
  PublicProject,
  PublicStock,
  PublicQuestion,
  PublicPufu,
} from '../shared/public-project';
import type { ArticleSummary } from '../shared/domain';
import { pufuScoreSchema } from '../shared/pufu';
import { now } from './db';

const notFound = () =>
  new HTTPException(404, { message: '公開されているページが見つかりません。' });
// 再生成ではtextを保持する。未完成のAI問いはNULLなので公開しない。
const publicQuestionWhere = "(q.status='ready' OR (q.source='ai' AND q.text IS NOT NULL))";
const projectColumns = `p.public_id,p.name,p.public_description,p.published_at,
  (SELECT COUNT(*) FROM stocks s WHERE s.project_id=p.id) AS stock_count,
  (SELECT COUNT(*) FROM questions q WHERE q.project_id=p.id AND ${publicQuestionWhere}) AS question_count`;
const stockColumns =
  "s.id,COALESCE(s.title,a.title) AS title,a.source_url,a.domain,s.created_at,CASE WHEN a.status != 'failed' THEN a.summary_json END AS summary_json";
const stockJoins =
  'stocks s JOIN projects p ON p.id=s.project_id JOIN articles a ON a.id=s.article_id';
const questionColumns = `q.id,q.text,q.source,q.stock_id,COALESCE(s.title,a.title) AS article_title,q.created_at,
  (SELECT COUNT(*) FROM pufu_scores pf WHERE pf.question_id=q.id AND pf.user_id=p.user_id AND pf.status='ready') AS pufu_count`;
const questionJoins =
  'questions q JOIN projects p ON p.id=q.project_id LEFT JOIN stocks s ON s.id=q.stock_id AND s.project_id=p.id LEFT JOIN articles a ON a.id=s.article_id';
const publicWhere = 'p.public_id=? AND p.is_public=1';
function stock(row: Omit<PublicStock, 'summary'> & { summary_json: string | null }): PublicStock {
  // 明示したフィールドだけを返し、保存本文・個人メモ・生成時の内部情報は返さない。
  const parsed = row.summary_json ? (JSON.parse(row.summary_json) as ArticleSummary) : null;
  return {
    id: row.id,
    title: row.title,
    source_url: row.source_url,
    domain: row.domain,
    created_at: row.created_at,
    summary: parsed
      ? {
          overview: parsed.overview,
          keyPoints: parsed.keyPoints,
          topics: parsed.topics,
        }
      : null,
  };
}
function pageOptions(value: string | undefined) {
  const page = value === undefined ? 1 : Number(value);
  if (!Number.isInteger(page) || page < 1 || page > 5000) throw new HTTPException(400);
  return { page, limit: 12, offset: (page - 1) * 12 };
}
export function publicProjectsApp() {
  const app = new Hono<AppEnv>();
  app.get('/projects', async (c) => {
    const { page, limit, offset } = pageOptions(c.req.query('page'));
    const [rows, count] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `SELECT ${projectColumns} FROM projects p WHERE p.is_public=1 ORDER BY p.published_at DESC,p.public_id DESC LIMIT ? OFFSET ?`,
      ).bind(limit, offset),
      c.env.DB.prepare('SELECT COUNT(*) AS total FROM projects WHERE is_public=1'),
    ]);
    const total = Number(count.results[0].total);
    return c.json({
      items: rows.results as PublicProject[],
      total,
      page,
      has_more: page * limit < total,
    });
  });
  app.get('/projects/:key', async (c) => {
    const project = await c.env.DB.prepare(
      `SELECT ${projectColumns} FROM projects p WHERE ${publicWhere}`,
    )
      .bind(c.req.param('key'))
      .first<PublicProject>();
    if (!project) throw notFound();
    return c.json({ project });
  });
  app.get('/projects/:key/stocks', async (c) => {
    const { page, limit, offset } = pageOptions(c.req.query('page'));
    const [project, rows, count] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(`SELECT p.id FROM projects p WHERE ${publicWhere}`).bind(c.req.param('key')),
      c.env.DB.prepare(
        `SELECT ${stockColumns} FROM ${stockJoins} WHERE ${publicWhere} ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?`,
      ).bind(c.req.param('key'), limit, offset),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS total FROM stocks s JOIN projects p ON p.id=s.project_id WHERE ${publicWhere}`,
      ).bind(c.req.param('key')),
    ]);
    if (!project.results.length) throw notFound();
    const total = Number(count.results[0].total);
    return c.json({
      items: rows.results.map((row) => stock(row as Parameters<typeof stock>[0])),
      total,
      page,
      has_more: page * limit < total,
    });
  });
  app.get('/projects/:key/stocks/:id', async (c) => {
    const { page, limit, offset } = pageOptions(c.req.query('page'));
    const [stocks, questions, count] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `SELECT ${stockColumns} FROM ${stockJoins} WHERE ${publicWhere} AND s.id=?`,
      ).bind(c.req.param('key'), c.req.param('id')),
      c.env.DB.prepare(
        `SELECT ${questionColumns} FROM ${questionJoins} WHERE ${publicWhere} AND s.id=? AND ${publicQuestionWhere} ORDER BY q.created_at DESC,q.id DESC LIMIT ? OFFSET ?`,
      ).bind(c.req.param('key'), c.req.param('id'), limit, offset),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS total FROM questions q JOIN projects p ON p.id=q.project_id JOIN stocks s ON s.id=q.stock_id AND s.project_id=p.id WHERE ${publicWhere} AND s.id=? AND ${publicQuestionWhere}`,
      ).bind(c.req.param('key'), c.req.param('id')),
    ]);
    if (!stocks.results.length) throw notFound();
    const total = Number(count.results[0].total);
    return c.json({
      stock: stock(stocks.results[0] as Parameters<typeof stock>[0]),
      questions: questions.results as PublicQuestion[],
      total,
      page,
      has_more: page * limit < total,
    });
  });
  app.get('/projects/:key/questions', async (c) => {
    const { page, limit, offset } = pageOptions(c.req.query('page'));
    const [project, rows, count] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(`SELECT p.id FROM projects p WHERE ${publicWhere}`).bind(c.req.param('key')),
      c.env.DB.prepare(
        `SELECT ${questionColumns} FROM ${questionJoins} WHERE ${publicWhere} AND ${publicQuestionWhere} ORDER BY q.created_at DESC,q.id DESC LIMIT ? OFFSET ?`,
      ).bind(c.req.param('key'), limit, offset),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS total FROM questions q JOIN projects p ON p.id=q.project_id WHERE ${publicWhere} AND ${publicQuestionWhere}`,
      ).bind(c.req.param('key')),
    ]);
    if (!project.results.length) throw notFound();
    const total = Number(count.results[0].total);
    return c.json({
      items: rows.results as PublicQuestion[],
      total,
      page,
      has_more: page * limit < total,
    });
  });
  app.get('/projects/:key/questions/:id', async (c) => {
    const { page, limit, offset } = pageOptions(c.req.query('page'));
    const [questions, stocks, pufus] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `SELECT ${questionColumns} FROM ${questionJoins} WHERE ${publicWhere} AND q.id=? AND ${publicQuestionWhere}`,
      ).bind(c.req.param('key'), c.req.param('id')),
      c.env.DB.prepare(
        `SELECT ${stockColumns} FROM ${stockJoins} JOIN questions q ON q.stock_id=s.id AND q.project_id=p.id WHERE ${publicWhere} AND q.id=? AND ${publicQuestionWhere}`,
      ).bind(c.req.param('key'), c.req.param('id')),
      c.env.DB.prepare(
        `SELECT pf.id,pf.task,pf.current_phase,pf.updated_at FROM pufu_scores pf JOIN questions q ON q.id=pf.question_id JOIN projects p ON p.id=q.project_id WHERE ${publicWhere} AND q.id=? AND ${publicQuestionWhere} AND pf.user_id=p.user_id AND pf.status='ready' ORDER BY pf.created_at DESC,pf.id DESC LIMIT ? OFFSET ?`,
      ).bind(c.req.param('key'), c.req.param('id'), limit, offset),
    ]);
    if (!questions.results.length) throw notFound();
    return c.json({
      question: questions.results[0],
      stock: stocks.results[0] ? stock(stocks.results[0] as Parameters<typeof stock>[0]) : null,
      pufus: pufus.results,
      page,
      has_more: page * limit < Number(questions.results[0].pufu_count),
    });
  });
  app.get('/projects/:key/pufus/:id', async (c) => {
    // 公開の読み取りでは局面の初期化・ジョブ起動・コンテキスト取得を一切行わない。
    const row = await c.env.DB.prepare(
      `SELECT pf.id,pf.task,pf.current_phase,pf.updated_at,q.id AS question_id,q.text AS question_text,
      COALESCE(ph.score_json,pf.score_json) AS score_json FROM pufu_scores pf
      JOIN questions q ON q.id=pf.question_id JOIN projects p ON p.id=q.project_id
      LEFT JOIN pufu_phases ph ON ph.pufu_id=pf.id AND ph.number=pf.current_phase
      WHERE ${publicWhere} AND pf.id=? AND pf.user_id=p.user_id AND pf.status='ready' AND ${publicQuestionWhere}`,
    )
      .bind(c.req.param('key'), c.req.param('id'))
      .first<Omit<PublicPufu, 'score'> & { score_json: string | null }>();
    if (!row?.score_json) throw notFound();
    const score = pufuScoreSchema.parse(JSON.parse(row.score_json));
    return c.json({
      pufu: {
        id: row.id,
        task: row.task,
        current_phase: row.current_phase,
        updated_at: row.updated_at,
        question_id: row.question_id,
        question_text: row.question_text,
        score,
      },
    });
  });
  return app;
}

const publicationSchema = z.strictObject({
  is_public: z.boolean(),
  public_description: z.string().trim().max(1000),
});
export function publicationApp() {
  const app = new Hono<AppEnv>();
  async function read(c: import('hono').Context<AppEnv>, id: string) {
    const row = await c.env.DB.prepare(
      'SELECT is_public,public_id,public_description,published_at FROM projects WHERE id=? AND user_id=?',
    )
      .bind(id, c.get('principal').user.id)
      .first<Omit<Publication, 'is_public'> & { is_public: number }>();
    if (!row) throw new HTTPException(404, { message: 'プロジェクトが見つかりません。' });
    return { ...row, is_public: Boolean(row.is_public) };
  }
  app.get('/:id/publication', async (c) =>
    c.json({ publication: await read(c, c.req.param('id')) }),
  );
  app.patch('/:id/publication', async (c) => {
    const id = c.req.param('id');
    await read(c, id);
    const data = publicationSchema.safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      throw new HTTPException(400, { message: '公開設定の入力内容を確認してください。' });
    await c.env.DB.prepare(
      `UPDATE projects SET public_id=COALESCE(public_id,?),public_description=?,
      published_at=CASE WHEN ?=1 AND is_public=0 THEN ? ELSE published_at END,is_public=? WHERE id=? AND user_id=?`,
    )
      .bind(
        crypto.randomUUID(),
        data.data.public_description,
        Number(data.data.is_public),
        now(),
        Number(data.data.is_public),
        id,
        c.get('principal').user.id,
      )
      .run();
    return c.json({ publication: await read(c, id) });
  });
  return app;
}
