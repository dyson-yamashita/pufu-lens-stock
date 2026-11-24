import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  stockListOptionsSchema,
  userQuestionSchema,
  type Question,
  type QuestionDetail,
} from '../../../shared/domain';
import type { AppEnv } from '../../env';
import {
  allowedProjectIds,
  canAccessProject,
  projectListFilter,
  resolveProjectId,
} from '../../features/projects/project-access';
import {
  includesReflectionCards,
  ownedReflectionCard,
  reflectionIdForQuestion,
  reflectionQuestionIdPrefix,
} from '../../features/questions/reflection-repository';
import { validateRelations, withRelations } from '../../features/relations/relations';
import { now } from '../../infrastructure/db';
import { observeOperation } from '../../infrastructure/diagnostics';
import { dispatchJobs } from '../../infrastructure/jobs/jobs';
import { ownedProject } from '../context';
import {
  questionCardColumns,
  questionCardJoins,
  questionColumns,
  questionJoins,
  reflectionCardStocks,
} from '../queries';
import { body } from '../validation';

export function registerQuestionCollectionRoutes(app: Hono<AppEnv>) {
  app.get('/api/v1/questions', async (c) => {
    const principal = c.get('principal');
    const { user } = principal;
    const limit = stockListOptionsSchema.shape.limit.safeParse(
      c.req.query('limit') === undefined ? undefined : Number(c.req.query('limit')),
    );
    if (!limit.success) throw new HTTPException(400, { message: '取得件数を確認してください。' });
    const pageSize = limit.data;
    const projectId = resolveProjectId(principal, c.req.query('project_id') || null);
    if (projectId) await ownedProject(c.env, user.id, projectId);
    const query = (c.req.query('q') ?? '').slice(0, 200);
    const status = c.req.query('status') ?? 'all';
    if (!['all', 'ready', 'processing', 'failed'].includes(status)) throw new HTTPException(400);
    const source = c.req.query('source') ?? 'all';
    if (!['all', 'ai', 'user'].includes(source)) throw new HTTPException(400);
    const favorite = c.req.query('favorite') ?? 'false';
    if (!['true', 'false'].includes(favorite)) throw new HTTPException(400);
    const page = Math.max(1, Math.min(5000, Math.trunc(Number(c.req.query('page')) || 1)));
    const projects = projectListFilter(projectId, allowedProjectIds(principal));
    const includeReflections = includesReflectionCards(
      principal,
      c.req.query('include_reflections'),
    );
    const columns = includeReflections ? questionCardColumns : questionColumns;
    const joins = includeReflections ? questionCardJoins : questionJoins;
    const projectScope = `p.user_id=? AND ${projects.sql}`;
    const cardProjects = includeReflections
      ? `WITH question_card_projects AS (SELECT p.id FROM projects p WHERE ${projectScope})`
      : '';
    // D1のLIKEパターン上限にかからないよう、部分文字列を直接照合する。
    const matches = (field: string) => `instr(lower(${field}),lower(?))>0`;
    const reflectionSearch = includeReflections
      ? `OR EXISTS (SELECT 1 ${reflectionCardStocks}
        WHERE ${matches('COALESCE(rs.title,ra.title)')} OR ${matches('rs.note')})`
      : '';
    const where = `${includeReflections ? '' : `${projectScope} AND `}
      (${matches("COALESCE(q.text,'')")} OR ${matches("COALESCE(s.title,a.title,'')")}
        OR ${matches("COALESCE(s.note,'')")} ${reflectionSearch})
      AND (?='all' OR (?='processing' AND q.status IN ('queued','generating')) OR q.status=?)
      AND (?='all' OR q.source=?)${favorite === 'true' ? ' AND q.is_favorite=1' : ''}`;
    const params = [
      user.id,
      ...projects.params,
      query,
      query,
      query,
      ...(includeReflections ? [query, query] : []),
      status,
      status,
      status,
      source,
      source,
    ];
    const [rows, totals] = await observeOperation('d1', 'questions_list', () =>
      c.env.DB.batch<Record<string, unknown>>([
        c.env.DB.prepare(
          `${cardProjects} SELECT ${columns} FROM ${joins} WHERE ${where} ORDER BY q.created_at DESC, q.id DESC LIMIT ? OFFSET ?`,
        ).bind(...params, pageSize, (page - 1) * pageSize),
        c.env.DB.prepare(
          `${cardProjects} SELECT COUNT(*) AS count FROM ${joins} WHERE ${where}`,
        ).bind(...params),
      ]),
    );
    c.executionCtx.waitUntil(
      observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
    );
    return c.json({
      questions: rows.results.map(withRelations),
      total: totals.results[0].count,
      page,
      pageSize,
    });
  });

  app.post('/api/v1/questions', async (c) => {
    const principal = c.get('principal');
    const { user } = principal;
    const data = await body(c, userQuestionSchema);
    const stockIds = data.stock_ids ?? (data.stock_id ? [data.stock_id] : []);
    const stockId = stockIds[0] ?? null;
    const id = `user-${user.id}-${data.request_id ?? crypto.randomUUID()}`;
    const requestJson = (projectId: string) =>
      JSON.stringify({
        project_id: projectId,
        stock_ids: stockIds,
        text: data.text,
        note: data.note,
      });
    const load = () =>
      c.env.DB.prepare(
        `SELECT ${questionColumns},q.note,q.request_json FROM ${questionJoins} WHERE q.id=? AND p.user_id=?`,
      )
        .bind(id, user.id)
        .first<QuestionDetail & { request_json: string | null }>();
    const respond = (
      row: NonNullable<Awaited<ReturnType<typeof load>>>,
      projectId: string,
      created: boolean,
    ) => {
      if (!canAccessProject(principal, row.project_id)) throw new HTTPException(404);
      if (row.request_json !== requestJson(projectId))
        throw new HTTPException(409, {
          message: '同じリクエストIDで異なる問い・気づきが送信されました。',
        });
      const { request_json, ...question } = row;
      void request_json;
      return c.json({ question: withRelations(question) }, created ? 201 : 200);
    };
    // 成功した作成の再送は、関連先が後で削除されても同じ問いへ到達できる。
    const previous = await load();
    if (previous) {
      const original = previous.request_json
        ? (JSON.parse(previous.request_json) as { project_id: string })
        : null;
      return respond(
        previous,
        data.project_id ?? original?.project_id ?? previous.project_id,
        false,
      );
    }
    const stock = stockId
      ? await c.env.DB.prepare('SELECT project_id FROM stocks WHERE id=? AND user_id=?')
          .bind(stockId, user.id)
          .first<{ project_id: string }>()
      : null;
    if (stockId && !stock)
      throw new HTTPException(404, { message: '紐づけるストックが見つかりません。' });
    if (stock && data.project_id && stock.project_id !== data.project_id)
      throw new HTTPException(400, { message: 'ストックとプロジェクトが一致しません。' });
    const projectId = data.project_id ?? stock!.project_id;
    if (!canAccessProject(principal, projectId)) throw new HTTPException(404);
    await ownedProject(c.env, user.id, projectId);
    await validateRelations(c.env, projectId, [], stockIds);
    const result = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO questions(id,project_id,stock_id,text,note,source,status,request_json) SELECT ?,id,?,?,?,'user','ready',? FROM projects WHERE id=? AND user_id=?",
    )
      .bind(id, stockId, data.text, data.note, requestJson(projectId), projectId, user.id)
      .run();
    const row = await load();
    if (!row) throw new HTTPException(404, { message: '紐づけるストックが見つかりません。' });
    return respond(row, projectId, !!result.meta.changes);
  });

  app.patch('/api/v1/questions/:id/favorite', async (c) => {
    const data = await body(c, z.strictObject({ is_favorite: z.boolean() }));
    const principal = c.get('principal');
    const id = c.req.param('id');
    const reflectionId = reflectionIdForQuestion(principal, id);
    const value = Number(data.is_favorite);
    const question = await (
      reflectionId === null
        ? c.env.DB.prepare(
            'UPDATE questions SET is_favorite = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM projects WHERE id = questions.project_id AND user_id = ?) RETURNING id, is_favorite',
          ).bind(value, now(), id, principal.user.id)
        : c.env.DB.prepare(
            `UPDATE reflections SET is_favorite=? WHERE ${ownedReflectionCard}
          RETURNING '${reflectionQuestionIdPrefix}'||id AS id,is_favorite`,
          ).bind(value, reflectionId, principal.user.id)
    ).first<Pick<Question, 'id' | 'is_favorite'>>();
    if (!question) throw new HTTPException(404, { message: '問い・気づきが見つかりません。' });
    return c.json(question);
  });
}
