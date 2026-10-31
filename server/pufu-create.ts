import { projectScopeJson } from './project-access';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import type { Question } from '../shared/domain';
import {
  createPufuSchema,
  pufuEditorVersion,
  type MemorySnapshot,
  type PufuContext,
  type PufuSummary,
} from '../shared/pufu';
import type { Env, Principal } from './env';
import { reserveOperation, assertOperation } from './usage';
import { queuePufuJob } from './pufu';
import { snapshotStocks } from './pufu-context';

export async function createGeneratedPufu(
  env: Env,
  principal: Principal,
  projectId: string,
  data: z.infer<typeof createPufuSchema>,
  question?: Question,
) {
  const project = await env.DB.prepare(
    'SELECT id,name,description FROM projects WHERE id=? AND user_id=? AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))',
  )
    .bind(projectId, principal.user.id, projectScopeJson(principal), projectScopeJson(principal))
    .first<PufuContext['project']>();
  if (!project) throw new HTTPException(404, { message: 'プロジェクトが見つかりません。' });
  const id = `pufu-${principal.user.id}-${data.request_id}`;
  const load = () =>
    env.DB.prepare(
      'SELECT id,question_id,project_id,task,status,input_json,request_json FROM pufu_scores WHERE id=? AND user_id=?',
    )
      .bind(id, principal.user.id)
      .first<
        Pick<PufuSummary, 'id' | 'question_id' | 'project_id' | 'task' | 'status'> & {
          input_json: string;
          request_json: string | null;
        }
      >();
  const response = (row: NonNullable<Awaited<ReturnType<typeof load>>>, created: boolean) => {
    const context = JSON.parse(row.input_json) as PufuContext;
    if (
      row.project_id !== project.id ||
      row.question_id !== (question?.id ?? null) ||
      row.task !== data.task ||
      (context.title ?? '') !== (data.title ?? '') ||
      (context.details ?? '') !== (data.details ?? '') ||
      row.request_json !== null
    )
      throw new HTTPException(409, { message: '同じリクエストIDで異なる内容が送信されました。' });
    return { id, status: row.status, created };
  };
  const previous = await load();
  if (previous) return response(previous, false);
  if (question && (question.status !== 'ready' || !question.text))
    throw new HTTPException(409, {
      message: '問い・気づきの生成が完了してから、プ譜を作成できます。',
    });
  const [stockRows, memoryRows] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      'SELECT s.id,COALESCE(s.title,a.title) title,s.note,a.summary_json FROM question_stocks qs JOIN stocks s ON s.id=qs.stock_id JOIN articles a ON a.id=s.article_id WHERE qs.question_id=? AND s.user_id=? AND s.project_id=? ORDER BY s.id',
    ).bind(question?.id ?? null, principal.user.id, project.id),
    env.DB.prepare(
      'SELECT id,project_id,revision,text,data_json,updated_at FROM memories WHERE user_id = ? AND (project_id IS NULL OR project_id = ?)',
    ).bind(principal.user.id, project.id),
  ]);
  const stock = stockRows.results[0];
  const snapshot = (memoryProjectId: string | null): MemorySnapshot | null => {
    const row = memoryRows.results.find((item) => item.project_id === memoryProjectId);
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
    question: question ? { id: question.id, text: question.text!, source: question.source } : null,
    title: data.title ?? '',
    task: data.task,
    details: data.details ?? '',
    project,
    stock: stock
      ? {
          id: String(stock.id),
          title: String(stock.title),
          summary: stock.summary_json ? JSON.parse(String(stock.summary_json)) : null,
          note: String(stock.note),
        }
      : null,
    stocks: snapshotStocks(
      stockRows.results.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        summary: row.summary_json ? JSON.parse(String(row.summary_json)) : null,
        note: String(row.note),
      })),
    ),
    userMemory: snapshot(null),
    projectMemory: snapshot(project.id),
  };
  const jobId = `pufu-job-${id}-1`;
  const results = await env.DB.batch([
    reserveOperation(env, { id: jobId, user_id: principal.user.id, kind: 'pufu' }),
    assertOperation(env, jobId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO pufu_scores (id,user_id,project_id,question_id,title,task,input_json,editor_version)
       SELECT ?,user_id,id,?,?,?,?,? FROM projects WHERE id=? AND user_id=?
       AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))
       AND (? IS NULL OR EXISTS (SELECT 1 FROM questions WHERE id=? AND project_id=projects.id AND status='ready'))`,
    ).bind(
      id,
      question?.id ?? null,
      data.title || null,
      data.task,
      JSON.stringify(context),
      pufuEditorVersion,
      project.id,
      principal.user.id,
      projectScopeJson(principal),
      projectScopeJson(principal),
      question?.id ?? null,
      question?.id ?? null,
    ),
    queuePufuJob(env, id),
  ]);
  const saved = await load();
  if (!saved)
    throw new HTTPException(409, { message: '保存先が変更されました。開き直してお試しください。' });
  return response(saved, !!results[2].meta.changes);
}
