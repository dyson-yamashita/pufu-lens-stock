import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  reflectionDay,
  reflectionDayEnd,
  reflectionDayStart,
  reflectionRequestSchema,
  reflectionUpdateSchema,
} from '../../../shared/reflections';
import type { AppEnv, Env } from '../../env';
import {
  listReflections,
  manualReflectionJobPrefix,
  reflectionJobStatement,
  usableReflectionStock,
} from '../../features/questions/reflection-repository';
import { assertOperation, reserveOperation } from '../../features/usage/usage';
import { now } from '../../infrastructure/db';
import { observeOperation } from '../../infrastructure/diagnostics';
import { dispatchJobs } from '../../infrastructure/jobs/jobs';
import { hash } from '../../infrastructure/security';
import { ownedProject } from '../context';
import { body } from '../validation';

const reflectionBusy = 'このプロジェクトの振り返りを作成中です。完了後にお試しください。';
const reflectionChanged = '振り返りが更新されました。再読み込みしてお試しください。';
const emptyPeriod = 'この期間に振り返れるストックがありません。期間を広げてお試しください。';

function admitManualReflection(env: Env, id: string, generation: number, userId: string) {
  const jobId = `${manualReflectionJobPrefix}${id}-${generation}`;
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

  app.post('/api/v1/reflections', async (c) => {
    const { user } = c.get('principal');
    const data = await body(c, reflectionRequestSchema);
    const db = c.env.DB;
    if (data.to > reflectionDay(Date.now()))
      throw new HTTPException(400, { message: '今日までの日付を指定してください。' });
    const start = new Date(reflectionDayStart(data.from)).toISOString();
    const end = new Date(reflectionDayEnd(data.to)).toISOString();
    // WorkflowのインスタンスIDは100文字まで。所有者ごとの再送キーを固定長にする。
    const id = `manual-${await hash(JSON.stringify([user.id, data.request_id]))}`;
    await ownedProject(c.env, user.id, data.project_id);
    const sources = `SELECT 1 FROM stocks s JOIN articles a ON a.id=s.article_id
      WHERE s.project_id=?1 AND s.user_id=?2 AND s.created_at>=?3 AND s.created_at<?4
        AND ${usableReflectionStock} LIMIT 1`;
    const results = await db.batch<{
      project_id: string;
      start_at: string;
      end_at: string;
    }>([
      db
        .prepare(
          `INSERT OR IGNORE INTO reflections(id,project_id,is_weekly,start_at,end_at)
        SELECT ?5,p.id,0,?3,?4 FROM projects p WHERE p.id=?1 AND p.user_id=?2 AND EXISTS(${sources})`,
        )
        .bind(data.project_id, user.id, start, end, id),
      ...admitManualReflection(c.env, id, 1, user.id),
      db
        .prepare(
          `SELECT r.project_id,r.start_at,r.end_at FROM reflections r
        JOIN projects p ON p.id=r.project_id WHERE r.id=? AND p.user_id=?`,
        )
        .bind(id, user.id),
      db.prepare(sources).bind(data.project_id, user.id, start, end),
    ]);
    const [rows, availability] = results.slice(-2);
    const row = rows.results[0];
    if (!row)
      throw new HTTPException(availability.results.length ? 409 : 422, {
        message: availability.results.length ? reflectionBusy : emptyPeriod,
      });
    if (row.project_id !== data.project_id || row.start_at !== start || row.end_at !== end)
      throw new HTTPException(409, {
        message: '同じリクエストIDで異なる振り返りが送信されました。',
      });
    const created = Boolean(results[0].meta.changes);
    if (created)
      c.executionCtx.waitUntil(
        observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
      );
    return c.json({ id }, created ? 202 : 200);
  });

  app.patch('/api/v1/reflections/:id', async (c) => {
    const { user } = c.get('principal');
    const data = await body(c, reflectionUpdateSchema);
    const id = c.req.param('id');
    const db = c.env.DB;
    const read = db
      .prepare(
        `SELECT status,generation,answer,dismissed_at FROM reflections r
      JOIN projects p ON p.id=r.project_id WHERE r.id=? AND p.user_id=?`,
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
    const guard = `id=? AND generation=? AND answer IS NULL AND dismissed_at IS NULL
      AND EXISTS(SELECT 1 FROM projects p WHERE p.id=reflections.project_id AND p.user_id=?)`;
    const params = [id, data.generation, user.id];
    if (data.action === 'answer' || data.action === 'dismiss') {
      const update =
        data.action === 'answer'
          ? db
              .prepare(
                `UPDATE reflections SET answer=?,status='ready'
              WHERE ${guard} AND text IS NOT NULL AND status<>'queued'`,
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
    const status =
      data.action === 'retry' ? "status='failed'" : "status='ready' AND text IS NOT NULL";
    const [result] = await db.batch([
      db
        .prepare(
          `UPDATE OR IGNORE reflections SET status='queued',generation=generation+1
        WHERE ${guard} AND ${status}`,
        )
        .bind(...params),
      ...admitManualReflection(c.env, id, data.generation + 1, user.id),
    ]);
    if (!result.meta.changes) {
      throw new HTTPException(409, {
        message:
          row.status === (data.action === 'retry' ? 'failed' : 'ready')
            ? reflectionBusy
            : reflectionChanged,
      });
    }
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ ok: true }, 202);
  });
}
