import { projectScopeJson } from './project-access';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import type {
  addCommentSchema,
  CommentTarget,
  EntityComment,
  listCommentsSchema,
} from '../shared/comments';
import type { Env, Principal } from './env';

// 同じ条件を参照とINSERTに利用し、認可後に対象が削除・移動されても孤立した記録を作らない。
function targetQuery(principal: Principal, target: CommentTarget) {
  const sources = {
    stock: 'stocks t JOIN projects p ON p.id = t.project_id',
    question: 'questions t JOIN projects p ON p.id = t.project_id',
    pufu: 'pufu_scores t JOIN projects p ON p.id = t.project_id',
  };
  return {
    sql: `SELECT 1 FROM ${sources[target.target_type]} WHERE t.id = ? AND p.user_id = ? AND (? IS NULL OR p.id IN (SELECT value FROM json_each(?)))${target.target_type === 'pufu' ? ' AND t.user_id = p.user_id AND EXISTS (SELECT 1 FROM pufu_phases ph WHERE ph.pufu_id = t.id AND ph.number = ?)' : ''}`,
    values: [
      target.target_id,
      principal.user.id,
      projectScopeJson(principal),
      projectScopeJson(principal),
      ...(target.target_type === 'pufu' ? [target.phase!] : []),
    ],
  };
}
async function ownedTarget(env: Env, principal: Principal, target: CommentTarget) {
  const query = targetQuery(principal, target);
  if (
    !(await env.DB.prepare(query.sql)
      .bind(...query.values)
      .first())
  )
    throw new HTTPException(404, { message: 'コメントの対象が見つかりません。' });
  return query;
}
const columns =
  'c.id,c.target_type,c.target_id,c.phase,c.body,c.author_id,u.name AS author_name,c.author_kind,c.created_at';
type CommentRow = Omit<EntityComment, 'phase'> & { phase: number | null };
function comment(row: CommentRow): EntityComment {
  const { phase, ...rest } = row;
  return { ...rest, ...(phase === null ? {} : { phase }) };
}
export async function listComments(
  env: Env,
  principal: Principal,
  input: z.infer<typeof listCommentsSchema>,
) {
  const query = await ownedTarget(env, principal, input);
  const rows = await env.DB.prepare(
    `SELECT ${columns} FROM comments c JOIN users u ON u.id = c.author_id WHERE c.target_type = ? AND c.target_id = ? AND c.phase IS ? AND EXISTS (${query.sql}) ORDER BY c.created_at,c.id LIMIT 51 OFFSET ?`,
  )
    .bind(
      input.target_type,
      input.target_id,
      input.phase ?? null,
      ...query.values,
      (input.page - 1) * 50,
    )
    .all<CommentRow>();
  return { comments: rows.results.slice(0, 50).map(comment), has_more: rows.results.length > 50 };
}
export async function addComment(
  env: Env,
  principal: Principal,
  input: z.infer<typeof addCommentSchema>,
) {
  const query = await ownedTarget(env, principal, input);
  const id = `comment-${principal.user.id}-${input.request_id}`;
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO comments(id,target_type,target_id,phase,body,author_id,author_kind) SELECT ?,?,?,?,?,?,? WHERE EXISTS (${query.sql})`,
  )
    .bind(
      id,
      input.target_type,
      input.target_id,
      input.phase ?? null,
      input.body,
      principal.user.id,
      principal.kind === 'mcp' ? 'agent' : 'user',
      ...query.values,
    )
    .run();
  const row = await env.DB.prepare(
    `SELECT ${columns} FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ? AND c.author_id = ?`,
  )
    .bind(id, principal.user.id)
    .first<CommentRow>();
  if (!row) throw new HTTPException(404, { message: 'コメントの対象が見つかりません。' });
  if (
    row.target_type !== input.target_type ||
    row.target_id !== input.target_id ||
    row.phase !== (input.phase ?? null) ||
    row.body !== input.body
  )
    throw new HTTPException(409, { message: '同じリクエストIDで異なるコメントが送信されました。' });
  return { comment: comment(row), created: Boolean(result.meta.changes) };
}
