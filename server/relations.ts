import { HTTPException } from 'hono/http-exception';
import type { Env } from './env';
import type { PufuRelations, RelatedQuestion, RelatedStock } from '../shared/relations';

export const stockRelationsColumn = (alias: string) =>
  `(SELECT json_group_array(json_object('id',s.id,'title',COALESCE(s.title,a.title))) FROM question_stocks qs JOIN stocks s ON s.id=qs.stock_id JOIN articles a ON a.id=s.article_id WHERE qs.question_id=${alias}.id ORDER BY s.id) AS stocks_json`;
export const pufuRelationsColumns = (
  alias: string,
) => `(SELECT json_group_array(json_object('id',q.id,'text',q.text,'source',q.source)) FROM pufu_questions pq JOIN questions q ON q.id=pq.question_id WHERE pq.pufu_id=${alias}.id ORDER BY q.id) AS questions_json,
(SELECT json_group_array(json_object('id',s.id,'title',COALESCE(s.title,a.title))) FROM pufu_stocks ps JOIN stocks s ON s.id=ps.stock_id JOIN articles a ON a.id=s.article_id WHERE ps.pufu_id=${alias}.id ORDER BY s.id) AS stocks_json`;
export function withRelations<T extends object>(row: T) {
  const { questions_json, stocks_json, ...rest } = row as T & {
    questions_json?: string;
    stocks_json?: string;
  };
  const stocks = JSON.parse(String(stocks_json ?? '[]')) as RelatedStock[];
  const questions = JSON.parse(String(questions_json ?? '[]')) as RelatedQuestion[];
  return {
    ...rest,
    stocks,
    stock_ids: stocks.map((s) => s.id),
    ...(questions_json === undefined
      ? {}
      : { questions, question_ids: questions.map((q) => q.id) }),
  };
}
export async function pufuRelations(env: Env, id: string): Promise<Required<PufuRelations>> {
  const row = await env.DB.prepare(
    `SELECT ${pufuRelationsColumns('pf')} FROM pufu_scores pf WHERE pf.id=?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  const parsed = withRelations(row ?? {});
  return {
    stocks: parsed.stocks,
    stock_ids: parsed.stock_ids,
    questions: parsed.questions ?? [],
    question_ids: parsed.question_ids ?? [],
  };
}
export async function validateRelations(
  env: Env,
  projectId: string,
  questionIds: string[],
  stockIds: string[],
) {
  for (const [table, ids] of [
    ['questions', questionIds],
    ['stocks', stockIds],
  ] as const) {
    if (!ids.length) continue;
    const row = await env.DB.prepare(
      `SELECT COUNT(*) n FROM ${table} WHERE project_id=? AND id IN (SELECT value FROM json_each(?))${table === 'questions' ? " AND status='ready' AND text IS NOT NULL" : ''}`,
    )
      .bind(projectId, JSON.stringify(ids))
      .first<{ n: number }>();
    if (row?.n !== ids.length)
      throw new HTTPException(404, {
        message: '紐づける問い・気づき、またはストックが見つかりません。',
      });
  }
}
export function replaceRelations(
  env: Env,
  kind: 'question' | 'pufu',
  id: string,
  fields: { question_ids?: string[]; stock_ids?: string[] },
  guard: string,
  values: (string | number | null)[],
) {
  const statements: D1PreparedStatement[] = [];
  for (const [field, table, target] of (kind === 'pufu'
    ? [
        ['question_ids', 'pufu_questions', 'question_id'],
        ['stock_ids', 'pufu_stocks', 'stock_id'],
      ]
    : [['stock_ids', 'question_stocks', 'stock_id']]) as [keyof typeof fields, string, string][]) {
    const ids = fields[field];
    if (ids === undefined) continue;
    const parent = kind === 'pufu' ? 'pufu_id' : 'question_id';
    statements.push(
      env.DB.prepare(`DELETE FROM ${table} WHERE ${parent}=? AND EXISTS(${guard})`).bind(
        id,
        ...values,
      ),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO ${table}(${parent},${target}) SELECT ?,value FROM json_each(?) WHERE EXISTS(${guard})`,
      ).bind(id, JSON.stringify(ids), ...values),
    );
  }
  return statements;
}
export function normalizedQuestionIds(
  data: { question_ids?: string[]; question_id?: string | null },
  fallback: string[] = [],
) {
  if (data.question_ids !== undefined && data.question_id !== undefined)
    throw new HTTPException(400, { message: 'question_idとquestion_idsは同時に指定できません。' });
  return (
    data.question_ids ??
    (data.question_id === undefined
      ? fallback
      : data.question_id === null
        ? []
        : [data.question_id])
  );
}
