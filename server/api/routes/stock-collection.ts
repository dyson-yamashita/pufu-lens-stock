import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  stockInputSchema,
  stockListOptionsSchema,
  stockSearchOptionsSchema,
} from '../../../shared/domain';
import { isYouTubeUrl, youtubeUnavailableMessage } from '../../../shared/youtube';
import type { AppEnv } from '../../env';
import {
  allowedProjectIds,
  canAccessProject,
  resolveProjectId,
} from '../../features/projects/project-access';
import { listStocks } from '../../features/stocks/stock-search';
import { SearchError } from '../../infrastructure/ai/search-ai';
import { dirtyMemoryStatements, now, queueQuestionStatements } from '../../infrastructure/db';
import { observeOperation } from '../../infrastructure/diagnostics';
import { dispatchJobs } from '../../infrastructure/jobs/jobs';
import { canonicalUrl, hash, validateUrl } from '../../infrastructure/security';
import { ownedProject } from '../context';
import { body } from '../validation';

export function registerStockCollectionRoutes(app: Hono<AppEnv>) {
  app.get('/api/v1/stocks', async (c) => {
    const principal = c.get('principal');
    const { user } = principal;
    const options = stockListOptionsSchema.extend(stockSearchOptionsSchema.shape).safeParse({
      limit: c.req.query('limit') === undefined ? undefined : Number(c.req.query('limit')),
      sort_by: c.req.query('sort_by'),
      order: c.req.query('order'),
      detail: c.req.query('detail'),
      mode: c.req.query('mode'),
      min_score:
        c.req.query('min_score') === undefined ? undefined : Number(c.req.query('min_score')),
    });
    if (!options.success)
      throw new HTTPException(400, {
        message: '取得件数・並び順・表示形式・検索方式を確認してください。',
      });
    const requested = c.req.query('project_id') || null;
    const projectId = resolveProjectId(principal, requested);
    if (projectId) await ownedProject(c.env, user.id, projectId);
    const status = c.req.query('status') ?? 'all';
    const source = c.req.query('source') ?? 'all';
    const favorite = c.req.query('favorite') ?? 'false';
    if (
      !['all', 'ready', 'processing', 'failed'].includes(status) ||
      !['all', 'web', 'user'].includes(source) ||
      !['true', 'false'].includes(favorite)
    )
      throw new HTTPException(400);
    try {
      return c.json(
        await listStocks(c.env, {
          ...options.data,
          userId: user.id,
          projectIds: allowedProjectIds(principal),
          projectId,
          q: (c.req.query('q') ?? '').slice(0, 200),
          status,
          source,
          favorite,
          page: Math.max(1, Math.min(5000, Math.floor(Number(c.req.query('page')) || 1))),
        }),
      );
    } catch (error) {
      if (error instanceof SearchError)
        return c.json({ error: error.message, search_error: error.reason }, error.status);
      throw error;
    }
  });

  app.post('/api/v1/stocks', async (c) => {
    const principal = c.get('principal');
    const { user } = principal;
    const data = await body(c, stockInputSchema);
    if (data.project_id && !canAccessProject(principal, data.project_id))
      throw new HTTPException(403, { message: 'このトークンの保存先プロジェクトとは異なります。' });
    const projectId = resolveProjectId(principal, data.project_id ?? null);
    if (!projectId && allowedProjectIds(principal) !== null)
      throw new HTTPException(400, { message: '保存先プロジェクトを指定してください。' });
    if (projectId) await ownedProject(c.env, user.id, projectId);
    const source = data.type === 'url' ? validateUrl(data.url) : null;
    const youtube = source !== null && isYouTubeUrl(source.href);
    const title =
      data.type === 'text'
        ? data.title || data.text.trim().split('\n', 1)[0].trim().slice(0, 80)
        : youtube
          ? 'YouTube'
          : source!.hostname;
    const sourceCanonical =
      data.type === 'text'
        ? `text:${await hash(JSON.stringify([title, data.text]))}`
        : canonicalUrl(data.url);
    // 要約ありの記事と本文採用の記事は別に保持し、既存の保存内容を変更しない。
    const canonical = data.skip_summary ? `verbatim:${sourceCanonical}` : sourceCanonical;
    const requestHash = await hash(
      JSON.stringify([
        projectId,
        canonical,
        data.note,
        ...(data.type === 'url' && data.supplemental_text ? [data.supplemental_text] : []),
      ]),
    );
    const key = c.req.header('Idempotency-Key');
    if (key && !/^[A-Za-z0-9_-]{1,128}$/.test(key))
      throw new HTTPException(400, {
        message:
          'Idempotency-Keyは128文字以内の英数字・ハイフン・アンダースコアで指定してください。',
      });
    // 旧記事の本文・要約を削除せず、同URLの再保存も記録不可に切り替える。
    const unavailableArticle = () =>
      c.env.DB.prepare(
        "UPDATE articles SET title = ?, status = 'failed', error = ?, updated_at = ? WHERE user_id = ? AND canonical_url = ?",
      ).bind(title, youtubeUnavailableMessage, now(), user.id, canonical);
    const replay = async () => {
      if (!key) return null;
      const previous = await c.env.DB.prepare(
        'SELECT request_hash, stock_id FROM idempotency_keys WHERE user_id = ? AND key = ?',
      )
        .bind(user.id, key)
        .first<{ request_hash: string; stock_id: string | null }>();
      if (!previous) return null;
      if (previous.request_hash !== requestHash)
        throw new HTTPException(409, {
          message: '同じIdempotency-Keyで異なる内容が送信されました。',
        });
      if (!previous.stock_id)
        throw new HTTPException(409, {
          message: 'この保存は削除済みです。新しいIdempotency-Keyで送信してください。',
        });
      if (youtube) await unavailableArticle().run();
      return c.json({ id: previous.stock_id, duplicate: true }, 200);
    };
    const existingResponse = await replay();
    if (existingResponse) return existingResponse;
    const projects = projectId
      ? [{ id: projectId }]
      : (
          await c.env.DB.prepare(
            'SELECT id FROM projects WHERE user_id = ? ORDER BY created_at, id',
          )
            .bind(user.id)
            .all<{ id: string }>()
        ).results;
    if (!projects.length)
      throw new HTTPException(400, { message: '保存先のプロジェクトを作成してください。' });
    const articleId = crypto.randomUUID();
    const statements = [
      c.env.DB.prepare(
        'INSERT OR IGNORE INTO articles (id, user_id, canonical_url, source_url, title, domain, source_type, input_text, status, error, skip_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        articleId,
        user.id,
        canonical,
        source?.href ?? '',
        title,
        source?.hostname ?? '',
        data.type,
        data.type === 'text' ? data.text : youtube ? null : (data.supplemental_text ?? null),
        youtube ? 'failed' : 'queued',
        youtube ? youtubeUnavailableMessage : null,
        data.skip_summary ? 1 : 0,
      ),
      ...(youtube ? [unavailableArticle()] : []),
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO processing_jobs (id, user_id, kind, target_id, revision) SELECT 'a-' || id || '-' || generation, user_id, 'article', id, generation FROM articles WHERE user_id = ? AND canonical_url = ? AND status = 'queued'",
      ).bind(user.id, canonical),
    ];
    const stockInsertIndexes: number[] = [];
    for (const project of projects) {
      const stockId = crypto.randomUUID();
      stockInsertIndexes.push(statements.length);
      statements.push(
        c.env.DB.prepare(
          'INSERT OR IGNORE INTO stocks (id, user_id, project_id, article_id, note) SELECT ?, ?, ?, id, ? FROM articles WHERE user_id = ? AND canonical_url = ?',
        ).bind(stockId, user.id, project.id, data.note, user.id, canonical),
        ...(!youtube || data.note.trim()
          ? dirtyMemoryStatements(c.env, user.id, [project.id], stockId)
          : []),
        ...(!youtube ? queueQuestionStatements(c.env, stockId) : []),
      );
    }
    if (key)
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO idempotency_keys (user_id, key, request_hash, stock_id) SELECT ?, ?, ?, s.id FROM stocks s JOIN articles a ON a.id = s.article_id WHERE s.user_id = ? AND s.project_id = ? AND a.canonical_url = ?',
        ).bind(user.id, key, requestHash, user.id, projects[0].id, canonical),
      );
    let result: D1Result[];
    try {
      result = await c.env.DB.batch(statements);
    } catch (error) {
      const response = await replay();
      if (response) return response;
      throw error;
    }
    const stock = await c.env.DB.prepare(
      'SELECT s.id, a.status FROM stocks s JOIN articles a ON a.id = s.article_id WHERE s.user_id = ? AND s.project_id = ? AND a.canonical_url = ?',
    )
      .bind(user.id, projects[0].id, canonical)
      .first<{ id: string; status: string }>();
    const created = stockInsertIndexes.some((index) => result[index].meta.changes > 0);
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json(
      { id: stock!.id, status: stock!.status, duplicate: !created },
      created ? 202 : 200,
    );
  });

  app.get('/api/v1/articles/:id', async (c) => {
    const row = await c.env.DB.prepare(
      'SELECT s.id, s.is_favorite, s.article_id, s.project_id, p.name AS project_name, s.note, s.created_at, COALESCE(s.title, a.title) AS title, a.source_type, a.source_url, a.domain, a.has_og_image, a.status, a.summary_json, a.error, a.model FROM articles a JOIN stocks s ON s.article_id = a.id JOIN projects p ON p.id = s.project_id WHERE a.id = ? AND a.user_id = ? ORDER BY s.created_at LIMIT 1',
    )
      .bind(c.req.param('id'), c.get('principal').user.id)
      .first<Record<string, unknown>>();
    if (!row)
      throw new HTTPException(404, { message: '根拠の記事は削除済み、または見つかりません。' });
    const { summary_json, ...stock } = row;
    return c.json({
      stock: {
        ...stock,
        summary:
          stock.status !== 'failed' && summary_json ? JSON.parse(String(summary_json)) : null,
      },
    });
  });
}
