import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  addPufuPhaseSchema,
  createPufuSchema,
  createSavedPufuSchema,
  pufuRelationsSchema,
  pufuTitleSchema,
  savePufuSchema,
  type PufuContext,
  type PufuPhase,
  type PufuScore,
  type PufuSummary,
} from '../../../shared/pufu';
import type { AppEnv } from '../../env';
import {
  allowedProjectIds,
  projectListFilter,
  projectScopeJson,
  resolveProjectId,
} from '../../features/projects/project-access';
import { initialPufuPhase, pufuProgressQuery, queuePufuJob } from '../../features/pufu/pufu';
import { createGeneratedPufu } from '../../features/pufu/pufu-create';
import { firstPhaseTaskColumn } from '../../features/pufu/pufu-title';
import { createSavedPufu } from '../../features/pufu/pufu-write';
import {
  normalizedQuestionIds,
  pufuRelations,
  pufuRelationsColumns,
  replaceRelations,
  validateRelations,
  withRelations,
} from '../../features/relations/relations';
import { assertOperation, reserveOperation } from '../../features/usage/usage';
import { now } from '../../infrastructure/db';
import { observeOperation } from '../../infrastructure/diagnostics';
import { dispatchJobs } from '../../infrastructure/jobs/jobs';
import { ownedProject, ownedPufu, ownedQuestion } from '../context';
import { pufuColumns } from '../queries';
import { body } from '../validation';

export function registerPufuRoutes(app: Hono<AppEnv>) {
  app.post('/api/v1/questions/:id/pufus', async (c) => {
    const question = await ownedQuestion(c);
    const data = await body(c, createPufuSchema);
    const result = await createGeneratedPufu(
      c.env,
      c.get('principal'),
      question.project_id,
      data,
      question,
    );
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ id: result.id, status: result.status }, result.created ? 202 : 200);
  });

  app.post('/api/v1/projects/:id/pufus/generate', async (c) => {
    const data = await body(c, createPufuSchema);
    const result = await createGeneratedPufu(c.env, c.get('principal'), c.req.param('id'), data);
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ id: result.id, status: result.status }, result.created ? 202 : 200);
  });

  app.post('/api/v1/pufus', async (c) => {
    const data = await body(c, createSavedPufuSchema);
    const { pufu, created } = await createSavedPufu(c.env, c.get('principal'), data);
    return c.json({ pufu }, created ? 201 : 200);
  });

  app.get('/api/v1/pufus/:id', async (c) => {
    const id = c.req.param('id');
    const userId = c.get('principal').user.id;
    // 本体・局面一覧・進捗を同じトランザクションの状態として読み取る。
    const [, rows, phases, progress] = await c.env.DB.batch([
      initialPufuPhase(c.env, id, userId),
      c.env.DB.prepare(
        `SELECT ${pufuColumns},${firstPhaseTaskColumn('pufu_scores')},score_json,input_json FROM pufu_scores WHERE id = ? AND user_id = ?`,
      ).bind(id, userId),
      c.env.DB.prepare(
        'SELECT number,score_json,created_at,updated_at FROM pufu_phases WHERE pufu_id = ? AND EXISTS (SELECT 1 FROM pufu_scores WHERE id = pufu_id AND user_id = ?) ORDER BY number',
      ).bind(id, userId),
      pufuProgressQuery(c.env, id, userId),
    ]);
    const row = rows.results[0] as
      (PufuSummary & { score_json: string | null; input_json: string }) | undefined;
    if (!row) throw new HTTPException(404, { message: 'プ譜が見つかりません。' });
    const { score_json, input_json, ...pufu } = row;
    const phaseRows = phases.results as (Omit<PufuPhase, 'score'> & { score_json: string })[];
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({
      pufu: {
        ...pufu,
        generation_progress: progress.results[0] ?? null,
        ...(await pufuRelations(c.env, id)),
        score: score_json ? (JSON.parse(score_json) as PufuScore) : null,
        phases: phaseRows.map(({ score_json, ...phase }) => ({
          ...phase,
          score: JSON.parse(score_json) as PufuScore,
        })),
        context: JSON.parse(input_json) as PufuContext,
      },
    });
  });

  app.delete('/api/v1/pufus/:id', async (c) => {
    const id = c.req.param('id');
    const userId = c.get('principal').user.id;
    const [, deleted] = await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE processing_jobs SET status='done',error=NULL,updated_at=? WHERE user_id=? AND kind='pufu' AND target_id=? AND status<>'done' AND EXISTS (SELECT 1 FROM pufu_scores pf JOIN projects p ON p.id=pf.project_id WHERE pf.id=? AND pf.user_id=? AND p.user_id=?)",
      ).bind(now(), userId, id, id, userId, userId),
      c.env.DB.prepare(
        'DELETE FROM pufu_scores WHERE id=? AND user_id=? AND EXISTS (SELECT 1 FROM projects WHERE id=pufu_scores.project_id AND user_id=?) RETURNING id',
      ).bind(id, userId, userId),
    ]);
    if (!deleted.results.length)
      throw new HTTPException(404, { message: 'プ譜が見つかりません。' });
    return c.json({ ok: true });
  });

  app.get('/api/v1/pufus', async (c) => {
    const principal = c.get('principal');
    const { user } = principal;
    const favorite = c.req.query('favorite') ?? 'false';
    if (!['true', 'false'].includes(favorite)) throw new HTTPException(400);
    const requested = c.req.query('project_id') || null;
    const projectId = resolveProjectId(principal, requested);
    if (projectId) await ownedProject(c.env, user.id, projectId);
    const page = Math.max(1, Math.min(5000, Math.trunc(Number(c.req.query('page')) || 1)));
    const joins =
      'pufu_scores pf JOIN projects p ON p.id=pf.project_id LEFT JOIN questions q ON q.id=pf.question_id';
    const projects = projectListFilter(projectId, allowedProjectIds(principal));
    const where =
      'pf.user_id=? AND p.user_id=? AND ' +
      projects.sql +
      (favorite === 'true' ? ' AND pf.is_favorite=1' : '');
    const params = [user.id, user.id, ...projects.params];
    const [rows, totals] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `SELECT ${pufuColumns
          .split(',')
          .map((column) => `pf.${column}`)
          .join(',')},
          ${firstPhaseTaskColumn('pf')},p.name AS project_name,q.text AS question_text,${pufuRelationsColumns('pf')}
          FROM ${joins} WHERE ${where} ORDER BY pf.created_at DESC,pf.id DESC LIMIT 24 OFFSET ?`,
      ).bind(...params, (page - 1) * 24),
      c.env.DB.prepare(`SELECT COUNT(*) AS count FROM ${joins} WHERE ${where}`).bind(...params),
    ]);
    return c.json({
      pufus: rows.results.map(withRelations),
      total: totals.results[0].count,
      page,
      pageSize: 24,
    });
  });

  app.patch('/api/v1/pufus/:id/title', async (c) => {
    const data = await body(c, z.strictObject({ title: pufuTitleSchema }));
    const userId = c.get('principal').user.id;
    const pufu = await c.env.DB.prepare(
      'UPDATE pufu_scores SET title=? WHERE id=? AND user_id=? AND EXISTS (SELECT 1 FROM projects WHERE id=pufu_scores.project_id AND user_id=?) RETURNING id,title',
    )
      .bind(data.title || null, c.req.param('id'), userId, userId)
      .first<Pick<PufuSummary, 'id' | 'title'>>();
    if (!pufu) throw new HTTPException(404, { message: 'プ譜が見つかりません。' });
    return c.json(pufu);
  });

  app.patch('/api/v1/pufus/:id/favorite', async (c) => {
    const data = await body(c, z.strictObject({ is_favorite: z.boolean() }));
    const userId = c.get('principal').user.id;
    const pufu = await c.env.DB.prepare(
      'UPDATE pufu_scores SET is_favorite=? WHERE id=? AND user_id=? AND EXISTS (SELECT 1 FROM projects WHERE id=pufu_scores.project_id AND user_id=?) RETURNING id,is_favorite',
    )
      .bind(Number(data.is_favorite), c.req.param('id'), userId, userId)
      .first<Pick<PufuSummary, 'id' | 'is_favorite'>>();
    if (!pufu) throw new HTTPException(404, { message: 'プ譜が見つかりません。' });
    return c.json(pufu);
  });

  async function savePufu(c: import('hono').Context<AppEnv>, append: boolean) {
    const pufu = await ownedPufu(c);
    const data = await body(c, append ? addPufuPhaseSchema : savePufuSchema);
    const currentRelations = await pufuRelations(c.env, pufu.id);
    const questionIds = normalizedQuestionIds(data, currentRelations.question_ids);
    const questionId = questionIds[0] ?? null;
    await validateRelations(
      c.env,
      pufu.project_id,
      questionIds.filter((id) => !currentRelations.question_ids.includes(id)),
      data.stock_ids ?? currentRelations.stock_ids,
    );
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
      "id = ? AND user_id = ? AND status = 'ready' AND revision = ? AND current_phase = ? AND EXISTS (SELECT 1 FROM pufu_phases WHERE pufu_id = pufu_scores.id AND number = ?) AND project_id=? AND (? IS NULL OR project_id IN (SELECT value FROM json_each(?))) AND (? IS NULL OR EXISTS (SELECT 1 FROM questions WHERE id=? AND project_id=pufu_scores.project_id))";
    const values = [
      pufu.id,
      userId,
      data.revision,
      pufu.current_phase,
      phase,
      pufu.project_id,
      projectScopeJson(c.get('principal')),
      projectScopeJson(c.get('principal')),
      questionId,
      questionId,
    ];
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
      ...replaceRelations(
        c.env,
        'pufu',
        pufu.id,
        {
          question_ids:
            data.question_ids !== undefined || data.question_id !== undefined
              ? questionIds
              : undefined,
          stock_ids: data.stock_ids,
        },
        `SELECT 1 FROM pufu_scores WHERE ${condition}`,
        values,
      ),
    );
    statements.push(
      c.env.DB.prepare(
        `UPDATE pufu_scores SET score_json = CASE WHEN current_phase = ? THEN ? ELSE score_json END, task = CASE WHEN current_phase = ? THEN ? ELSE task END, question_id=?, current_phase = current_phase + ?, revision = revision + 1, updated_at = ? WHERE ${condition} RETURNING revision,current_phase,updated_at`,
      ).bind(
        phase,
        json,
        phase,
        data.score.gainingGoal.text,
        questionId,
        append ? 1 : 0,
        timestamp,
        ...values,
      ),
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

  app.patch('/api/v1/pufus/:id/relations', async (c) => {
    const pufu = await ownedPufu(c);
    const data = await body(c, pufuRelationsSchema);
    const currentRelations = await pufuRelations(c.env, pufu.id);
    await validateRelations(
      c.env,
      pufu.project_id,
      data.question_ids.filter((id) => !currentRelations.question_ids.includes(id)),
      data.stock_ids,
    );
    const guard =
      'SELECT 1 FROM pufu_scores WHERE id=? AND user_id=? AND revision=? AND project_id=?';
    const values = [pufu.id, c.get('principal').user.id, data.revision, pufu.project_id];
    const results = await c.env.DB.batch([
      ...replaceRelations(c.env, 'pufu', pufu.id, data, guard, values),
      c.env.DB.prepare(
        `UPDATE pufu_scores SET question_id=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=? AND project_id=? RETURNING revision`,
      ).bind(data.question_ids[0] ?? null, now(), ...values),
    ]);
    const result = results.at(-1)!.results[0];
    if (!result)
      throw new HTTPException(409, {
        message: '別の画面で更新されています。再読み込みしてください。',
      });
    return c.json(result);
  });

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
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({ ok: true }, 202);
  });
}
