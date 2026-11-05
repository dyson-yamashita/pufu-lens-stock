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
import { excerptParts, excerptSeparator, snapshotStocks } from './pufu-context';
import { validateRelations } from './relations';

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
  const questionIds = [
    ...new Set([...(data.question_ids ?? []), ...(question ? [question.id] : [])]),
  ].sort();
  const explicitStockIds = data.stock_ids ?? [];
  const requestInput = JSON.stringify({
    project_id: project.id,
    question_id: question?.id ?? null,
    question_ids: questionIds,
    stock_ids: explicitStockIds,
    title: data.title ?? '',
    task: data.task,
    details: data.details ?? '',
  });
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
    const request = row.request_json ? JSON.parse(row.request_json) : null;
    const matches = request
      ? request.kind === 'generated' && request.input === requestInput
      : row.project_id === project.id &&
        row.question_id === (question?.id ?? null) &&
        context.task === data.task &&
        (context.title ?? '') === (data.title ?? '') &&
        (context.details ?? '') === (data.details ?? '') &&
        data.question_ids === undefined &&
        data.stock_ids === undefined;
    if (!matches)
      throw new HTTPException(409, { message: '同じリクエストIDで異なる内容が送信されました。' });
    return { id, status: row.status, created };
  };
  const previous = await load();
  if (previous) return response(previous, false);
  if (question && (question.status !== 'ready' || !question.text))
    throw new HTTPException(409, {
      message: '問い・気づきの生成が完了してから、プ譜を作成できます。',
    });
  if (questionIds.length > 1)
    throw new HTTPException(400, {
      message: 'プ譜に紐付ける問い・気づきとストックは、それぞれ1件までです。',
    });
  await validateRelations(env, project.id, questionIds, explicitStockIds);
  if (!data.task && !questionIds.length && !explicitStockIds.length)
    throw new HTTPException(400, {
      message: '獲得目標を入力するか、参照する問い・気づきまたはストックを選択してください。',
    });
  const [questionRows, stockRows, memoryRows] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      "SELECT id,text,source FROM questions WHERE project_id=? AND status='ready' AND id IN (SELECT value FROM json_each(?)) ORDER BY id",
    ).bind(project.id, JSON.stringify(questionIds)),
    env.DB.prepare(
      `SELECT s.id,COALESCE(s.title,a.title) title,s.note,a.summary_json,a.content_key,a.input_text
       FROM stocks s JOIN articles a ON a.id=s.article_id
       WHERE s.user_id=? AND a.user_id=? AND s.project_id=? AND (
         s.id IN (SELECT value FROM json_each(?)) OR (?=0 AND s.id IN (
           SELECT stock_id FROM question_stocks WHERE question_id IN (SELECT value FROM json_each(?))
         ))) ORDER BY s.id LIMIT 2`,
    ).bind(
      principal.user.id,
      principal.user.id,
      project.id,
      JSON.stringify(explicitStockIds),
      explicitStockIds.length,
      JSON.stringify(questionIds),
    ),
    env.DB.prepare(
      'SELECT id,project_id,revision,text,data_json,updated_at FROM memories WHERE user_id = ? AND (project_id IS NULL OR project_id = ?)',
    ).bind(principal.user.id, project.id),
  ]);
  // 上限超過は、不足して見える明示選択の検証より先に判定する。
  if (stockRows.results.length > 1)
    throw new HTTPException(400, {
      message: '問いに複数のストックが紐付いています。参照するストックを1件選択してください。',
    });
  if (
    questionRows.results.length !== questionIds.length ||
    explicitStockIds.some((id) => !stockRows.results.some((row) => row.id === id))
  )
    throw new HTTPException(409, { message: '保存先が変更されました。開き直してお試しください。' });
  const stocks: NonNullable<PufuContext['stock']>[] = [];
  for (const row of stockRows.results) {
    const object = row.content_key
      ? await env.CONTENT.get(String(row.content_key), { range: { offset: 0, length: 480000 } })
      : null;
    const content = object ? await object.text() : row.input_text ? String(row.input_text) : null;
    stocks.push({
      id: String(row.id),
      title: String(row.title),
      note: String(row.note),
      summary: row.summary_json ? JSON.parse(String(row.summary_json)) : null,
      content: content ? excerptParts(content, 20000).join(excerptSeparator) : null,
      contentIncomplete: object?.customMetadata?.complete === 'false',
      contentExcerpted: (content?.length ?? 0) > 20000 || Boolean(object && object.size > 480000),
    });
  }
  const questions = questionRows.results as NonNullable<PufuContext['questions']>;
  const stockIds = stocks.map((stock) => stock.id);
  const requestJson = JSON.stringify({
    kind: 'generated',
    input: requestInput,
    question_ids: questionIds,
    stock_ids: stockIds,
  });
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
    question: questions[0] ?? null,
    questions,
    title: data.title ?? '',
    task: data.task,
    details: data.details ?? '',
    project,
    stock: stocks[0] ? snapshotStocks([stocks[0]])[0] : null,
    stocks: snapshotStocks(stocks),
    userMemory: snapshot(null),
    projectMemory: snapshot(project.id),
  };
  const jobId = `pufu-job-${id}-1`;
  const guard = {
    sql: 'EXISTS (SELECT 1 FROM pufu_scores WHERE id=? AND user_id=?)',
    params: [id, principal.user.id],
  };
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO pufu_scores (id,user_id,project_id,question_id,title,task,input_json,editor_version,request_json)
       SELECT ?,user_id,id,?,?,?,?,?,? FROM projects WHERE id=? AND user_id=?
       AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))
       AND (SELECT COUNT(*) FROM questions WHERE id IN (SELECT value FROM json_each(?)) AND project_id=projects.id AND status='ready')=?
       AND (SELECT COUNT(*) FROM stocks WHERE id IN (SELECT value FROM json_each(?)) AND project_id=projects.id AND user_id=projects.user_id)=?`,
    ).bind(
      id,
      questionIds[0] ?? null,
      data.title || null,
      data.task,
      JSON.stringify(context),
      pufuEditorVersion,
      requestJson,
      project.id,
      principal.user.id,
      projectScopeJson(principal),
      projectScopeJson(principal),
      JSON.stringify(questionIds),
      questionIds.length,
      JSON.stringify(stockIds),
      stockIds.length,
    ),
    // 作成・利用枠確保は同じトランザクション。参照の競合で未作成なら枠も取らない。
    reserveOperation(env, { id: jobId, user_id: principal.user.id, kind: 'pufu' }, guard),
    assertOperation(env, jobId, guard),
    queuePufuJob(env, id),
  ]);
  const saved = await load();
  if (!saved)
    throw new HTTPException(409, { message: '保存先が変更されました。開き直してお試しください。' });
  return response(saved, !!results[0].meta.changes);
}
