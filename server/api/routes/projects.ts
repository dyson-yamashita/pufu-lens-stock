import { footprintIntervalSchema, footprintPublicationSchema } from '../../../shared/footprints';
import {
  listFootprints,
  publishFootprint,
  readFootprint,
  startFootprintBackfill,
  startFootprintReanalysis,
  unpublishFootprint,
} from '../../features/memory/footprint-repository';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { reflectionPeriodSchema } from '../../../shared/reflections';
import type { AppEnv } from '../../env';
import { historyPrefix, queueHistoryCleanup } from '../../features/memory/memory-history';
import { projectScopeJson } from '../../features/projects/project-access';
import {
  includesReflectionCards,
  visibleReflection,
} from '../../features/questions/reflection-repository';
import { cleanupStockImages } from '../../features/stocks/stock-images';
import { dirtyMemoryStatements, orphanCleanupStatements } from '../../infrastructure/db';
import { observeOperation } from '../../infrastructure/diagnostics';
import { dispatchJobs } from '../../infrastructure/jobs/jobs';
import { ownedProject } from '../context';
import { body } from '../validation';

const projectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).default(''),
  show_in_all_lists: z.boolean().optional(),
  include_in_user_memory: z.boolean().optional(),
  auto_generate_questions: z.boolean().optional(),
  reflection_period: reflectionPeriodSchema.optional(),
  footprints_enabled: z.boolean().optional(),
  footprint_interval: footprintIntervalSchema.optional(),
});

function footprintRevision(value: string) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new HTTPException(404);
  return revision;
}

export function registerProjectsRoutes(app: Hono<AppEnv>) {
  app.get('/api/v1/projects', async (c) => {
    const principal = c.get('principal');
    const { user } = principal;
    const reflectionCount = includesReflectionCards(principal, c.req.query('include_reflections'))
      ? `+ (SELECT COUNT(*) FROM reflections r WHERE r.project_id=p.id AND ${visibleReflection('r')})`
      : '';
    const result = await c.env.DB.prepare(
      `SELECT p.id,p.name,p.description,p.show_in_all_lists,p.include_in_user_memory,
        p.auto_generate_questions,p.reflection_period,p.footprints_enabled,p.footprint_interval,p.created_at,COUNT(s.id) AS count,
        COALESCE(SUM(a.status='ready'),0) AS ready_count,
        (SELECT COUNT(*) FROM questions q WHERE q.project_id=p.id) ${reflectionCount} AS question_count,
        (SELECT COUNT(*) FROM questions q WHERE q.project_id=p.id AND q.source='user') AS user_question_count,
        (SELECT COUNT(*) FROM pufu_scores pf WHERE pf.project_id=p.id AND pf.user_id=p.user_id) AS pufu_count
      FROM projects p LEFT JOIN stocks s ON s.project_id=p.id LEFT JOIN articles a ON a.id=s.article_id
      WHERE p.user_id=? AND (? IS NULL OR p.id IN (SELECT value FROM json_each(?)))
      GROUP BY p.id ORDER BY p.created_at,p.id`,
    )
      .bind(user.id, projectScopeJson(principal), projectScopeJson(principal))
      .all();
    return c.json({
      projects: result.results.map((project) => ({
        ...project,
        show_in_all_lists: Boolean(project.show_in_all_lists),
        include_in_user_memory: Boolean(project.include_in_user_memory),
        auto_generate_questions: Boolean(project.auto_generate_questions),
        footprints_enabled: Boolean(project.footprints_enabled),
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
        'INSERT INTO projects (id, user_id, name, description, show_in_all_lists, include_in_user_memory, auto_generate_questions, reflection_period, footprints_enabled, footprint_interval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        id,
        user.id,
        data.name,
        data.description,
        Number(data.show_in_all_lists ?? true),
        Number(data.include_in_user_memory ?? true),
        Number(data.auto_generate_questions ?? true),
        data.reflection_period ?? 'weekly',
        Number(data.footprints_enabled ?? true),
        data.footprint_interval ?? 3,
      ),
      ...dirtyMemoryStatements(c.env, user.id, [id]),
    ]);
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
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
        'UPDATE projects SET name = ?, description = ?, show_in_all_lists = COALESCE(?, show_in_all_lists), include_in_user_memory = COALESCE(?, include_in_user_memory), auto_generate_questions = COALESCE(?, auto_generate_questions), reflection_period = COALESCE(?, reflection_period), footprints_enabled = COALESCE(?, footprints_enabled), footprint_interval = COALESCE(?, footprint_interval) WHERE id = ? AND user_id = ?',
      ).bind(
        data.name,
        data.description,
        data.show_in_all_lists === undefined ? null : Number(data.show_in_all_lists),
        data.include_in_user_memory === undefined ? null : Number(data.include_in_user_memory),
        data.auto_generate_questions === undefined ? null : Number(data.auto_generate_questions),
        data.reflection_period ?? null,
        data.footprints_enabled === undefined ? null : Number(data.footprints_enabled),
        data.footprint_interval ?? null,
        id,
        user.id,
      ),
      ...(memoryChanged ? dirtyMemoryStatements(c.env, user.id, [id]) : []),
    ]);
    if (memoryChanged || data.auto_generate_questions === true)
      c.executionCtx.waitUntil(
        observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
      );
    return c.json({ ok: true });
  });

  app.get('/api/v1/projects/:id/footprints', async (c) => {
    const { user } = c.get('principal');
    const id = c.req.param('id');
    await ownedProject(c.env, user.id, id);
    return c.json(await listFootprints(c.env, user.id, id));
  });

  app.get('/api/v1/projects/:id/footprints/:revision', async (c) => {
    const { user } = c.get('principal');
    const id = c.req.param('id');
    await ownedProject(c.env, user.id, id);
    const revision = footprintRevision(c.req.param('revision'));
    const detail = await readFootprint(c.env, user.id, id, revision);
    if (!detail) throw new HTTPException(404);
    return c.json(detail);
  });

  app.post('/api/v1/projects/:id/footprints/:revision/reanalysis', async (c) => {
    const { user } = c.get('principal');
    const id = c.req.param('id');
    await ownedProject(c.env, user.id, id);
    const revision = footprintRevision(c.req.param('revision'));
    const { generation } = await body(
      c,
      z.strictObject({ generation: z.number().int().nonnegative() }),
    );
    if (!(await startFootprintReanalysis(c.env, user.id, id, revision, generation)))
      throw new HTTPException(409);
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ generation: generation + 1 }, 202);
  });

  app.patch('/api/v1/projects/:id/footprints/:revision/publication', async (c) => {
    const { user } = c.get('principal');
    const id = c.req.param('id');
    await ownedProject(c.env, user.id, id);
    const revision = footprintRevision(c.req.param('revision'));
    const input = await body(c, footprintPublicationSchema);
    const publication = await publishFootprint(c.env, user.id, id, revision, input);
    if (!publication) throw new HTTPException(404);
    return c.json({ publication });
  });

  app.delete('/api/v1/projects/:id/footprints/:revision/publication', async (c) => {
    const { user } = c.get('principal');
    const id = c.req.param('id');
    await ownedProject(c.env, user.id, id);
    await unpublishFootprint(c.env, user.id, id, footprintRevision(c.req.param('revision')));
    return c.json({ ok: true });
  });

  app.post('/api/v1/projects/:id/footprints/backfill', async (c) => {
    const { user } = c.get('principal');
    const id = c.req.param('id');
    await ownedProject(c.env, user.id, id);
    await startFootprintBackfill(c.env, user.id, id);
    return c.json({ ok: true }, 202);
  });

  app.delete('/api/v1/projects/:id', async (c) => {
    const { user } = c.get('principal');
    await ownedProject(c.env, user.id, c.req.param('id'));
    await c.env.DB.batch([
      queueHistoryCleanup(c.env, historyPrefix(user.id, c.req.param('id'))),
      c.env.DB.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').bind(
        c.req.param('id'),
        user.id,
      ),
      ...orphanCleanupStatements(c.env, user.id),
      ...dirtyMemoryStatements(c.env, user.id, []),
    ]);
    c.executionCtx.waitUntil(
      observeOperation('background', 'cleanup_stock_images', () => cleanupStockImages(c.env)),
    );
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ ok: true });
  });
}
