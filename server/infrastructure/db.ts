import { resolveLanguage, type Language } from '../../shared/locale';
import type { Env, Job, JobStateGuard } from '../env';

export const now = () => new Date().toISOString();
export function queueQuestionJobStatement(
  env: Env,
  stockId: string | null = null,
  articleId: string | null = null,
  language?: Language,
  articleGeneration?: number,
): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT OR IGNORE INTO processing_jobs (id, user_id, kind, target_id, revision, language) SELECT 'q-' || s.id || '-' || q.generation, s.user_id, 'question', s.id, q.generation, ? FROM questions q JOIN stocks s ON s.id = q.stock_id JOIN articles a ON a.id = s.article_id JOIN projects p ON p.id = s.project_id WHERE p.auto_generate_questions = 1 AND q.source = 'ai' AND q.status = 'queued' AND a.status = 'ready' AND (? IS NULL OR s.id = ?) AND (? IS NULL OR s.article_id = ?) AND a.generation = COALESCE(?, a.generation)",
  ).bind(language ?? '', stockId, stockId, articleId, articleId, articleGeneration ?? null);
}
export function jobFailureStatements(
  env: Env,
  job: Job,
  message: string,
  guard: JobStateGuard = {},
): D1PreparedStatement[] {
  const statements = [
    env.DB.prepare(
      "UPDATE processing_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status != 'done' AND (? IS NULL OR status=?) AND (? IS NULL OR COALESCE((SELECT attempts FROM job_dispatch_attempts WHERE job_id=processing_jobs.id),0)=?) AND (? IS NULL OR updated_at=?)",
    ).bind(
      message,
      now(),
      job.id,
      guard.status ?? null,
      guard.status ?? null,
      guard.attempts ?? null,
      guard.attempts ?? null,
      guard.updatedAt ?? null,
      guard.updatedAt ?? null,
    ),
  ];
  if (job.kind === 'article') {
    statements.push(
      env.DB.prepare(
        "UPDATE articles SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND user_id = ? AND generation = ? AND status != 'ready' AND EXISTS (SELECT 1 FROM processing_jobs WHERE id=? AND status='failed')",
      ).bind(message, now(), job.target_id, job.user_id, job.revision, job.id),
      env.DB.prepare(
        "UPDATE questions SET status = 'failed', error = '記事の取得・要約が完了していません。記事の再取得をお試しください。', updated_at = ? WHERE source = 'ai' AND status = 'queued' AND stock_id IN (SELECT s.id FROM stocks s JOIN articles a ON a.id = s.article_id WHERE a.id = ? AND s.user_id = ? AND a.generation = ? AND a.status = 'failed') AND EXISTS (SELECT 1 FROM processing_jobs WHERE id=? AND status='failed')",
      ).bind(now(), job.target_id, job.user_id, job.revision, job.id),
    );
  } else if (job.kind === 'pufu') {
    statements.push(
      env.DB.prepare(
        "UPDATE pufu_scores SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND user_id = ? AND generation = ? AND status != 'ready' AND EXISTS (SELECT 1 FROM processing_jobs WHERE id=? AND status='failed')",
      ).bind(message, now(), job.target_id, job.user_id, job.revision, job.id),
    );
  } else if (job.purpose === 'reflection') {
    statements.push(
      env.DB.prepare(
        `UPDATE reflections SET status='failed' WHERE id=? AND generation=? AND status='queued'
        AND EXISTS(SELECT 1 FROM projects WHERE id=reflections.project_id AND user_id=?)
        AND EXISTS(SELECT 1 FROM processing_jobs WHERE id=? AND status='failed')`,
      ).bind(job.target_id, job.revision, job.user_id, job.id),
    );
  } else if (job.kind === 'question') {
    statements.push(
      env.DB.prepare(
        "UPDATE questions SET status = 'failed', error = ?, updated_at = ? WHERE stock_id = ? AND source = 'ai' AND generation = ? AND status != 'ready' AND EXISTS (SELECT 1 FROM stocks WHERE id = questions.stock_id AND user_id = ?) AND EXISTS (SELECT 1 FROM processing_jobs WHERE id=? AND status='failed')",
      ).bind(message, now(), job.target_id, job.revision, job.user_id, job.id),
    );
  }
  return statements;
}
function userMemoryStatements(
  env: Env,
  userId: string,
  guard = '',
  guardParams: (string | number)[] = [],
  language?: Language,
  enqueue = true,
): D1PreparedStatement[] {
  const statements = [
    env.DB.prepare(
      `UPDATE users SET memory_revision = memory_revision + 1 WHERE id = ?${guard}`,
    ).bind(userId, ...guardParams),
  ];
  if (enqueue)
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO processing_jobs (id, user_id, kind, target_id, revision, language) SELECT 'um-' || id || '-' || memory_revision, id, 'user_memory', id, memory_revision, ? FROM users WHERE id = ?${guard}`,
      ).bind(language ?? '', userId, ...guardParams),
    );
  return statements;
}
export function dirtyMemoryStatements(
  env: Env,
  userId: string,
  projectIds: string[],
  createdStockId?: string,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const guard = createdStockId ? ' AND EXISTS (SELECT 1 FROM stocks WHERE id = ?)' : '';
  const guardParams = createdStockId ? [createdStockId] : [];
  if (projectIds.length) {
    const placeholders = projectIds.map(() => '?').join(',');
    statements.push(
      env.DB.prepare(
        `UPDATE projects SET memory_revision = memory_revision + 1 WHERE user_id = ? AND id IN (${placeholders})${guard}`,
      ).bind(userId, ...projectIds, ...guardParams),
      env.DB.prepare(
        `INSERT OR IGNORE INTO processing_jobs (id, user_id, kind, target_id, revision) SELECT 'pm-' || id || '-' || memory_revision, user_id, 'project_memory', id, memory_revision FROM projects WHERE user_id = ? AND id IN (${placeholders})${guard}`,
      ).bind(userId, ...projectIds, ...guardParams),
    );
  }
  // 保存と同じbatchで現在の設定を読み、重複保存やオフの保存先では更新しない。
  const userGuard = createdStockId
    ? ' AND EXISTS (SELECT 1 FROM stocks s JOIN projects p ON p.id=s.project_id WHERE s.id=? AND p.include_in_user_memory=1)'
    : '';
  statements.push(...userMemoryStatements(env, userId, userGuard, guardParams));
  return statements;
}
export function articleMemoryStatements(
  env: Env,
  userId: string,
  article: { id: string; generation: number; queue: true } | { canonical: string; queue: false },
  language?: Language,
): D1PreparedStatement[] {
  // 要約確定時は更新前の世代とstatusを照合する。編集直後は旧メモリの確定だけを止める。
  const match = article.queue
    ? "a.id = ? AND a.generation = ? AND a.status != 'ready'"
    : 'a.canonical_url = ?';
  const params = article.queue ? [article.id, article.generation] : [article.canonical];
  const memberships = 'FROM stocks s JOIN articles a ON a.id = s.article_id';
  const projectGuard = `user_id = ? AND id IN (SELECT s.project_id ${memberships} WHERE a.user_id = ? AND ${match})`;
  return [
    env.DB.prepare(
      `UPDATE projects SET memory_revision = memory_revision + 1 WHERE ${projectGuard}`,
    ).bind(userId, userId, ...params),
    ...(article.queue
      ? [
          env.DB.prepare(
            `INSERT OR IGNORE INTO processing_jobs (id, user_id, kind, target_id, revision, language)
            SELECT 'pm-' || id || '-' || memory_revision, user_id, 'project_memory', id, memory_revision, ?
            FROM projects WHERE ${projectGuard}`,
          ).bind(language ?? '', userId, userId, ...params),
        ]
      : []),
    ...userMemoryStatements(
      env,
      userId,
      ` AND EXISTS (SELECT 1 ${memberships} JOIN projects p ON p.id = s.project_id
        WHERE a.user_id = ? AND ${match} AND p.include_in_user_memory = 1)`,
      [userId, ...params],
      language,
      article.queue,
    ),
  ];
}
export function memorySaveStatement(
  env: Env,
  input: {
    userId: string;
    projectId: string | null;
    revision: number;
    text: string;
    dataJson: string;
    articleCount: number;
    model: string;
    contextHash?: string;
    language?: Language;
  },
): D1PreparedStatement {
  const predicate = input.projectId
    ? 'EXISTS (SELECT 1 FROM projects WHERE id = ? AND user_id = ? AND memory_revision = ?)'
    : 'EXISTS (SELECT 1 FROM users WHERE id = ? AND id = ? AND memory_revision = ?)';
  return env.DB.prepare(
    `INSERT INTO memories (id, user_id, project_id, revision, text, data_json, article_count, model, updated_at, context_hash, language) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${predicate} ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, text = excluded.text, data_json = excluded.data_json, article_count = excluded.article_count, model = excluded.model, updated_at = excluded.updated_at, context_hash = excluded.context_hash, language = excluded.language, force_full = 0`,
  ).bind(
    input.projectId ? `project-${input.projectId}` : `user-${input.userId}`,
    input.userId,
    input.projectId,
    input.revision,
    input.text,
    input.dataJson,
    input.articleCount,
    input.model,
    now(),
    input.contextHash ?? '',
    resolveLanguage(input.language),
    input.projectId ?? input.userId,
    input.userId,
    input.revision,
  );
}
export function orphanCleanupStatements(env: Env, userId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      "INSERT OR IGNORE INTO processing_jobs (id, user_id, kind, target_id, revision) SELECT 'gc-' || id || '-' || generation, user_id, 'cleanup', content_key, generation FROM articles WHERE user_id = ? AND content_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stocks WHERE stocks.article_id = articles.id)",
    ).bind(userId),
    env.DB.prepare(
      'DELETE FROM articles WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM stocks WHERE stocks.article_id = articles.id)',
    ).bind(userId),
  ];
}
