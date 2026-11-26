import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { ArticleSummary } from '../../../shared/domain';
import { publicListPageLimit, publicListPageSize } from '../../../shared/public-project';
import type {
  Publication,
  PublicProject,
  PublicProjectDetail,
  PublicPufu,
  PublicStock,
  PublicViewRankingItem,
  PublicViewStats,
  PublicViewTotals,
} from '../../../shared/public-project';
import { pufuScoreSchema } from '../../../shared/pufu';
import type { StockImage } from '../../../shared/stock-images';
import type { AppEnv } from '../../env';
import { now } from '../../infrastructure/db';
import { listPublicFootprints } from '../memory/footprint-repository';
import { pufuRelationsColumns, stockRelationsColumn, withRelations } from '../relations/relations';
import { ogImageResponse } from '../stocks/og-image';
import { stockImageResponse } from '../stocks/stock-images';
import { japanDay, publicViewColumn } from './public-views';
import { publicPufuWhere, publicQuestionWhere } from './public-sources';

export { publicPufuWhere, publicQuestionWhere } from './public-sources';

const notFound = () =>
  new HTTPException(404, { message: '公開されているページが見つかりません。' });
const publicPufuCount = `(SELECT COUNT(*) FROM pufu_scores pf WHERE pf.project_id=p.id AND ${publicPufuWhere})`;
const projectColumns = `p.public_id,p.name,p.public_description,p.published_at,
  (SELECT COUNT(*) FROM stocks s WHERE s.project_id=p.id) AS stock_count,
  (SELECT COUNT(*) FROM questions q WHERE q.project_id=p.id AND ${publicQuestionWhere}) AS question_count,
  ${publicPufuCount} AS pufu_count,${publicViewColumn('project')}`;
const stockColumns = `s.id,COALESCE(s.title,a.title) AS title,a.source_url,a.domain,a.has_og_image,p.public_id,s.created_at,${publicViewColumn('stocks', 's.id')},
  CASE WHEN a.status != 'failed' THEN a.summary_json END AS summary_json,
  (SELECT json_group_array(json_object('id',id,'filename',filename,'content_type',content_type,'size',size,'created_at',created_at)) FROM
    (SELECT id,filename,content_type,size,created_at FROM stock_images WHERE stock_id=s.id AND status='ready' ORDER BY created_at,id)
  ) AS images_json`;
const stockJoins =
  'stocks s JOIN projects p ON p.id=s.project_id JOIN articles a ON a.id=s.article_id';
const questionColumns = `q.id,q.text,q.source,q.stock_id,COALESCE(s.title,a.title) AS article_title,q.created_at,${publicViewColumn('questions', 'q.id')},
  (SELECT COUNT(*) FROM pufu_scores pf WHERE EXISTS(SELECT 1 FROM pufu_questions pq WHERE pq.pufu_id=pf.id AND pq.question_id=q.id) AND pf.user_id=p.user_id AND pf.status='ready') AS pufu_count,${stockRelationsColumn('q')}`;
const questionJoins =
  'questions q JOIN projects p ON p.id=q.project_id LEFT JOIN stocks s ON s.id=q.stock_id AND s.project_id=p.id LEFT JOIN articles a ON a.id=s.article_id';
const publicWhere = 'p.public_id=? AND p.is_public=1';
function stock(
  row: Omit<PublicStock, 'summary' | 'images'> & {
    summary_json: string | null;
    has_og_image: number;
    public_id: string;
    images_json: string;
  },
): PublicStock {
  // 本文採用時は要約の代わりに原文を公開する。
  // 明示したフィールドだけを返し、通常保存の取得本文・個人メモ・内部情報は返さない。
  const parsed = row.summary_json ? (JSON.parse(row.summary_json) as ArticleSummary) : null;
  const imageBase = `/api/public/projects/${encodeURIComponent(row.public_id)}/stocks/${encodeURIComponent(row.id)}`;
  const images = JSON.parse(row.images_json) as StockImage[];
  return {
    id: row.id,
    view_count: row.view_count,
    title: row.title,
    source_url: row.source_url,
    domain: row.domain,
    og_image_url: row.has_og_image ? `${imageBase}/og-image` : null,
    images: images.map((image) => ({
      ...image,
      url: `${imageBase}/images/${encodeURIComponent(image.id)}`,
    })),
    created_at: row.created_at,
    summary: parsed
      ? {
          overview: parsed.overview,
          keyPoints: parsed.keyPoints,
          topics: parsed.topics,
          ...(parsed.verbatim ? { verbatim: true } : {}),
        }
      : null,
  };
}
function pageOptions(value: string | undefined) {
  const page = value === undefined ? 1 : Number(value);
  if (!Number.isInteger(page) || page < 1 || page > publicListPageLimit)
    throw new HTTPException(400);
  return { page, limit: publicListPageSize, offset: (page - 1) * publicListPageSize };
}
const viewCountOrder = (sort: string | undefined) => (sort === 'views' ? 'view_count DESC,' : '');

export function publicProjectsApp() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.header('X-Robots-Tag', 'noindex');
    await next();
  });
  app.get('/projects', async (c) => {
    const { page, limit, offset } = pageOptions(c.req.query('page'));
    let cache: Cache | undefined;
    try {
      if (typeof caches !== 'undefined') cache = await caches.open('public-project-directory');
    } catch {
      console.warn('public_directory_cache_open_failed');
    }
    let cacheKey: Request | undefined;
    if (cache) {
      // 通常のD1 bindingの読み取りはprimaryを使う。各拠点で公開停止後の旧世代を使わない。
      const revision = await c.env.DB.prepare(
        'SELECT revision FROM public_directory_revision WHERE id=1',
      ).first<string>('revision');
      if (!revision) throw new Error('Public directory revision is missing');
      cacheKey = new Request(
        new URL(`/__cache/public-projects/v3/${revision}?page=${page}`, c.env.APP_URL),
      );
      try {
        const cached = await cache.match(cacheKey);
        if (cached?.body)
          return c.body(cached.body, 200, { 'Content-Type': 'application/json; charset=UTF-8' });
      } catch {
        console.warn('public_directory_cache_read_failed');
      }
    }
    const [rows, count] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `SELECT ${projectColumns} FROM projects p WHERE p.is_public=1 ORDER BY p.published_at DESC,p.public_id DESC LIMIT ? OFFSET ?`,
      ).bind(limit, offset),
      c.env.DB.prepare('SELECT COUNT(*) AS total FROM projects WHERE is_public=1'),
    ]);
    const total = Number(count.results[0].total);
    const response = c.json({
      items: rows.results as PublicProject[],
      total,
      page,
      has_more: page * limit < total,
    });
    if (cache && cacheKey) {
      // 保存用だけをキャッシュ可能にする。ブラウザ向けno-storeとセキュリティヘッダーは維持する。
      c.executionCtx.waitUntil(
        cache
          .put(
            cacheKey,
            new Response(response.clone().body, {
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'Cache-Control': 'public, max-age=60',
              },
            }),
          )
          .catch(() => console.warn('public_directory_cache_write_failed')),
      );
    }
    return response;
  });
  app.get('/projects/:key', async (c) => {
    const project = await c.env.DB.prepare(
      `SELECT ${projectColumns},p.search_indexable FROM projects p WHERE ${publicWhere}`,
    )
      .bind(c.req.param('key'))
      .first<PublicProjectDetail>();
    if (!project) throw notFound();
    return c.json({ project });
  });
  app.get('/projects/:key/footprints', async (c) => {
    const { page, limit, offset } = pageOptions(c.req.query('page'));
    const items = await listPublicFootprints(c.env, c.req.param('key'), limit + 1, offset);
    if (!items) throw notFound();
    return c.json({ items: items.slice(0, limit), page, has_more: items.length > limit });
  });
  app.get('/projects/:key/stocks', async (c) => {
    const { page, limit, offset } = pageOptions(c.req.query('page'));
    const [project, rows, count] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(`SELECT p.id FROM projects p WHERE ${publicWhere}`).bind(c.req.param('key')),
      c.env.DB.prepare(
        `SELECT ${stockColumns} FROM ${stockJoins} WHERE ${publicWhere} ORDER BY ${viewCountOrder(c.req.query('sort'))} s.created_at DESC,s.id DESC LIMIT ? OFFSET ?`,
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
  app.get('/projects/:key/stocks/:id/og-image', async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT a.content_key FROM ${stockJoins} WHERE ${publicWhere} AND s.id=? AND a.has_og_image=1`,
    )
      .bind(c.req.param('key'), c.req.param('id'))
      .first<{ content_key: string }>();
    if (!row) throw notFound();
    return ogImageResponse(c.env, row.content_key);
  });
  app.get('/projects/:key/stocks/:id/images/:imageId', async (c) => {
    const image = await c.env.DB.prepare(
      `SELECT i.content_key,i.content_type,i.size FROM stock_images i JOIN stocks s ON s.id=i.stock_id JOIN projects p ON p.id=s.project_id WHERE ${publicWhere} AND s.id=? AND i.id=? AND i.status='ready'`,
    )
      .bind(c.req.param('key'), c.req.param('id'), c.req.param('imageId'))
      .first<StockImage & { content_key: string }>();
    if (!image) throw notFound();
    return stockImageResponse(c.env, image);
  });
  app.get('/projects/:key/stocks/:id', async (c) => {
    const { page, limit, offset } = pageOptions(c.req.query('page'));
    const [stocks, questions, count] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `SELECT ${stockColumns} FROM ${stockJoins} WHERE ${publicWhere} AND s.id=?`,
      ).bind(c.req.param('key'), c.req.param('id')),
      c.env.DB.prepare(
        `SELECT ${questionColumns} FROM ${questionJoins} WHERE ${publicWhere} AND EXISTS(SELECT 1 FROM question_stocks qs WHERE qs.question_id=q.id AND qs.stock_id=?) AND ${publicQuestionWhere} ORDER BY q.created_at DESC,q.id DESC LIMIT ? OFFSET ?`,
      ).bind(c.req.param('key'), c.req.param('id'), limit, offset),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS total FROM questions q JOIN projects p ON p.id=q.project_id WHERE ${publicWhere} AND EXISTS(SELECT 1 FROM question_stocks qs WHERE qs.question_id=q.id AND qs.stock_id=?) AND ${publicQuestionWhere}`,
      ).bind(c.req.param('key'), c.req.param('id')),
    ]);
    if (!stocks.results.length) throw notFound();
    const total = Number(count.results[0].total);
    return c.json({
      stock: stock(stocks.results[0] as Parameters<typeof stock>[0]),
      questions: questions.results.map(withRelations),
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
        `SELECT ${questionColumns} FROM ${questionJoins} WHERE ${publicWhere} AND ${publicQuestionWhere} ORDER BY ${viewCountOrder(c.req.query('sort'))} q.created_at DESC,q.id DESC LIMIT ? OFFSET ?`,
      ).bind(c.req.param('key'), limit, offset),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS total FROM questions q JOIN projects p ON p.id=q.project_id WHERE ${publicWhere} AND ${publicQuestionWhere}`,
      ).bind(c.req.param('key')),
    ]);
    if (!project.results.length) throw notFound();
    const total = Number(count.results[0].total);
    return c.json({
      items: rows.results.map(withRelations),
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
        `SELECT ${stockColumns} FROM ${stockJoins} JOIN question_stocks qs ON qs.stock_id=s.id JOIN questions q ON q.id=qs.question_id AND q.project_id=p.id WHERE ${publicWhere} AND q.id=? AND ${publicQuestionWhere}`,
      ).bind(c.req.param('key'), c.req.param('id')),
      c.env.DB.prepare(
        `SELECT pf.id,pf.title,pf.task,pf.current_phase,pf.updated_at,${publicViewColumn('pufus', 'pf.id')} FROM pufu_scores pf JOIN pufu_questions pq ON pq.pufu_id=pf.id JOIN questions q ON q.id=pq.question_id JOIN projects p ON p.id=pf.project_id WHERE ${publicWhere} AND q.id=? AND ${publicQuestionWhere} AND pf.user_id=p.user_id AND pf.status='ready' ORDER BY pf.created_at DESC,pf.id DESC LIMIT ? OFFSET ?`,
      ).bind(c.req.param('key'), c.req.param('id'), limit, offset),
    ]);
    if (!questions.results.length) throw notFound();
    return c.json({
      question: withRelations(questions.results[0]),
      stock: stocks.results[0] ? stock(stocks.results[0] as Parameters<typeof stock>[0]) : null,
      stocks: stocks.results.map((row) => stock(row as Parameters<typeof stock>[0])),
      pufus: pufus.results,
      page,
      has_more: page * limit < Number(questions.results[0].pufu_count),
    });
  });
  app.get('/projects/:key/pufus', async (c) => {
    const { page, limit, offset } = pageOptions(c.req.query('page'));
    const [project, rows, count] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(`SELECT p.id FROM projects p WHERE ${publicWhere}`).bind(c.req.param('key')),
      c.env.DB.prepare(
        `SELECT pf.id,pf.title,pf.task,pf.current_phase,pf.updated_at,${publicViewColumn('pufus', 'pf.id')},
        json_extract(COALESCE(ph.score_json,pf.score_json),'$.gainingGoal.text') AS latest_gaining_goal
        FROM pufu_scores pf JOIN projects p ON p.id=pf.project_id
        LEFT JOIN pufu_phases ph ON ph.pufu_id=pf.id AND ph.number=pf.current_phase
        WHERE ${publicWhere} AND ${publicPufuWhere}
        ORDER BY ${viewCountOrder(c.req.query('sort'))} pf.created_at DESC,pf.id DESC LIMIT ? OFFSET ?`,
      ).bind(c.req.param('key'), limit, offset),
      c.env.DB.prepare(
        `SELECT ${publicPufuCount} AS total FROM projects p WHERE ${publicWhere}`,
      ).bind(c.req.param('key')),
    ]);
    if (!project.results.length) throw notFound();
    const total = Number(count.results[0].total);
    return c.json({ items: rows.results, total, page, has_more: page * limit < total });
  });
  app.get('/projects/:key/pufus/:id', async (c) => {
    const requestedPhase = c.req.query('phase');
    if (
      requestedPhase !== undefined &&
      (!/^[1-9]\d*$/.test(requestedPhase) || !Number.isSafeInteger(Number(requestedPhase)))
    )
      throw new HTTPException(400);
    // 公開の読み取りでは局面の初期化・ジョブ起動・コンテキスト取得を一切行わない。
    const row = await c.env.DB.prepare(
      `SELECT pf.id,pf.title,pf.task,pf.current_phase,pf.updated_at,${publicViewColumn('pufus', 'pf.id')},q.id AS question_id,q.text AS question_text,${pufuRelationsColumns('pf')},
      COALESCE(ph.score_json,pf.score_json) AS score_json FROM pufu_scores pf
      JOIN projects p ON p.id=pf.project_id JOIN questions q ON q.id=(SELECT pq.question_id FROM pufu_questions pq JOIN questions visible ON visible.id=pq.question_id WHERE pq.pufu_id=pf.id AND (visible.status='ready' OR (visible.source='ai' AND visible.text IS NOT NULL)) ORDER BY pq.question_id LIMIT 1)
      LEFT JOIN pufu_phases ph ON ph.pufu_id=pf.id AND ph.number=pf.current_phase
      WHERE ${publicWhere} AND pf.id=? AND ${publicPufuWhere} AND ${publicQuestionWhere}`,
    )
      .bind(c.req.param('key'), c.req.param('id'))
      .first<
        Omit<PublicPufu, 'score' | 'phase'> & {
          score_json: string | null;
          questions_json: string;
          stocks_json: string;
        }
      >();
    if (!row?.score_json) throw notFound();
    const phase = requestedPhase === undefined ? row.current_phase : Number(requestedPhase);
    if (phase > row.current_phase) throw notFound();
    // 公開可否を確認したプ譜の、指定された局面だけを読む。
    const scoreJson =
      phase === row.current_phase
        ? row.score_json
        : await c.env.DB.prepare('SELECT score_json FROM pufu_phases WHERE pufu_id=? AND number=?')
            .bind(row.id, phase)
            .first<string>('score_json');
    if (!scoreJson) throw notFound();
    const score = pufuScoreSchema.parse(JSON.parse(scoreJson));
    return c.json({
      pufu: {
        ...withRelations({ questions_json: row.questions_json, stocks_json: row.stocks_json }),
        id: row.id,
        view_count: row.view_count,
        title: row.title,
        task: row.task,
        current_phase: row.current_phase,
        phase,
        updated_at: row.updated_at,
        question_id: row.question_id,
        question_text: row.question_text,
        score,
      },
    });
  });
  return app;
}

type ViewRankingRange = { period: 'week' | 'month'; start: string; end: string };

function viewRankingRange(
  period: string | undefined,
  month: string | undefined,
): ViewRankingRange | undefined {
  if ((period === undefined || period === 'all') && month === undefined) return;
  const today = japanDay(Date.now());
  if (period === 'week' && month === undefined) {
    const monday = new Date(`${today}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return { period, start: monday.toISOString().slice(0, 10), end: today };
  }
  if (period === 'month') {
    const current = today.slice(0, 7);
    const selected = month ?? current;
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(selected) && selected.length === 7 && selected <= current) {
      const start = `${selected}-01`;
      const nextMonth = new Date(`${start}T00:00:00Z`);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      return {
        period,
        start,
        end: selected === current ? today : nextMonth.toISOString().slice(0, 10),
      };
    }
  }
  throw new HTTPException(400, { message: '閲覧数の集計期間を確認してください。' });
}

async function readViewStats(
  db: D1Database,
  projectId: string,
  publishedAt: string | null,
  range?: ViewRankingRange,
): Promise<PublicViewStats> {
  const views = range
    ? `SELECT kind,item_id,SUM(views) AS views FROM public_view_daily
       WHERE project_id=?1 AND day>=?2 AND day<?3 GROUP BY kind,item_id`
    : 'SELECT kind,item_id,views FROM public_view_totals WHERE project_id=?1';
  const [counts, ranking, history] = await db.batch([
    db
      .prepare(
        'SELECT kind,SUM(views) AS views FROM public_view_totals WHERE project_id=? GROUP BY kind',
      )
      .bind(projectId),
    db
      .prepare(
        `WITH views AS (${views})
       SELECT v.kind,s.id,COALESCE(NULLIF(trim(COALESCE(s.title,a.title)),''),NULLIF(a.domain,'')) AS title,v.views
       FROM views v JOIN stocks s ON s.id=v.item_id JOIN articles a ON a.id=s.article_id
       WHERE v.kind='stocks' AND s.project_id=?1
       UNION ALL
       SELECT v.kind,q.id,q.text AS title,v.views FROM views v JOIN questions q ON q.id=v.item_id
       WHERE v.kind='questions' AND q.project_id=?1 AND ${publicQuestionWhere}
       UNION ALL
       SELECT v.kind,pf.id,COALESCE(NULLIF(pf.title,''),pf.task) AS title,v.views
       FROM views v JOIN pufu_scores pf ON pf.id=v.item_id JOIN projects p ON p.id=pf.project_id
       WHERE v.kind='pufus' AND pf.project_id=?1 AND ${publicPufuWhere}
       ORDER BY views DESC,kind,id LIMIT 5`,
      )
      .bind(projectId, ...(range ? [range.start, range.end] : [])),
    ...(range?.period === 'week'
      ? [
          db
            .prepare('SELECT MIN(day) AS day FROM public_view_daily WHERE project_id=?')
            .bind(projectId),
        ]
      : []),
  ]);
  const totals: PublicViewTotals = { project: 0, stocks: 0, questions: 0, pufus: 0 };
  for (const { kind, views } of counts.results as { kind: keyof PublicViewTotals; views: number }[])
    totals[kind] = views;
  const stats: PublicViewStats = { totals, top: ranking.results as PublicViewRankingItem[] };
  if (range?.period === 'week') {
    const current = range.end.slice(0, 7);
    const firstDay = (history.results[0] as { day: string | null }).day;
    const publishedMonth = publishedAt ? japanDay(Date.parse(publishedAt)).slice(0, 7) : current;
    const first = [current, publishedMonth, firstDay?.slice(0, 7) ?? current].sort()[0];
    stats.months = { first, current };
  }
  return stats;
}

const publicationSchema = z.strictObject({
  is_public: z.boolean(),
  search_indexable: z.boolean().optional(),
  public_description: z.string().trim().max(1000),
});
export function publicationApp() {
  const app = new Hono<AppEnv>();
  async function read(c: import('hono').Context<AppEnv>, id: string) {
    const row = await c.env.DB.prepare(
      'SELECT is_public,search_indexable,public_id,public_description,published_at FROM projects WHERE id=? AND user_id=?',
    )
      .bind(id, c.get('principal').user.id)
      .first<
        Omit<Publication, 'is_public' | 'search_indexable' | 'view_stats'> & {
          is_public: number;
          search_indexable: number;
        }
      >();
    if (!row) throw new HTTPException(404, { message: 'プロジェクトが見つかりません。' });
    return {
      ...row,
      is_public: Boolean(row.is_public),
      search_indexable: Boolean(row.search_indexable),
    };
  }
  async function respond(
    c: import('hono').Context<AppEnv>,
    id: string,
    period?: string,
    month?: string,
    includeViewStats = true,
  ) {
    const publication = await read(c, id);
    const range = viewRankingRange(period, month);
    const view_stats =
      publication.is_public && includeViewStats
        ? await readViewStats(c.env.DB, id, publication.published_at, range)
        : null;
    return c.json({ publication: { ...publication, view_stats } });
  }
  app.get('/:id/publication', (c) =>
    respond(
      c,
      c.req.param('id'),
      c.req.query('view_period'),
      c.req.query('view_month'),
      c.req.query('include_view_stats') !== 'false',
    ),
  );
  app.patch('/:id/publication', async (c) => {
    const id = c.req.param('id');
    await read(c, id);
    const data = publicationSchema.safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      throw new HTTPException(400, { message: '公開設定の入力内容を確認してください。' });
    await c.env.DB.prepare(
      `UPDATE projects SET public_id=COALESCE(public_id,?),public_description=?,search_indexable=CASE WHEN ?=0 THEN 0 ELSE COALESCE(?,search_indexable) END,
      published_at=CASE WHEN ?=1 AND is_public=0 THEN ? ELSE published_at END,is_public=? WHERE id=? AND user_id=?`,
    )
      .bind(
        crypto.randomUUID(),
        data.data.public_description,
        Number(data.data.is_public),
        data.data.search_indexable === undefined ? null : Number(data.data.search_indexable),
        Number(data.data.is_public),
        now(),
        Number(data.data.is_public),
        id,
        c.get('principal').user.id,
      )
      .run();
    return respond(c, id);
  });
  return app;
}
