import type { Env } from '../../env';
import { articleMemoryStatements, now } from '../../infrastructure/db';
import { hash } from '../../infrastructure/security';

export async function textArticleCanonical(title: string, text: string, skipSummary: boolean) {
  const source = `text:${await hash(JSON.stringify([title, skipSummary ? text : text.trim()]))}`;
  return skipSummary ? `verbatim:${source}` : source;
}

export async function updateTextStockContent(
  env: Env,
  input: {
    stockId: string;
    articleId: string;
    generation: number;
    userId: string;
    text: string;
    canonical: string;
  },
) {
  const { stockId, articleId, generation, userId, text } = input;
  const forkId = crypto.randomUUID();
  // 新規保存は本文のハッシュで重複を探す。編集時の分岐・更新は独立した識別子を使う。
  const canonical = `${input.canonical}:edited:${forkId}`;
  const updatedAt = now();
  const original = `id = ? AND user_id = ? AND generation = ? AND source_type = 'text'
    AND EXISTS (SELECT 1 FROM stocks s WHERE s.id = ? AND s.user_id = ? AND s.article_id = articles.id)`;
  const originalParams = [articleId, userId, generation, stockId, userId];
  // 別の保存先が参照している場合は、編集したストックだけを新しい記事へ付け替える。
  // 保存先の追加・削除が同時に起きても、共有の判定からジョブ登録までを同じトランザクションで行う。
  const [fork, , , update] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO articles
        (id, user_id, canonical_url, source_url, title, domain, source_type, input_text, skip_summary, created_at)
      SELECT ?, a.user_id, ?, a.source_url, a.title, a.domain, a.source_type, ?, a.skip_summary, a.created_at
      FROM stocks s JOIN articles a ON a.id = s.article_id AND a.user_id = s.user_id
      WHERE s.id = ? AND s.user_id = ? AND a.id = ? AND a.generation = ? AND a.source_type = 'text'
        AND EXISTS (SELECT 1 FROM stocks other WHERE other.article_id = a.id AND other.id != s.id)`,
    ).bind(forkId, canonical, text, stockId, userId, articleId, generation),
    env.DB.prepare(
      `UPDATE stocks SET article_id = ? WHERE id = ? AND user_id = ?
        AND EXISTS (SELECT 1 FROM articles WHERE id = ? AND user_id = ?)`,
    ).bind(forkId, stockId, userId, forkId, userId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO processing_jobs (id, user_id, kind, target_id, revision)
      SELECT 'gc-old-' || id || '-' || (generation + 1), user_id, 'cleanup', content_key, generation + 1
      FROM articles WHERE ${original} AND content_key IS NOT NULL`,
    ).bind(...originalParams),
    env.DB.prepare(
      // プ譜などの本文参照も、要約を待たずに新しい手入力本文へ切り替える。
      `UPDATE articles SET canonical_url = ?, input_text = ?, status = 'queued',
        content_key = NULL, has_og_image = 0, summary_json = NULL, model = NULL, error = NULL,
        generation = generation + 1, updated_at = ? WHERE ${original}`,
    ).bind(canonical, text, updatedAt, ...originalParams),
    env.DB.prepare(
      `INSERT INTO processing_jobs (id, user_id, kind, target_id, revision)
      SELECT 'a-' || id || '-' || generation, user_id, 'article', id, generation
      FROM articles WHERE user_id = ? AND canonical_url = ?`,
    ).bind(userId, canonical),
    // 完成済みの問いは残し、処理中・失敗済みの問いだけを新しい要約から作り直す。
    env.DB.prepare(
      `UPDATE questions SET status = 'queued', error = NULL, generation = generation + 1, updated_at = ?
      WHERE stock_id = ? AND source = 'ai' AND status != 'ready'
        AND EXISTS (
          SELECT 1 FROM stocks s JOIN articles a ON a.id = s.article_id JOIN projects p ON p.id = s.project_id
          WHERE s.id = questions.stock_id AND a.user_id = ? AND a.canonical_url = ?
            AND (questions.status != 'failed' OR p.auto_generate_questions = 1)
        )`,
    ).bind(updatedAt, stockId, userId, canonical),
    ...articleMemoryStatements(env, userId, { canonical, queue: false }),
  ]);
  if (fork.meta.changes) return { articleId: forkId, generation: 1 };
  if (update.meta.changes) return { articleId, generation: generation + 1 };
  return null;
}
