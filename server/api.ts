import { isYouTubeUrl, youtubeUnavailableMessage } from '../shared/youtube';
import { encryptToken } from './x';
import { publicProjectsApp, publicationApp } from './public-projects';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import {
  profileSchema,
  stockInputSchema,
  stockListOptionsSchema,
  stockSearchOptionsSchema,
  userQuestionSchema,
  type Question,
  type Stock,
  type User,
} from '../shared/domain';
import type { AppEnv, Env, Principal } from './env';
import { isDemoOrigin } from './env';
import {
  authenticate,
  clearSessionCookies,
  demoLogin,
  googleCallback,
  googleConfigured,
  googleLogin,
  logout,
} from './auth';
import { canonicalUrl, hash, randomSecret, validateUrl } from './security';
import { dirtyMemoryStatements, now, orphanCleanupStatements, queueQuestionStatements } from './db';
import { dispatchJobs } from './jobs';
import { cleanupAccount, requestAccountDeletion } from './account';
import { reserveOperation, assertOperation, retryAt } from './usage';
import { memoryCoverage, memoryId } from './memory';
import {
  createPufuSchema,
  savePufuSchema,
  addPufuPhaseSchema,
  pufuEditorVersion,
  type PufuContext,
  type PufuSummary,
  type PufuScore,
  type PufuPhase,
  type MemorySnapshot,
} from '../shared/pufu';
import { queuePufuJob, initialPufuPhase } from './pufu';
import { listStocks } from './stock-search';
import { SearchError } from './search-ai';
import { readQuestionPufu } from './pufu-read';
import { generateQuestionPufuImage } from './pufu-images';
import { readPufuImageLink } from './pufu-image-links';

const projectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).default(''),
  show_in_all_lists: z.boolean().optional(),
  include_in_user_memory: z.boolean().optional(),
});
const questionColumns =
  "q.id, q.stock_id, q.source, q.is_favorite, q.text, q.status, q.error, q.model, q.created_at, q.updated_at, q.project_id, p.name AS project_name, COALESCE(s.title, a.title) AS article_title, a.status AS article_status, a.domain, EXISTS (SELECT 1 FROM pufu_scores pf WHERE pf.question_id = q.id AND pf.user_id = p.user_id AND pf.status = 'ready') AS has_pufu";
const questionJoins =
  'questions q JOIN projects p ON p.id = q.project_id LEFT JOIN stocks s ON s.id = q.stock_id LEFT JOIN articles a ON a.id = s.article_id';
const pufuColumns =
  'id,question_id,task,status,error,model,editor_version,revision,current_phase,generation,created_at,updated_at';
async function body<T>(c: import('hono').Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'JSON形式で送信してください。' });
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HTTPException(400, {
      message: '入力内容を確認してください。文字数または形式が正しくありません。',
    });
  return result.data;
}
async function ownedProject(env: Env, userId: string, id: string) {
  const project = await env.DB.prepare(
    'SELECT id, name, description, memory_revision, include_in_user_memory FROM projects WHERE id = ? AND user_id = ?',
  )
    .bind(id, userId)
    .first<{
      id: string;
      name: string;
      description: string;
      memory_revision: number;
      include_in_user_memory: number;
    }>();
  if (!project) throw new HTTPException(404, { message: 'プロジェクトが見つかりません。' });
  return project;
}
// OAuth検証済みユーザーによるプロセス内MCP呼び出しでのみprincipalを指定する。
export function createApp(trustedPrincipal?: Principal) {
  const app = new Hono<AppEnv>();
  app.use(
    '/api/*',
    (c, next) =>
      secureHeaders({
        crossOriginResourcePolicy: c.req.path.startsWith('/api/pufu-images/')
          ? 'cross-origin'
          : 'same-origin',
      })(c, next),
    (c, next) =>
      bodyLimit({
        maxSize:
          (c.req.method === 'PATCH' && /^\/api\/v1\/pufus\/[^/]+$/.test(c.req.path)) ||
          (c.req.method === 'POST' && /^\/api\/v1\/pufus\/[^/]+\/phases$/.test(c.req.path))
            ? 262144
            : c.req.method === 'POST' &&
                (c.req.path === '/api/v1/stocks' ||
                  /^\/api\/v1\/stocks\/[^/]+\/retry$/.test(c.req.path))
              ? 163840
              : 16384,
        onError: (c) => c.json({ error: '送信内容が大きすぎます。' }, 413),
      })(c, next),
  );
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.route('/api/public', publicProjectsApp());
  app.on(['GET', 'HEAD'], '/api/pufu-images/:token', async (c) => {
    const image = await readPufuImageLink(c.env, c.req.param('token'), c.req.method === 'HEAD');
    return new Response(image.body, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(image.size),
        'Content-Disposition': `${c.req.query('download') === '1' ? 'attachment' : 'inline'}; filename="pufu.png"`,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  });
  app.get('/api/config', (c) => {
    const origin = new URL(c.req.url).origin;
    const demo = isDemoOrigin(c.env, origin);
    return c.json({
      demo,
      appUrl: demo ? origin : new URL(c.env.APP_URL).origin,
      googleConfigured: googleConfigured(c),
      aiEnabled: Boolean(c.env.AI),
      aiModel: c.env.AI ? c.env.AI_MODEL : null,
    });
  });
  app.get('/api/auth/google', googleLogin);
  app.get('/api/auth/google/callback', googleCallback);
  app.post('/api/auth/demo', async (c) => {
    const response = await demoLogin(c);
    c.executionCtx.waitUntil(dispatchJobs(c.env));
    return response;
  });
  app.use('/api/v1/*', async (c, next) => {
    const principal = trustedPrincipal ?? (await authenticate(c));
    c.set('principal', principal);
    if (
      principal.kind === 'mcp' &&
      !(
        (c.req.method === 'GET' &&
          /^\/api\/v1\/(projects|stocks|stocks\/[^/]+(?:\/content)?|questions|questions\/[^/]+(?:\/pufu(?:\/[^/]+(?:\/image)?)?)?)$/.test(
            c.req.path,
          )) ||
        (c.req.method === 'POST' && ['/api/v1/stocks', '/api/v1/questions'].includes(c.req.path))
      )
    )
      throw new HTTPException(403);
    if (
      principal.kind === 'token' &&
      !(
        (c.req.method === 'GET' && c.req.path === '/api/v1/projects') ||
        (c.req.method === 'POST' && c.req.path === '/api/v1/stocks')
      )
    )
      throw new HTTPException(403, { message: 'このトークンには操作の権限がありません。' });
    await next();
  });
  app.route('/api/v1/projects', publicationApp());
  app.get('/api/v1/integrations/x', async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT updated_at FROM external_integrations WHERE user_id = ? AND provider = 'x'",
    )
      .bind(c.get('principal').user.id)
      .first<{ updated_at: string }>();
    return c.json({
      configured: Boolean(row),
      available: /^[a-f0-9]{64}$/i.test(c.env.INTEGRATION_ENCRYPTION_KEY ?? ''),
      updated_at: row?.updated_at ?? null,
    });
  });
  app.put('/api/v1/integrations/x', async (c) => {
    const { token } = await body(
      c,
      z.strictObject({
        token: z
          .string()
          .trim()
          .min(10)
          .max(4096)
          .regex(/^[A-Za-z0-9%._~+/=-]+$/),
      }),
    );
    const userId = c.get('principal').user.id;
    const encrypted = await encryptToken(c.env, userId, token);
    await c.env.DB.prepare(
      "INSERT INTO external_integrations (user_id, provider, encrypted_token) VALUES (?, 'x', ?) ON CONFLICT(user_id, provider) DO UPDATE SET encrypted_token = excluded.encrypted_token, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
      .bind(userId, encrypted)
      .run();
    return c.json({ ok: true });
  });
  app.delete('/api/v1/integrations/x', async (c) => {
    await c.env.DB.prepare("DELETE FROM external_integrations WHERE user_id = ? AND provider = 'x'")
      .bind(c.get('principal').user.id)
      .run();
    return c.json({ ok: true });
  });
  app.get('/api/v1/me', (c) =>
    c.json({ user: c.get('principal').user, demo: isDemoOrigin(c.env, new URL(c.req.url).origin) }),
  );
  app.patch('/api/v1/me', async (c) => {
    const data = await body(c, profileSchema);
    const userId = c.get('principal').user.id;
    // 更新前の自己紹介を比較し、処理要求とプロフィール・世代を同時に確定する。
    const [queued, updated] = await c.env.DB.batch<User>([
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO processing_jobs (id, user_id, kind, target_id, revision) SELECT 'um-' || id || '-' || (memory_revision + 1), id, 'user_memory', id, memory_revision + 1 FROM users WHERE id = ? AND bio <> ?",
      ).bind(userId, data.bio),
      c.env.DB.prepare(
        'UPDATE users SET name = ?, memory_revision = memory_revision + CASE WHEN bio <> ? THEN 1 ELSE 0 END, bio = ? WHERE id = ? RETURNING id, name, bio, email, avatar_url',
      ).bind(data.name, data.bio, data.bio, userId),
    ]);
    const user = updated.results[0];
    if (!user) throw new HTTPException(401, { message: 'ログインが必要です。' });
    if (queued.meta.changes) c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json({ user });
  });
  app.post('/api/v1/logout', logout);
  app.delete('/api/v1/me', async (c) => {
    const userId = c.get('principal').user.id;
    await requestAccountDeletion(c.env, userId);
    clearSessionCookies(c);
    const complete = await cleanupAccount(c.env, userId);
    return c.json({ ok: true, cleanup_pending: !complete }, complete ? 200 : 202);
  });
  app.get('/api/v1/projects', async (c) => {
    const { user, tokenProjectId } = c.get('principal');
    const result = await c.env.DB.prepare(
      "SELECT p.id, p.name, p.description, p.show_in_all_lists, p.include_in_user_memory, p.created_at, COUNT(s.id) AS count, COALESCE(SUM(a.status = 'ready'), 0) AS ready_count, (SELECT COUNT(*) FROM questions q WHERE q.project_id = p.id) AS question_count FROM projects p LEFT JOIN stocks s ON s.project_id = p.id LEFT JOIN articles a ON a.id = s.article_id WHERE p.user_id = ? AND (? IS NULL OR p.id = ?) GROUP BY p.id ORDER BY p.created_at, p.id",
    )
      .bind(user.id, tokenProjectId, tokenProjectId)
      .all();
    return c.json({
      projects: result.results.map((project) => ({
        ...project,
        show_in_all_lists: Boolean(project.show_in_all_lists),
        include_in_user_memory: Boolean(project.include_in_user_memory),
      })),
    });
  });
  app.post('/api/v1/projects', async (c) => {
    const { user } = c.get('principal');
    const data = await body(c, projectSchema);
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM projects WHERE user_id = ?')
      .bind(user.id)
      .first<{ count: number }>();
    if (count!.count >= 50)
      throw new HTTPException(422, { message: 'プロジェクトは50件まで作成できます。' });
    const id = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO projects (id, user_id, name, description, show_in_all_lists, include_in_user_memory) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(
        id,
        user.id,
        data.name,
        data.description,
        Number(data.show_in_all_lists ?? true),
        Number(data.include_in_user_memory ?? true),
      ),
      ...dirtyMemoryStatements(c.env, user.id, [id]),
    ]);
    c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json({ id }, 201);
  });
  app.patch('/api/v1/projects/:id', async (c) => {
    const { user } = c.get('principal');
    const id = c.req.param('id');
    const project = await ownedProject(c.env, user.id, id);
    const data = await body(c, projectSchema);
    const memoryChanged =
      project.name !== data.name ||
      project.description !== data.description ||
      (data.include_in_user_memory !== undefined &&
        Boolean(project.include_in_user_memory) !== data.include_in_user_memory);
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE projects SET name = ?, description = ?, show_in_all_lists = COALESCE(?, show_in_all_lists), include_in_user_memory = COALESCE(?, include_in_user_memory) WHERE id = ? AND user_id = ?',
      ).bind(
        data.name,
        data.description,
        data.show_in_all_lists === undefined ? null : Number(data.show_in_all_lists),
        data.include_in_user_memory === undefined ? null : Number(data.include_in_user_memory),
        id,
        user.id,
      ),
      ...(memoryChanged ? dirtyMemoryStatements(c.env, user.id, [id]) : []),
    ]);
    if (memoryChanged) c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json({ ok: true });
  });
  app.delete('/api/v1/projects/:id', async (c) => {
    const { user } = c.get('principal');
    await ownedProject(c.env, user.id, c.req.param('id'));
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').bind(
        c.req.param('id'),
        user.id,
      ),
      ...orphanCleanupStatements(c.env, user.id),
      ...dirtyMemoryStatements(c.env, user.id, []),
    ]);
    c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json({ ok: true });
  });
  app.get('/api/v1/stocks', async (c) => {
    const { user, tokenProjectId } = c.get('principal');
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
    if (tokenProjectId && requested && requested !== tokenProjectId) throw new HTTPException(403);
    const projectId = tokenProjectId ?? requested;
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
    const { user, tokenProjectId } = c.get('principal');
    const data = await body(c, stockInputSchema);
    if (tokenProjectId && data.project_id !== undefined && tokenProjectId !== data.project_id)
      throw new HTTPException(403, { message: 'このトークンの保存先プロジェクトとは異なります。' });
    const projectId = data.project_id ?? tokenProjectId;
    if (projectId) await ownedProject(c.env, user.id, projectId);
    const source = data.type === 'url' ? validateUrl(data.url) : null;
    const youtube = source !== null && isYouTubeUrl(source.href);
    const title =
      data.type === 'text'
        ? data.title || data.text.split('\n', 1)[0].trim().slice(0, 80)
        : youtube
          ? 'YouTube'
          : source!.hostname;
    const canonical =
      data.type === 'text'
        ? `text:${await hash(JSON.stringify([title, data.text]))}`
        : canonicalUrl(data.url);
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
        'INSERT OR IGNORE INTO articles (id, user_id, canonical_url, source_url, title, domain, source_type, input_text, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
    c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json(
      { id: stock!.id, status: stock!.status, duplicate: !created },
      created ? 202 : 200,
    );
  });
  app.get('/api/v1/articles/:id', async (c) => {
    const row = await c.env.DB.prepare(
      'SELECT s.id, s.is_favorite, s.article_id, s.project_id, p.name AS project_name, s.note, s.created_at, COALESCE(s.title, a.title) AS title, a.source_type, a.source_url, a.domain, a.status, a.summary_json, a.error, a.model FROM articles a JOIN stocks s ON s.article_id = a.id JOIN projects p ON p.id = s.project_id WHERE a.id = ? AND a.user_id = ? ORDER BY s.created_at LIMIT 1',
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
  async function ownedStock(c: import('hono').Context<AppEnv>) {
    const stock = await c.env.DB.prepare(
      'SELECT s.id, s.project_id, s.article_id, s.note, a.source_type, a.source_url, a.status, a.generation, a.content_key, a.input_text FROM stocks s JOIN articles a ON a.id = s.article_id WHERE s.id = ? AND s.user_id = ?',
    )
      .bind(c.req.param('id'), c.get('principal').user.id)
      .first<{
        id: string;
        project_id: string;
        article_id: string;
        note: string;
        source_type: 'url' | 'text';
        source_url: string;
        status: string;
        generation: number;
        content_key: string | null;
        input_text: string | null;
      }>();
    if (!stock) throw new HTTPException(404, { message: '記事が見つかりません。' });
    return stock;
  }
  async function ownedQuestion(c: import('hono').Context<AppEnv>) {
    const question = await c.env.DB.prepare(
      `SELECT ${questionColumns} FROM ${questionJoins} WHERE q.id = ? AND p.user_id = ?`,
    )
      .bind(c.req.param('id'), c.get('principal').user.id)
      .first<Question>();
    if (!question) throw new HTTPException(404, { message: '問いが見つかりません。' });
    return question;
  }
  async function ownedPufu(c: import('hono').Context<AppEnv>) {
    const pufu = await c.env.DB.prepare(
      `SELECT ${pufuColumns} FROM pufu_scores WHERE id = ? AND user_id = ?`,
    )
      .bind(c.req.param('id'), c.get('principal').user.id)
      .first<PufuSummary>();
    if (!pufu) throw new HTTPException(404, { message: 'プ譜が見つかりません。' });
    return pufu;
  }
  app.get('/api/v1/questions/:id', async (c) => {
    const question = await ownedQuestion(c);
    const pufus = await c.env.DB.prepare(
      `SELECT ${pufuColumns} FROM pufu_scores WHERE question_id = ? AND user_id = ? ORDER BY created_at DESC,id DESC`,
    )
      .bind(question.id, c.get('principal').user.id)
      .all<PufuSummary>();
    c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json({ question, pufus: pufus.results });
  });
  app.get('/api/v1/questions/:id/pufu', async (c) =>
    c.json(await readQuestionPufu(c.env, c.get('principal'), c.req.param('id'))),
  );
  app.get('/api/v1/questions/:id/pufu/image', async (c) => {
    const image = await generateQuestionPufuImage(c.env, c.get('principal'), c.req.param('id'));
    if (!image.png) return c.json(image.metadata);
    return c.body(new Uint8Array(image.png), 200, { 'Content-Type': 'image/png' });
  });
  app.get('/api/v1/questions/:question_id/pufu/:pufu_id', async (c) =>
    c.json(
      await readQuestionPufu(
        c.env,
        c.get('principal'),
        c.req.param('question_id'),
        c.req.param('pufu_id'),
      ),
    ),
  );
  app.get('/api/v1/questions/:question_id/pufu/:pufu_id/image', async (c) => {
    const image = await generateQuestionPufuImage(
      c.env,
      c.get('principal'),
      c.req.param('question_id'),
      c.req.param('pufu_id'),
    );
    return c.body(new Uint8Array(image.png!), 200, { 'Content-Type': 'image/png' });
  });
  app.delete('/api/v1/questions/:id', async (c) => {
    const question = await ownedQuestion(c);
    const { user } = c.get('principal');
    const statements: D1PreparedStatement[] = [];
    if (question.source === 'ai') {
      statements.push(
        c.env.DB.prepare(
          'UPDATE stocks SET ai_question_dismissed = 1 WHERE id = ? AND user_id = ?',
        ).bind(question.stock_id, user.id),
        c.env.DB.prepare(
          "UPDATE processing_jobs SET status = 'done', error = NULL, updated_at = ? WHERE user_id = ? AND kind = 'question' AND target_id = ? AND status != 'done'",
        ).bind(now(), user.id, question.stock_id),
      );
    }
    statements.push(
      c.env.DB.prepare(
        "UPDATE processing_jobs SET status = 'done', error = NULL, updated_at = ? WHERE user_id = ? AND kind = 'pufu' AND target_id IN (SELECT id FROM pufu_scores WHERE question_id = ? AND user_id = ?) AND status != 'done'",
      ).bind(now(), user.id, question.id, user.id),
      c.env.DB.prepare(
        'DELETE FROM questions WHERE id = ? AND EXISTS (SELECT 1 FROM projects WHERE id = questions.project_id AND user_id = ?)',
      ).bind(question.id, user.id),
    );
    await c.env.DB.batch(statements);
    return c.json({ ok: true });
  });
  app.post('/api/v1/questions/:id/pufus', async (c) => {
    const { user } = c.get('principal');
    const question = await ownedQuestion(c);
    const data = await body(c, createPufuSchema);
    const id = `pufu-${user.id}-${data.request_id}`;
    const previous = await c.env.DB.prepare(
      `SELECT ${pufuColumns} FROM pufu_scores WHERE id = ? AND user_id = ?`,
    )
      .bind(id, user.id)
      .first<PufuSummary>();
    if (previous) {
      if (previous.question_id !== question.id || previous.task !== data.task)
        throw new HTTPException(409, { message: '同じリクエストIDで異なる課題が送信されました。' });
      c.executionCtx.waitUntil(dispatchJobs(c.env));
      return c.json({ id, status: previous.status });
    }
    if (question.status !== 'ready' || !question.text)
      throw new HTTPException(409, { message: '問いの生成が完了してから、プ譜を作成できます。' });
    const project = await ownedProject(c.env, user.id, question.project_id);
    const [stockRows, memoryRows] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        'SELECT note, summary_json FROM stocks s JOIN articles a ON a.id = s.article_id WHERE s.id = ? AND s.user_id = ?',
      ).bind(question.stock_id, user.id),
      c.env.DB.prepare(
        'SELECT id,project_id,revision,text,data_json,updated_at FROM memories WHERE user_id = ? AND (project_id IS NULL OR project_id = ?)',
      ).bind(user.id, question.project_id),
    ]);
    const stock = stockRows.results[0];
    if (question.stock_id && !stock)
      throw new HTTPException(404, { message: 'ストックが見つかりません。' });
    const snapshot = (projectId: string | null): MemorySnapshot | null => {
      const row = memoryRows.results.find((item) => item.project_id === projectId);
      return row
        ? {
            id: String(row.id),
            revision: Number(row.revision),
            text: String(row.text),
            data: JSON.parse(String(row.data_json)),
            updated_at: String(row.updated_at),
          }
        : null;
    };
    const context: PufuContext = {
      question: { id: question.id, text: question.text, source: question.source },
      task: data.task,
      project: { id: project.id, name: project.name, description: project.description },
      stock:
        question.stock_id && stock
          ? {
              id: question.stock_id,
              title: question.article_title ?? '',
              summary: stock.summary_json ? JSON.parse(String(stock.summary_json)) : null,
              note: String(stock.note),
            }
          : null,
      userMemory: snapshot(null),
      projectMemory: snapshot(question.project_id),
    };
    const jobId = `pufu-job-${id}-1`;
    const result = await c.env.DB.batch([
      reserveOperation(c.env, { id: jobId, user_id: user.id, kind: 'pufu' }),
      assertOperation(c.env, jobId),
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO pufu_scores (id,user_id,question_id,task,input_json,editor_version) SELECT ?,?,?,?,?,? FROM questions q JOIN projects p ON p.id = q.project_id WHERE q.id = ? AND p.user_id = ? AND q.status = 'ready'",
      ).bind(
        id,
        user.id,
        question.id,
        data.task,
        JSON.stringify(context),
        pufuEditorVersion,
        question.id,
        user.id,
      ),
      queuePufuJob(c.env, id),
    ]);
    const saved = await c.env.DB.prepare(
      `SELECT ${pufuColumns} FROM pufu_scores WHERE id = ? AND user_id = ?`,
    )
      .bind(id, user.id)
      .first<PufuSummary>();
    if (!saved)
      throw new HTTPException(409, { message: '問いが変更されました。開き直してお試しください。' });
    if (saved.question_id !== question.id || saved.task !== data.task)
      throw new HTTPException(409, { message: '同じリクエストIDで異なる課題が送信されました。' });
    c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json({ id, status: saved.status }, result[2].meta.changes ? 202 : 200);
  });
  app.get('/api/v1/pufus/:id', async (c) => {
    const id = c.req.param('id');
    const userId = c.get('principal').user.id;
    // 本体の更新番号と局面一覧を、同じトランザクションの状態として読み取る。
    const [, rows, phases] = await c.env.DB.batch([
      initialPufuPhase(c.env, id, userId),
      c.env.DB.prepare(
        `SELECT ${pufuColumns},score_json,input_json FROM pufu_scores WHERE id = ? AND user_id = ?`,
      ).bind(id, userId),
      c.env.DB.prepare(
        'SELECT number,score_json,created_at,updated_at FROM pufu_phases WHERE pufu_id = ? AND EXISTS (SELECT 1 FROM pufu_scores WHERE id = pufu_id AND user_id = ?) ORDER BY number',
      ).bind(id, userId),
    ]);
    const row = rows.results[0] as
      (PufuSummary & { score_json: string | null; input_json: string }) | undefined;
    if (!row) throw new HTTPException(404, { message: 'プ譜が見つかりません。' });
    const { score_json, input_json, ...pufu } = row;
    const phaseRows = phases.results as (Omit<PufuPhase, 'score'> & { score_json: string })[];
    c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json({
      pufu: {
        ...pufu,
        score: score_json ? (JSON.parse(score_json) as PufuScore) : null,
        phases: phaseRows.map(({ score_json, ...phase }) => ({
          ...phase,
          score: JSON.parse(score_json) as PufuScore,
        })),
        context: JSON.parse(input_json) as PufuContext,
      },
    });
  });
  app.get('/api/v1/pufus', async (c) => {
    const { user } = c.get('principal');
    const projectId = c.req.query('project_id') || null;
    if (projectId) await ownedProject(c.env, user.id, projectId);
    const page = Math.max(1, Math.min(5000, Math.trunc(Number(c.req.query('page')) || 1)));
    const joins =
      'pufu_scores pf JOIN questions q ON q.id=pf.question_id JOIN projects p ON p.id=q.project_id';
    const where =
      'pf.user_id=? AND p.user_id=? AND ((? IS NULL AND p.show_in_all_lists=1) OR p.id=?)';
    const params = [user.id, user.id, projectId, projectId];
    const [rows, totals] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `SELECT ${pufuColumns
          .split(',')
          .map((column) => `pf.${column}`)
          .join(',')},
          p.id AS project_id,p.name AS project_name,q.text AS question_text
          FROM ${joins} WHERE ${where} ORDER BY pf.created_at DESC,pf.id DESC LIMIT 24 OFFSET ?`,
      ).bind(...params, (page - 1) * 24),
      c.env.DB.prepare(`SELECT COUNT(*) AS count FROM ${joins} WHERE ${where}`).bind(...params),
    ]);
    return c.json({ pufus: rows.results, total: totals.results[0].count, page, pageSize: 24 });
  });
  async function savePufu(c: import('hono').Context<AppEnv>, append: boolean) {
    const pufu = await ownedPufu(c);
    const data = await body(c, append ? addPufuPhaseSchema : savePufuSchema);
    if (pufu.status !== 'ready')
      throw new HTTPException(409, { message: 'プ譜の生成が完了してから保存してください。' });
    const phase = data.phase ?? pufu.current_phase;
    if (append && phase !== pufu.current_phase)
      throw new HTTPException(409, {
        message: '局面の追加は最新の局面から行ってください。',
      });
    if (phase > pufu.current_phase)
      throw new HTTPException(404, { message: '局面が見つかりません。' });
    const json = JSON.stringify(data.score);
    const timestamp = now();
    const userId = c.get('principal').user.id;
    const condition =
      "id = ? AND user_id = ? AND status = 'ready' AND revision = ? AND current_phase = ? AND EXISTS (SELECT 1 FROM pufu_phases WHERE pufu_id = pufu_scores.id AND number = ?)";
    const values = [pufu.id, userId, data.revision, pufu.current_phase, phase];
    // すべての書き込みを同じ更新番号で制限し、保存と局面追加を1トランザクションで確定する。
    const statements = [
      initialPufuPhase(c.env, pufu.id, userId),
      c.env.DB.prepare(
        `UPDATE pufu_phases SET score_json = ?, updated_at = ? WHERE pufu_id = ? AND number = ? AND EXISTS (SELECT 1 FROM pufu_scores WHERE ${condition})`,
      ).bind(json, timestamp, pufu.id, phase, ...values),
    ];
    if (append)
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO pufu_phases (pufu_id, number, score_json, created_at, updated_at) SELECT id, current_phase + 1, ?, ?, ? FROM pufu_scores WHERE ${condition}`,
        ).bind(json, timestamp, timestamp, ...values),
      );
    statements.push(
      c.env.DB.prepare(
        `UPDATE pufu_scores SET score_json = CASE WHEN current_phase = ? THEN ? ELSE score_json END, current_phase = current_phase + ?, revision = revision + 1, updated_at = ? WHERE ${condition} RETURNING revision,current_phase,updated_at`,
      ).bind(phase, json, append ? 1 : 0, timestamp, ...values),
    );
    const results = await c.env.DB.batch<{
      revision: number;
      current_phase: number;
      updated_at: string;
    }>(statements);
    const result = results.at(-1)!.results[0];
    if (!result)
      throw new HTTPException(409, {
        message: '別の画面で更新されています。編集中の内容をJSONで保存し、開き直してください。',
      });
    return c.json(result, append ? 201 : 200);
  }
  app.patch('/api/v1/pufus/:id', (c) => savePufu(c, false));
  app.post('/api/v1/pufus/:id/phases', (c) => savePufu(c, true));
  app.post('/api/v1/pufus/:id/retry', async (c) => {
    const pufu = await ownedPufu(c);
    if (pufu.status !== 'failed')
      throw new HTTPException(409, { message: '生成に失敗したプ譜だけ再試行できます。' });
    const jobId = `pufu-job-${pufu.id}-${pufu.generation + 1}`;
    await c.env.DB.batch([
      reserveOperation(c.env, { id: jobId, user_id: c.get('principal').user.id, kind: 'pufu' }),
      assertOperation(c.env, jobId),
      c.env.DB.prepare(
        "UPDATE pufu_scores SET status = 'queued', error = NULL, generation = generation + 1, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'failed' AND generation = ?",
      ).bind(now(), pufu.id, c.get('principal').user.id, pufu.generation),
      queuePufuJob(c.env, pufu.id),
    ]);
    c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json({ ok: true }, 202);
  });
  app.get('/api/v1/questions', async (c) => {
    const { user } = c.get('principal');
    const projectId = c.req.query('project_id') || null;
    if (projectId) await ownedProject(c.env, user.id, projectId);
    const query = (c.req.query('q') ?? '').slice(0, 200).replace(/[\\%_]/g, '\\$&');
    const status = c.req.query('status') ?? 'all';
    if (!['all', 'ready', 'processing', 'failed'].includes(status)) throw new HTTPException(400);
    const source = c.req.query('source') ?? 'all';
    if (!['all', 'ai', 'user'].includes(source)) throw new HTTPException(400);
    const favorite = c.req.query('favorite') ?? 'false';
    if (!['true', 'false'].includes(favorite)) throw new HTTPException(400);
    const page = Math.max(1, Math.min(5000, Math.trunc(Number(c.req.query('page')) || 1)));
    const where =
      "p.user_id = ? AND ((? IS NULL AND p.show_in_all_lists = 1) OR q.project_id = ?) AND (COALESCE(q.text, '') LIKE ? ESCAPE '\\' OR COALESCE(s.title, a.title, '') LIKE ? ESCAPE '\\' OR COALESCE(s.note, '') LIKE ? ESCAPE '\\') AND (? = 'all' OR (? = 'processing' AND q.status IN ('queued','generating')) OR q.status = ?) AND (? = 'all' OR q.source = ?)" +
      (favorite === 'true' ? ' AND q.is_favorite = 1' : '');
    const params = [
      user.id,
      projectId,
      projectId,
      `%${query}%`,
      `%${query}%`,
      `%${query}%`,
      status,
      status,
      status,
      source,
      source,
    ];
    const [rows, totals] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `SELECT ${questionColumns} FROM ${questionJoins} WHERE ${where} ORDER BY q.created_at DESC, q.id DESC LIMIT 24 OFFSET ?`,
      ).bind(...params, (page - 1) * 24),
      c.env.DB.prepare(`SELECT COUNT(*) AS count FROM ${questionJoins} WHERE ${where}`).bind(
        ...params,
      ),
    ]);
    c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json({ questions: rows.results, total: totals.results[0].count, page, pageSize: 24 });
  });
  app.post('/api/v1/questions', async (c) => {
    const { user } = c.get('principal');
    const data = await body(c, userQuestionSchema);
    const stockId = data.stock_id ?? null;
    const stock = stockId
      ? await c.env.DB.prepare('SELECT project_id FROM stocks WHERE id = ? AND user_id = ?')
          .bind(stockId, user.id)
          .first<{ project_id: string }>()
      : null;
    if (stockId && !stock)
      throw new HTTPException(404, { message: '紐づけるストックが見つかりません。' });
    if (stock && data.project_id && stock.project_id !== data.project_id)
      throw new HTTPException(400, { message: 'ストックとプロジェクトが一致しません。' });
    const projectId = data.project_id ?? stock!.project_id;
    await ownedProject(c.env, user.id, projectId);
    const id = `user-${user.id}-${data.request_id ?? crypto.randomUUID()}`;
    const result = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO questions (id, project_id, stock_id, text, source, status) SELECT ?, id, ?, ?, 'user', 'ready' FROM projects WHERE id = ? AND user_id = ?",
    )
      .bind(id, stockId, data.text, projectId, user.id)
      .run();
    const question = await c.env.DB.prepare(
      `SELECT ${questionColumns} FROM ${questionJoins} WHERE q.id = ? AND p.user_id = ?`,
    )
      .bind(id, user.id)
      .first<Question>();
    if (!question) throw new HTTPException(404, { message: '紐づけるストックが見つかりません。' });
    if (
      question.stock_id !== stockId ||
      question.project_id !== projectId ||
      question.text !== data.text ||
      question.source !== 'user'
    )
      throw new HTTPException(409, { message: '同じリクエストIDで異なる問いが送信されました。' });
    return c.json({ question }, result.meta.changes ? 201 : 200);
  });
  app.patch('/api/v1/questions/:id/favorite', async (c) => {
    const data = await body(c, z.strictObject({ is_favorite: z.boolean() }));
    const question = await c.env.DB.prepare(
      'UPDATE questions SET is_favorite = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM projects WHERE id = questions.project_id AND user_id = ?) RETURNING id, is_favorite',
    )
      .bind(Number(data.is_favorite), now(), c.req.param('id'), c.get('principal').user.id)
      .first<Pick<Question, 'id' | 'is_favorite'>>();
    if (!question) throw new HTTPException(404, { message: '問いが見つかりません。' });
    return c.json(question);
  });
  app.get('/api/v1/stocks/:id', async (c) => {
    const row = await c.env.DB.prepare(
      'SELECT s.id, s.is_favorite, s.article_id, s.project_id, p.name AS project_name, s.note, s.created_at, COALESCE(s.title, a.title) AS title, a.source_type, a.source_url, a.domain, a.status, a.summary_json, a.error, a.model FROM stocks s JOIN articles a ON a.id = s.article_id JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND s.user_id = ?',
    )
      .bind(c.req.param('id'), c.get('principal').user.id)
      .first<Record<string, unknown>>();
    if (!row) throw new HTTPException(404, { message: '記事が見つかりません。' });
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
      `SELECT ${questionColumns} FROM ${questionJoins} WHERE s.id = ? AND s.user_id = ? ORDER BY q.created_at DESC, q.id DESC`,
    )
      .bind(c.req.param('id'), c.get('principal').user.id)
      .all<Question>();
    c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json({
      question:
        rows.results.find((question) => question.source === 'ai') ?? rows.results[0] ?? null,
      questions: rows.results,
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
      throw new HTTPException(409, { message: '生成に失敗した問いだけ再試行できます。' });
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
    c.executionCtx.waitUntil(dispatchJobs(c.env));
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
      c.env.DB.prepare(
        'UPDATE stocks SET note = ?, project_id = ? WHERE id = ? AND user_id = ?',
      ).bind(data.note, data.project_id, stock.id, user.id),
      ...(!(stock.source_type === 'url' && isYouTubeUrl(stock.source_url)) ||
      stock.note.trim() ||
      data.note.trim()
        ? dirtyMemoryStatements(c.env, user.id, [...new Set([stock.project_id, data.project_id])])
        : []),
    ]);
    c.executionCtx.waitUntil(dispatchJobs(c.env));
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
    c.executionCtx.waitUntil(dispatchJobs(c.env));
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
    c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json({ ok: true }, 202);
  });
  app.get('/api/v1/memory', async (c) => {
    const { user } = c.get('principal');
    const projectId = c.req.query('project_id') || null;
    const owner = projectId
      ? await ownedProject(c.env, user.id, projectId)
      : await c.env.DB.prepare(
          'SELECT memory_revision,name,bio AS description FROM users WHERE id = ?',
        )
          .bind(user.id)
          .first<{ memory_revision: number; name: string; description: string }>();
    const coverage = await memoryCoverage(c.env, user.id, projectId, {
      name: owner!.name,
      description: owner!.description,
      scope: projectId ? 'project' : 'user',
    });
    const memoryId = projectId ? `project-${projectId}` : `user-${user.id}`;
    const row = await c.env.DB.prepare('SELECT * FROM memories WHERE id = ? AND user_id = ?')
      .bind(memoryId, user.id)
      .first();
    const job = await c.env.DB.prepare(
      "SELECT status, error FROM processing_jobs WHERE user_id = ? AND kind = ? AND target_id = ? AND revision = ? ORDER BY status IN ('pending','dispatched','running') DESC, created_at DESC LIMIT 1",
    )
      .bind(
        user.id,
        projectId ? 'project_memory' : 'user_memory',
        projectId ?? user.id,
        owner!.memory_revision,
      )
      .first<{ status: string; error: string | null }>();
    const pending = Boolean(job && ['pending', 'dispatched', 'running'].includes(job.status));
    if (!row) return c.json({ memory: null, pending, error: job?.error ?? null, coverage });
    const { data_json, ...memory } = row;
    return c.json({
      memory: {
        ...memory,
        data: JSON.parse(String(data_json)),
        current_revision: owner!.memory_revision,
        pending,
        error: job?.error ?? null,
      },
      pending,
      error: job?.error ?? null,
      coverage,
    });
  });
  app.post('/api/v1/memory/rebuild', async (c) => {
    const { user } = c.get('principal');
    const data = await body(
      c,
      z.object({
        project_id: z.string().max(100).nullable().default(null),
        request_id: z.uuid().optional(),
        mode: z.enum(['incremental', 'full']).default('full'),
      }),
    );
    if (data.project_id) await ownedProject(c.env, user.id, data.project_id);
    const key = c.req.header('Idempotency-Key') ?? data.request_id ?? crypto.randomUUID();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(key))
      throw new HTTPException(400, { message: 'リクエストIDの形式が正しくありません。' });
    const requestId = `memory-${user.id}-${key}`;
    const previous = await c.env.DB.prepare(
      'SELECT project_id,mode FROM memory_requests WHERE id=? AND user_id=?',
    )
      .bind(requestId, user.id)
      .first<{ project_id: string | null; mode: string }>();
    if (previous) {
      if (previous.project_id !== data.project_id || previous.mode !== data.mode)
        throw new HTTPException(409, {
          message: '同じリクエストIDで異なる保存先または更新方法が送信されました。',
        });
      return c.json({ ok: true }, 202);
    }
    const target = data.project_id
      ? { id: data.project_id, kind: 'project_memory' as const, table: 'projects' }
      : { id: user.id, kind: 'user_memory' as const, table: 'users' };
    const id = `${requestId}-${target.kind}`;
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        'INSERT INTO memory_requests (id,user_id,project_id,mode) VALUES (?,?,?,?)',
      ).bind(requestId, user.id, data.project_id, data.mode),
      reserveOperation(c.env, { id, user_id: user.id, kind: target.kind }),
      assertOperation(c.env, id),
      c.env.DB.prepare(
        `UPDATE ${target.table} SET memory_revision=memory_revision+1 WHERE id=?`,
      ).bind(target.id),
      c.env.DB.prepare(
        `INSERT INTO processing_jobs (id,user_id,kind,target_id,revision,memory_mode) SELECT ?,?,?,id,memory_revision,? FROM ${target.table} WHERE id=?`,
      ).bind(id, user.id, target.kind, data.mode, target.id),
    ];
    if (data.mode === 'full')
      statements.push(
        c.env.DB.prepare('UPDATE memories SET force_full=1 WHERE id=? AND user_id=?').bind(
          memoryId(user.id, data.project_id),
          user.id,
        ),
      );
    try {
      await c.env.DB.batch(statements);
    } catch (error) {
      const replay = await c.env.DB.prepare(
        'SELECT project_id,mode FROM memory_requests WHERE id=? AND user_id=?',
      )
        .bind(requestId, user.id)
        .first<{ project_id: string | null; mode: string }>();
      if (!replay) throw error;
      if (replay.project_id !== data.project_id || replay.mode !== data.mode)
        throw new HTTPException(409, {
          message: '同じリクエストIDで異なる保存先または更新方法が送信されました。',
        });
    }
    c.executionCtx.waitUntil(dispatchJobs(c.env));
    return c.json({ ok: true }, 202);
  });
  app.get('/api/v1/tokens', async (c) => {
    const rows = await c.env.DB.prepare(
      'SELECT id, name, prefix, project_id, expires_at, revoked_at, last_used_at, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC',
    )
      .bind(c.get('principal').user.id)
      .all();
    return c.json({ tokens: rows.results });
  });
  app.post('/api/v1/tokens', async (c) => {
    const { user } = c.get('principal');
    const data = await body(
      c,
      z.object({
        name: z.string().trim().min(1).max(80),
        project_id: z.string().max(100).nullable().default(null),
        expires_days: z.number().int().min(1).max(365).nullable().default(90),
      }),
    );
    if (data.project_id) await ownedProject(c.env, user.id, data.project_id);
    const count = await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)',
    )
      .bind(user.id, now())
      .first<{ count: number }>();
    if (count!.count >= 20)
      throw new HTTPException(422, {
        message: '有効なトークンは20個までです。不要なトークンを失効してください。',
      });
    const token = `pls_${randomSecret()}`;
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, project_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        id,
        user.id,
        data.name,
        await hash(token),
        token.slice(0, 11),
        data.project_id,
        data.expires_days === null
          ? null
          : new Date(Date.now() + data.expires_days * 86400000).toISOString(),
      )
      .run();
    return c.json({ id, token }, 201);
  });
  app.delete('/api/v1/tokens/:id', async (c) => {
    const result = await c.env.DB.prepare(
      'UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?',
    )
      .bind(now(), c.req.param('id'), c.get('principal').user.id)
      .run();
    if (!result.meta.changes) throw new HTTPException(404);
    return c.json({ ok: true });
  });
  app.notFound((c) => c.json({ error: '見つかりません。' }, 404));
  app.onError(async (error, c) => {
    const errorDetail = `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}`;
    const stockLimit = errorDetail.includes('stock_quota');
    if (stockLimit || errorDetail.includes('ai_quota')) {
      const at = await retryAt(
        c.env,
        c.get('principal').user.id,
        stockLimit
          ? 'stock'
          : c.req.path.includes('/pufus')
            ? 'pufu'
            : c.req.path.includes('/memory/')
              ? 'user_memory'
              : c.req.path.includes('/question/')
                ? 'question'
                : 'article',
      );
      c.header('Retry-After', String(Math.max(1, Math.ceil((Date.parse(at) - Date.now()) / 1000))));
      return c.json(
        {
          error: stockLimit
            ? '直近24時間の保存上限（200件）に達しました。ストックを削除しても利用件数は減りません。'
            : 'AI処理の利用上限または同時処理数に達しました。処理中の完了を待つか、再試行時刻以降にお試しください。',
          retry_at: at,
        },
        429,
      );
    }
    if (error instanceof HTTPException)
      return c.json({ error: error.message || 'リクエストを確認してください。' }, error.status);
    console.error('api_request_failed', { path: c.req.path });
    return c.json({ error: '処理に失敗しました。時間をおいて再度お試しください。' }, 500);
  });
  return app;
}
