import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { type Question, type Stock } from '../../../shared/domain';
import { isYouTubeUrl, youtubeUnavailableMessage } from '../../../shared/youtube';
import type { AppEnv } from '../../env';
import { canAccessProject } from '../../features/projects/project-access';
import { withRelations } from '../../features/relations/relations';
import { cleanupStockImages } from '../../features/stocks/stock-images';
import { assertOperation, reserveOperation } from '../../features/usage/usage';
import {
  dirtyMemoryStatements,
  now,
  orphanCleanupStatements,
  queueQuestionJobStatement,
  queueQuestionStatements,
} from '../../infrastructure/db';
import { observeOperation } from '../../infrastructure/diagnostics';
import { dispatchJobs } from '../../infrastructure/jobs/jobs';
import { ownedProject, ownedStock } from '../context';
import { questionColumns, questionJoins } from '../queries';
import { body } from '../validation';

export function registerStockDetailsRoutes(app: Hono<AppEnv>) {
  app.get('/api/v1/stocks/:id', async (c) => {
    const row = await c.env.DB.prepare(
      'SELECT s.id, s.is_favorite, s.article_id, s.project_id, p.name AS project_name, s.note, s.created_at, COALESCE(s.title, a.title) AS title, a.source_type, a.source_url, a.domain, a.status, a.summary_json, a.error, a.model FROM stocks s JOIN articles a ON a.id = s.article_id JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND s.user_id = ?',
    )
      .bind(c.req.param('id'), c.get('principal').user.id)
      .first<Record<string, unknown>>();
    if (!row || !canAccessProject(c.get('principal'), String(row.project_id)))
      throw new HTTPException(404, { message: '記事が見つかりません。' });
    const { summary_json, ...stock } = row;
    return c.json({
      stock: {
        ...stock,
        summary:
          stock.status !== 'failed' && summary_json ? JSON.parse(String(summary_json)) : null,
      },
    });
  });

  app.patch('/api/v1/stocks/:id/favorite', async (c) => {
    const data = await body(c, z.strictObject({ is_favorite: z.boolean() }));
    const stock = await c.env.DB.prepare(
      'UPDATE stocks SET is_favorite = ? WHERE id = ? AND user_id = ? RETURNING id, is_favorite',
    )
      .bind(Number(data.is_favorite), c.req.param('id'), c.get('principal').user.id)
      .first<Pick<Stock, 'id' | 'is_favorite'>>();
    if (!stock) throw new HTTPException(404, { message: '記事が見つかりません。' });
    return c.json(stock);
  });

  app.patch('/api/v1/stocks/:id/title', async (c) => {
    const data = await body(c, z.strictObject({ title: z.string().trim().min(1).max(200) }));
    const stock = await c.env.DB.prepare(
      'UPDATE stocks SET title = ? WHERE id = ? AND user_id = ? RETURNING id, title',
    )
      .bind(data.title, c.req.param('id'), c.get('principal').user.id)
      .first<Pick<Stock, 'id' | 'title'>>();
    if (!stock) throw new HTTPException(404, { message: '記事が見つかりません。' });
    return c.json(stock);
  });

  app.get('/api/v1/stocks/:id/question', async (c) => {
    await ownedStock(c);
    const rows = await c.env.DB.prepare(
      `SELECT ${questionColumns} FROM ${questionJoins} WHERE EXISTS (SELECT 1 FROM question_stocks qs WHERE qs.question_id=q.id AND qs.stock_id=?) AND p.user_id = ? ORDER BY q.created_at DESC, q.id DESC`,
    )
      .bind(c.req.param('id'), c.get('principal').user.id)
      .all<Question>();
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({
      question: rows.results[0]
        ? withRelations(
            rows.results.find((question) => question.source === 'ai') ?? rows.results[0],
          )
        : null,
      questions: rows.results.map(withRelations),
    });
  });

  app.post('/api/v1/stocks/:id/question/retry', async (c) => {
    const stock = await ownedStock(c);
    const question = await c.env.DB.prepare(
      "SELECT status, source, generation FROM questions WHERE stock_id = ? AND source = 'ai'",
    )
      .bind(stock.id)
      .first<{ status: string; source: string; generation: number }>();
    if (!question || question.source !== 'ai' || question.status !== 'failed')
      throw new HTTPException(409, { message: '生成に失敗した問い・気づきだけ再試行できます。' });
    if (stock.status !== 'ready')
      throw new HTTPException(409, { message: '先に記事の取得・要約を完了してください。' });
    const jobId = `q-${stock.id}-${question.generation + 1}`;
    await c.env.DB.batch([
      reserveOperation(c.env, { id: jobId, user_id: c.get('principal').user.id, kind: 'question' }),
      assertOperation(c.env, jobId),
      c.env.DB.prepare(
        "UPDATE questions SET status = 'queued', error = NULL, generation = generation + 1, updated_at = ? WHERE stock_id = ? AND source = 'ai' AND status = 'failed' AND generation = ?",
      ).bind(now(), stock.id, question.generation),
      ...queueQuestionStatements(c.env, stock.id),
    ]);
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ ok: true }, 202);
  });

  app.get('/api/v1/stocks/:id/content', async (c) => {
    const stock = await ownedStock(c);
    if (stock.source_type === 'url' && isYouTubeUrl(stock.source_url))
      return c.json({ content: null });
    const object = stock.content_key ? await c.env.CONTENT.get(stock.content_key) : null;
    return c.json({ content: object ? await object.text() : stock.input_text });
  });

  app.patch('/api/v1/stocks/:id', async (c) => {
    const { user } = c.get('principal');
    const stock = await ownedStock(c);
    const data = await body(
      c,
      z.object({ note: z.string().max(2000), project_id: z.string().min(1).max(100) }),
    );
    await ownedProject(c.env, user.id, data.project_id);
    const duplicate = await c.env.DB.prepare(
      'SELECT id FROM stocks WHERE project_id = ? AND article_id = ? AND id != ?',
    )
      .bind(data.project_id, stock.article_id, stock.id)
      .first();
    if (duplicate)
      throw new HTTPException(409, { message: '移動先には同じ記事が保存されています。' });
    await c.env.DB.batch([
      // 同じbatch内で変更前のメモと照合し、重複保存と古い生成結果の上書きを防ぐ。
      c.env.DB.prepare(
        `UPDATE questions SET status = 'queued', error = NULL, generation = generation + 1, updated_at = ?
        WHERE stock_id = ? AND source = 'ai'
        AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND auto_generate_questions = 1)
        AND EXISTS (
          SELECT 1 FROM stocks s JOIN articles a ON a.id = s.article_id
          WHERE s.id = questions.stock_id AND s.user_id = ? AND s.note != ?
          AND a.status = 'ready' AND json_extract(a.summary_json, '$.shortSource') = 1
        )`,
      ).bind(now(), stock.id, data.project_id, user.id, data.note),
      c.env.DB.prepare(
        'UPDATE stocks SET note = ?, project_id = ? WHERE id = ? AND user_id = ?',
      ).bind(data.note, data.project_id, stock.id, user.id),
      queueQuestionJobStatement(c.env, stock.id),
      ...(!(stock.source_type === 'url' && isYouTubeUrl(stock.source_url)) ||
      stock.note.trim() ||
      data.note.trim()
        ? dirtyMemoryStatements(c.env, user.id, [...new Set([stock.project_id, data.project_id])])
        : []),
    ]);
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ ok: true });
  });

  app.delete('/api/v1/stocks/:id', async (c) => {
    const stock = await ownedStock(c);
    const { user } = c.get('principal');
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM stocks WHERE id = ? AND user_id = ?').bind(stock.id, user.id),
      ...orphanCleanupStatements(c.env, user.id),
      ...(!(stock.source_type === 'url' && isYouTubeUrl(stock.source_url)) || stock.note.trim()
        ? dirtyMemoryStatements(c.env, user.id, [stock.project_id])
        : []),
    ]);
    c.executionCtx.waitUntil(
      observeOperation('background', 'cleanup_stock_images', () => cleanupStockImages(c.env)),
    );
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ ok: true });
  });

  app.post('/api/v1/stocks/:id/retry', async (c) => {
    const stock = await ownedStock(c);
    if (stock.source_type === 'url' && isYouTubeUrl(stock.source_url))
      throw new HTTPException(409, { message: youtubeUnavailableMessage });
    const raw = await c.req.text();
    const parsed = z
      .strictObject({ supplemental_text: z.string().trim().min(1).max(20000).optional() })
      .safeParse(
        raw
          ? (() => {
              try {
                return JSON.parse(raw);
              } catch {
                return null;
              }
            })()
          : {},
      );
    if (!parsed.success)
      throw new HTTPException(400, { message: '補完本文は1〜20,000文字で入力してください。' });
    const supplemental = parsed.data.supplemental_text;
    if (stock.status !== 'failed')
      throw new HTTPException(409, { message: '取得に失敗した記事だけ再試行できます。' });
    const article = await c.env.DB.prepare('SELECT generation FROM articles WHERE id=?')
      .bind(stock.article_id)
      .first<{ generation: number }>();
    const jobId = `a-${stock.article_id}-${article!.generation + 1}`;
    await c.env.DB.batch([
      reserveOperation(c.env, { id: jobId, user_id: c.get('principal').user.id, kind: 'article' }),
      assertOperation(c.env, jobId),
      c.env.DB.prepare(
        "UPDATE articles SET status = 'queued', error = NULL, input_text = COALESCE(?, input_text), generation = generation + 1, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'failed' AND generation = ?",
      ).bind(
        supplemental ?? null,
        now(),
        stock.article_id,
        c.get('principal').user.id,
        article!.generation,
      ),
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO processing_jobs (id, user_id, kind, target_id, revision) SELECT 'a-' || id || '-' || generation, user_id, 'article', id, generation FROM articles WHERE id = ? AND user_id = ? AND status = 'queued'",
      ).bind(stock.article_id, c.get('principal').user.id),
      c.env.DB.prepare(
        "UPDATE questions SET status = 'queued', error = NULL, updated_at = ? WHERE source = 'ai' AND status = 'failed' AND stock_id IN (SELECT s.id FROM stocks s JOIN articles a ON a.id = s.article_id WHERE a.id = ? AND s.user_id = ? AND a.status = 'queued')",
      ).bind(now(), stock.article_id, c.get('principal').user.id),
    ]);
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ ok: true }, 202);
  });
}
