import type { MemoryData, MemoryCoverage } from '../shared/domain';
import type { Source } from './ai';
import type { Env } from './env';
import { hash } from './security';

export type MemoryContext = { name: string; description: string; scope: string };
export type MemoryInput = { source: Source; hash: string };
export const memoryId = (userId: string, projectId: string | null) =>
  projectId ? `project-${projectId}` : `user-${userId}`;

export async function memoryInputPage(
  env: Env,
  userId: string,
  projectId: string | null,
  page: number,
): Promise<MemoryInput[]> {
  const rows = await env.DB.prepare(
    `SELECT a.id, a.title, a.summary_json,
      json_group_array(json_object('projectId',p.id,'name',p.name,'note',s.note,'savedAt',s.created_at)) AS memberships
    FROM articles a JOIN stocks s ON s.article_id=a.id JOIN projects p ON p.id=s.project_id
    WHERE a.user_id=? AND a.status='ready' AND (? IS NULL OR s.project_id=?)
    GROUP BY a.id ORDER BY a.id LIMIT 25 OFFSET ?`,
  )
    .bind(userId, projectId, projectId, page * 25)
    .all<{
      id: string;
      title: string;
      summary_json: string;
      memberships: string;
    }>();
  return Promise.all(
    rows.results.map(async (row) => {
      const memberships = (
        JSON.parse(row.memberships) as {
          projectId: string;
          name: string;
          note: string;
          savedAt: string;
        }[]
      ).sort((a, b) => a.projectId.localeCompare(b.projectId));
      const source: Source = {
        articleId: row.id,
        title: row.title,
        summary: JSON.parse(row.summary_json),
        note: [...new Set(memberships.map((item) => item.note))].sort().join(','),
        project: [...new Set(memberships.map((item) => item.name))].sort().join(','),
        savedAt: memberships.map((item) => item.savedAt).sort()[0],
      };
      return { source, hash: await hash(JSON.stringify({ source, memberships })) };
    }),
  );
}

export async function memoryInputs(env: Env, userId: string, projectId: string | null) {
  const inputs: MemoryInput[] = [];
  for (let page = 0; ; page++) {
    const rows = await memoryInputPage(env, userId, projectId, page);
    inputs.push(...rows);
    if (rows.length < 25) return inputs;
  }
}

export async function memoryUpdateState(
  env: Env,
  userId: string,
  projectId: string | null,
  context: MemoryContext,
  inputs: MemoryInput[],
) {
  const id = memoryId(userId, projectId);
  const [memory, tracked] = await Promise.all([
    env.DB.prepare(
      'SELECT data_json,article_count,context_hash,force_full FROM memories WHERE id=? AND user_id=?',
    )
      .bind(id, userId)
      .first<{
        data_json: string;
        article_count: number;
        context_hash: string;
        force_full: number;
      }>(),
    env.DB.prepare('SELECT article_id,source_hash FROM memory_sources WHERE memory_id=?')
      .bind(id)
      .all<{ article_id: string; source_hash: string }>(),
  ]);
  // 名前のみのプロフィール変更は、従来どおり背景の意味の変更とみなさない。
  const contextHash = await hash(
    JSON.stringify({
      scope: context.scope,
      description: context.description,
      ...(context.scope === 'project' ? { name: context.name } : {}),
    }),
  );
  const previous = new Map(tracked.results.map((row) => [row.article_id, row.source_hash]));
  const current = new Map(inputs.map((input) => [input.source.articleId, input.hash]));
  let fullReason: string | null = null;
  if (memory) {
    if (!memory.context_hash || previous.size !== memory.article_count)
      fullReason = '以前のメモリの反映履歴がないため、全件更新が必要です。';
    else if (memory.force_full) fullReason = '全件更新の要求を受け付けています。';
    else if (memory.context_hash !== contextHash)
      fullReason = '自己紹介やプロジェクト情報が変更されたため、全件更新が必要です。';
    else if ([...previous].some(([articleId, sourceHash]) => current.get(articleId) !== sourceHash))
      fullReason = '反映済みの記事が削除・移動・変更されたため、全件更新が必要です。';
  }
  const addedIds = inputs
    .filter((input) => previous.get(input.source.articleId) !== input.hash)
    .map((input) => input.source.articleId);
  return {
    id,
    contextHash,
    fullReason,
    addedIds,
    current: memory ? (JSON.parse(memory.data_json) as MemoryData) : null,
    reflectedCount: fullReason ? 0 : inputs.length - addedIds.length,
  };
}

export async function memoryCoverage(
  env: Env,
  userId: string,
  projectId: string | null,
  context: MemoryContext,
): Promise<MemoryCoverage> {
  const inputs = await memoryInputs(env, userId, projectId);
  const state = await memoryUpdateState(env, userId, projectId, context, inputs);
  const row = await env.DB.prepare(
    'SELECT COUNT(DISTINCT article_id) AS count FROM stocks WHERE user_id=? AND (? IS NULL OR project_id=?)',
  )
    .bind(userId, projectId, projectId)
    .first<{ count: number }>();
  return {
    ready_count: inputs.length,
    reflected_count: state.reflectedCount,
    pending_count: inputs.length - state.reflectedCount,
    waiting_count: Math.max(0, row!.count - inputs.length),
    full_rebuild_reason: state.fullReason,
  };
}

export function memorySourceStatements(
  env: Env,
  id: string,
  revision: number,
  inputs: MemoryInput[],
): D1PreparedStatement[] {
  // memorySaveStatementと同じbatchで実行。古い結果はメモリと履歴の両方を公開しない。
  const current = `EXISTS (SELECT 1 FROM memories m WHERE m.id=? AND m.revision=?
    AND ((m.project_id IS NULL AND m.revision=(SELECT memory_revision FROM users WHERE id=m.user_id))
      OR (m.project_id IS NOT NULL AND m.revision=(SELECT memory_revision FROM projects WHERE id=m.project_id))))`;
  return [
    env.DB.prepare(`DELETE FROM memory_sources WHERE memory_id=? AND ${current}`).bind(
      id,
      id,
      revision,
    ),
    ...inputs.map((input) =>
      env.DB.prepare(
        `INSERT INTO memory_sources(memory_id,article_id,source_hash) SELECT ?,?,? WHERE ${current}`,
      ).bind(id, input.source.articleId, input.hash, id, revision),
    ),
  ];
}
