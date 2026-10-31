import { projectScopeJson } from './project-access';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import { createSavedPufuSchema, pufuEditorVersion, type PufuContext } from '../shared/pufu';
import type { Env, Principal } from './env';
import { now } from './db';
import { normalizedQuestionIds, validateRelations } from './relations';

export async function createSavedPufu(
  env: Env,
  principal: Principal,
  data: z.infer<typeof createSavedPufuSchema>,
) {
  const project = await env.DB.prepare(
    'SELECT id,name,description FROM projects WHERE id=? AND user_id=? AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))',
  )
    .bind(
      data.project_id,
      principal.user.id,
      projectScopeJson(principal),
      projectScopeJson(principal),
    )
    .first<{ id: string; name: string; description: string }>();
  if (!project) throw new HTTPException(404, { message: 'プロジェクトが見つかりません。' });
  const id = `pufu-${principal.user.id}-${data.request_id}`;
  const questionIds = normalizedQuestionIds(data);
  const stockIds = data.stock_ids ?? [];
  const questionId = questionIds[0] ?? null;
  const requestJson = JSON.stringify({
    project_id: project.id,
    ...(data.question_ids === undefined && data.stock_ids === undefined
      ? { question_id: questionId }
      : { question_ids: questionIds, stock_ids: stockIds }),
    score: data.score,
  });
  const load = () =>
    env.DB.prepare(
      'SELECT id,project_id,question_id,task,status,revision,current_phase,request_json FROM pufu_scores WHERE id=? AND user_id=?',
    )
      .bind(id, principal.user.id)
      .first<{
        id: string;
        project_id: string;
        question_id: string | null;
        task: string;
        status: string;
        revision: number;
        current_phase: number;
        request_json: string | null;
      }>();
  const response = (row: NonNullable<Awaited<ReturnType<typeof load>>>, created: boolean) => {
    const { request_json, ...pufu } = row;
    if (row.project_id !== project.id || request_json !== requestJson)
      throw new HTTPException(409, { message: '同じリクエストIDで異なるプ譜が送信されました。' });
    return {
      pufu: { ...pufu, task: data.score.gainingGoal.text, question_id: questionId },
      created,
    };
  };
  const previous = await load();
  if (previous) return response(previous, false);
  await validateRelations(env, project.id, questionIds, stockIds);
  const question =
    questionId === null
      ? null
      : await env.DB.prepare(
          "SELECT id,text,source FROM questions WHERE id=? AND project_id=? AND status='ready' AND text IS NOT NULL",
        )
          .bind(questionId, project.id)
          .first<NonNullable<PufuContext['question']>>();
  if (questionId !== null && !question)
    throw new HTTPException(404, { message: '紐付け先の問い・気づきが見つかりません。' });
  const task = data.score.gainingGoal.text;
  const context: PufuContext = {
    question,
    project,
    task,
    stock: null,
    userMemory: null,
    projectMemory: null,
  };
  const json = JSON.stringify(data.score);
  const timestamp = now();
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO pufu_scores
      (id,user_id,project_id,question_id,task,input_json,score_json,editor_version,status,request_json,created_at,updated_at)
      SELECT ?,user_id,id,?,?,?,?,?,'ready',?,?,? FROM projects
      WHERE id=? AND user_id=? AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))
      AND (? IS NULL OR EXISTS (SELECT 1 FROM questions WHERE id=? AND project_id=projects.id AND status='ready'))`,
    ).bind(
      id,
      questionId,
      task,
      JSON.stringify(context),
      json,
      pufuEditorVersion,
      requestJson,
      timestamp,
      timestamp,
      project.id,
      principal.user.id,
      projectScopeJson(principal),
      projectScopeJson(principal),
      questionId,
      questionId,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at)
      SELECT id,1,score_json,created_at,updated_at FROM pufu_scores WHERE id=? AND user_id=? AND request_json=?`,
    ).bind(id, principal.user.id, requestJson),
  ]);
  const saved = await load();
  if (!saved)
    throw new HTTPException(409, { message: '保存先が変更されました。再取得してください。' });
  return response(saved, !!results[0].meta.changes);
}
