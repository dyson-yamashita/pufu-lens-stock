import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { reflectionUpdateSchema } from '../../../shared/reflections';
import type { AppEnv, Env } from '../../env';
import {
  listReflections,
  reflectionJobStatement,
  reflectionRegenerationJobPrefix,
} from '../../features/questions/reflection-repository';
import { assertOperation, reserveOperation } from '../../features/usage/usage';
import { now } from '../../infrastructure/db';
import { observeOperation } from '../../infrastructure/diagnostics';
import { dispatchJobs } from '../../infrastructure/jobs/jobs';
import { ownedProject } from '../context';
import { body } from '../validation';

const reflectionBusy = 'このプロジェクトの振り返りを作成中です。完了後にお試しください。';
const reflectionChanged = '振り返りが更新されました。再読み込みしてお試しください。';

function admitRegeneration(env: Env, id: string, generation: number, userId: string) {
  const jobId = `${reflectionRegenerationJobPrefix}${id}-${generation}`;
  const guard = {
    sql: "EXISTS (SELECT 1 FROM processing_jobs WHERE id=? AND user_id=? AND status='pending')",
    params: [jobId, userId],
  };
  return [
    reflectionJobStatement(env, id),
    reserveOperation(env, { id: jobId, user_id: userId, kind: 'question' }, guard),
    assertOperation(env, jobId, guard),
  ];
}

export function registerReflectionRoutes(app: Hono<AppEnv>) {
  app.get('/api/v1/reflections', async (c) => {
    const { user } = c.get('principal');
    const projectId = c.req.query('project_id') || null;
    if (projectId) await ownedProject(c.env, user.id, projectId);
    const page = Math.max(1, Math.min(5000, Math.trunc(Number(c.req.query('page')) || 1)));
    return c.json(await listReflections(c.env, user.id, projectId, page));
  });

  app.patch('/api/v1/reflections/:id', async (c) => {
    const { user } = c.get('principal');
    const data = await body(c, reflectionUpdateSchema);
    const id = c.req.param('id');
    const db = c.env.DB;
    const read = db
      .prepare(
        `SELECT status,generation,answer,dismissed_at FROM reflections r
      JOIN projects p ON p.id=r.project_id WHERE r.id=? AND p.user_id=? AND r.text IS NOT NULL`,
      )
      .bind(id, user.id);
    const row = await read.first<{
      status: string;
      generation: number;
      answer: string | null;
      dismissed_at: string | null;
    }>();
    if (!row) throw new HTTPException(404);
    if (row.generation !== data.generation)
      throw new HTTPException(409, { message: reflectionChanged });
    if (
      (data.action === 'answer' && row.answer === data.answer) ||
      (data.action === 'dismiss' && row.dismissed_at)
    )
      return c.json({ ok: true });
    if (row.answer || row.dismissed_at || row.status === 'queued')
      throw new HTTPException(409, { message: reflectionChanged });
    const guard = `id=? AND generation=? AND text IS NOT NULL AND answer IS NULL AND dismissed_at IS NULL
      AND EXISTS(SELECT 1 FROM projects p WHERE p.id=reflections.project_id AND p.user_id=?)`;
    const params = [id, data.generation, user.id];
    if (data.action === 'answer' || data.action === 'dismiss') {
      const update =
        data.action === 'answer'
          ? db
              .prepare(
                `UPDATE reflections SET answer=?,status='ready'
              WHERE ${guard} AND status<>'queued'`,
              )
              .bind(data.answer, ...params)
          : db
              .prepare(
                `UPDATE reflections SET dismissed_at=?
              WHERE ${guard} AND status<>'queued'`,
              )
              .bind(now(), ...params);
      if (!(await update.run()).meta.changes)
        throw new HTTPException(409, { message: reflectionChanged });
      return c.json({ ok: true });
    }
    const status = data.action === 'retry' ? 'failed' : 'ready';
    const [result] = await db.batch([
      db
        .prepare(
          `UPDATE OR IGNORE reflections SET status='queued',generation=generation+1
        WHERE ${guard} AND status=?`,
        )
        .bind(...params, status),
      ...admitRegeneration(c.env, id, data.generation + 1, user.id),
    ]);
    if (!result.meta.changes) {
      throw new HTTPException(409, {
        message: row.status === status ? reflectionBusy : reflectionChanged,
      });
    }
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ ok: true }, 202);
  });
}
