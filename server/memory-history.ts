import type { MemoryVersion } from '../shared/domain';
import { memorySchema } from '../shared/domain';
import { resolveLanguage, type Language } from '../shared/locale';
import type { Env } from './env';
import { memorySaveStatement, now } from './db';
import { memoryId, memorySourceStatements, type MemoryInput } from './memory';

export type MemorySaveInput = {
  userId: string;
  projectId: string | null;
  revision: number;
  text: string;
  dataJson: string;
  articleCount: number;
  model: string;
  contextHash: string;
  language: Language;
};
export const historyPrefix = (userId: string, projectId: string | null) =>
  `${userId}/${memoryId(userId, projectId)}/`;

export function queueHistoryCleanup(env: Env, prefix: string) {
  return env.DB.prepare(
    `INSERT INTO memory_history_cleanup(prefix) VALUES (?) ON CONFLICT(prefix)
     DO UPDATE SET generation=lower(hex(randomblob(16)))`,
  ).bind(prefix);
}

export async function cleanupMemoryHistory(env: Env) {
  // Keep unresolved writes as tombstones: a terminated writer cannot acknowledge
  // whether its provider-side PUT has finished. Repeated DELETEs also catch late PUTs.
  const interrupted = await env.DB.prepare(
    `SELECT id,content_key FROM memory_history_writes w
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=w.user_id)
       OR (w.project_id IS NOT NULL AND NOT EXISTS
         (SELECT 1 FROM projects p WHERE p.id=w.project_id AND p.user_id=w.user_id))
     ORDER BY last_checked_at,id LIMIT 100`,
  ).all<{ id: string; content_key: string }>();
  for (const item of interrupted.results) {
    try {
      await env.MEMORY_HISTORY.delete(item.content_key);
      await env.DB.prepare('UPDATE memory_history_writes SET last_checked_at=? WHERE id=?')
        .bind(now(), item.id)
        .run();
    } catch {
      console.error('memory_history_write_cleanup_pending');
    }
  }
  const pending = await env.DB.prepare(
    'SELECT prefix,generation FROM memory_history_cleanup LIMIT 10',
  ).all<{ prefix: string; generation: string }>();
  for (const row of pending.results) {
    try {
      const page = await env.MEMORY_HISTORY.list({ prefix: row.prefix, limit: 100 });
      if (page.objects.length)
        await env.MEMORY_HISTORY.delete(page.objects.map((item) => item.key));
      if (!page.truncated)
        await env.DB.prepare('DELETE FROM memory_history_cleanup WHERE prefix=? AND generation=?')
          .bind(row.prefix, row.generation)
          .run();
    } catch {
      console.error('memory_history_cleanup_pending');
    }
  }
}

function versionStatement(env: Env, input: MemorySaveInput, key: string, savedAt: string) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO memory_versions
      (memory_id,revision,user_id,project_id,content_key,article_count,model,language,saved_at)
     SELECT id,revision,user_id,project_id,?,article_count,model,language,?
     FROM memories WHERE id=? AND user_id=? AND revision=?`,
  ).bind(key, savedAt, memoryId(input.userId, input.projectId), input.userId, input.revision);
}

async function putVersion(env: Env, input: MemorySaveInput, savedAt: string) {
  const key = `${historyPrefix(input.userId, input.projectId)}${input.revision}.json`;
  const version: MemoryVersion = {
    revision: input.revision,
    saved_at: savedAt,
    article_count: input.articleCount,
    model: input.model,
    language: input.language,
    text: input.text,
    data: memorySchema.parse(JSON.parse(input.dataJson)),
  };
  // Only the server binding can access this private bucket. Never issue object URLs.
  // Durable intent precedes external I/O and survives account/project cascades.
  const writeId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO memory_history_writes(id,content_key,user_id,project_id) VALUES (?,?,?,?)',
  )
    .bind(writeId, key, input.userId, input.projectId)
    .run();
  await env.MEMORY_HISTORY.put(key, JSON.stringify(version), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return { key, writeId };
}

function completeWriteStatement(env: Env, write: { key: string; writeId: string }) {
  return env.DB.prepare(
    `DELETE FROM memory_history_writes WHERE id=? AND EXISTS
     (SELECT 1 FROM memory_versions WHERE content_key=?)`,
  ).bind(write.writeId, write.key);
}

export async function saveMemoryWithHistory(
  env: Env,
  input: MemorySaveInput,
  inputs: MemoryInput[],
) {
  const id = memoryId(input.userId, input.projectId);
  const owner = input.projectId
    ? await env.DB.prepare('SELECT memory_revision FROM projects WHERE id=? AND user_id=?')
        .bind(input.projectId, input.userId)
        .first<{ memory_revision: number }>()
    : await env.DB.prepare(
        'SELECT memory_revision FROM users WHERE id=? AND onboarding_completed_at IS NOT NULL',
      )
        .bind(input.userId)
        .first<{ memory_revision: number }>();
  if (!owner || owner.memory_revision !== input.revision) return;

  // Preserve the last pre-feature memory on its first subsequent update, too.
  const previous = await env.DB.prepare(
    `SELECT m.* FROM memories m WHERE m.id=? AND m.user_id=? AND NOT EXISTS
     (SELECT 1 FROM memory_versions v WHERE v.memory_id=m.id AND v.revision=m.revision)`,
  )
    .bind(id, input.userId)
    .first<{
      revision: number;
      text: string;
      data_json: string;
      article_count: number;
      model: string;
      language: string;
      updated_at: string;
    }>();
  if (previous && previous.revision !== input.revision) {
    const old: MemorySaveInput = {
      ...input,
      revision: previous.revision,
      text: previous.text,
      dataJson: previous.data_json,
      articleCount: previous.article_count,
      model: previous.model,
      language: resolveLanguage(previous.language),
    };
    const oldWrite = await putVersion(env, old, previous.updated_at);
    await env.DB.batch([
      versionStatement(env, old, oldWrite.key, previous.updated_at),
      completeWriteStatement(env, oldWrite),
    ]);
  }
  const savedAt = now();
  const existing = await env.DB.prepare(
    'SELECT revision FROM memory_versions WHERE memory_id=? AND user_id=? AND revision=?',
  )
    .bind(id, input.userId, input.revision)
    .first();
  // A replay after a successful D1 commit must not overwrite the immutable R2 version.
  if (!existing) {
    const write = await putVersion(env, input, savedAt);
    await env.DB.batch([
      memorySaveStatement(env, input),
      ...memorySourceStatements(env, id, input.revision, inputs),
      versionStatement(env, input, write.key, savedAt),
      completeWriteStatement(env, write),
    ]);
  }
  // A deletion can win while R2.put is in flight, after the normal deletion sweep.
  const stillOwned = input.projectId
    ? await env.DB.prepare('SELECT id FROM projects WHERE id=? AND user_id=?')
        .bind(input.projectId, input.userId)
        .first()
    : await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(input.userId).first();
  if (!stillOwned)
    await queueHistoryCleanup(env, historyPrefix(input.userId, input.projectId)).run();
}

export async function listMemoryVersions(
  env: Env,
  userId: string,
  projectId: string | null,
  before?: number,
) {
  const rows = await env.DB.prepare(
    `SELECT revision,article_count,model,language,saved_at FROM memory_versions
     WHERE memory_id=? AND user_id=? ${before === undefined ? '' : 'AND revision<?'}
     ORDER BY revision DESC LIMIT 25`,
  )
    .bind(memoryId(userId, projectId), userId, ...(before === undefined ? [] : [before]))
    .all<Omit<MemoryVersion, 'text' | 'data'>>();
  const versions = rows.results.slice(0, 24);
  return {
    versions,
    has_more: rows.results.length > 24,
    next_before: rows.results.length > 24 ? versions.at(-1)!.revision : null,
  };
}

export async function readMemoryVersion(
  env: Env,
  userId: string,
  projectId: string | null,
  revision: number,
) {
  const row = await env.DB.prepare(
    'SELECT content_key FROM memory_versions WHERE memory_id=? AND user_id=? AND revision=?',
  )
    .bind(memoryId(userId, projectId), userId, revision)
    .first<{ content_key: string }>();
  if (!row) return null;
  const object = await env.MEMORY_HISTORY.get(row.content_key);
  if (!object)
    throw new Error('メモリ履歴を読み込めませんでした。時間をおいて再試行してください。');
  const version = await object.json<MemoryVersion>();
  // Recheck authorization after the external read in case the project was deleted.
  const present = await env.DB.prepare(
    'SELECT revision FROM memory_versions WHERE memory_id=? AND user_id=? AND revision=?',
  )
    .bind(memoryId(userId, projectId), userId, revision)
    .first();
  return present ? version : null;
}
