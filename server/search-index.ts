import type { Env } from './env';
import { embedSearchText, SearchError, searchTimeout } from './search-ai';
import type { ArticleSummary } from '../shared/domain';

type Entry = {
  id: string;
  stock_id: string;
  user_id: string;
  current: number;
  touched: number;
  write_pending: number;
};
type Document = {
  title: string;
  note: string;
  summary_json: string | null;
  status: string;
  project_id: string;
};
const now = () => new Date().toISOString();
function documentText(source: Document) {
  const summary =
    source.status === 'ready' && source.summary_json
      ? (JSON.parse(source.summary_json) as ArticleSummary)
      : null;
  return [
    source.title,
    source.note,
    summary?.overview,
    ...(summary?.keyPoints ?? []),
    ...(summary?.topics ?? []),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8000);
}
// 外部書き込みと退会/削除が競合しても、後続Cronの削除対象を失わない。
async function retainCleanup(env: Env, entry: Entry, pending = 0) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO stock_search_entries(id,stock_id,user_id,current,touched,write_pending)
    VALUES(?,?,?,0,1,?)`,
  )
    .bind(entry.id, entry.stock_id, entry.user_id, pending)
    .run();
}
async function settleWrite(env: Env, entry: Entry) {
  await retainCleanup(env, entry);
  await env.DB.prepare(
    `UPDATE stock_search_entries SET write_pending=0,
    next_attempt_at=CASE WHEN current=0 THEN ? ELSE next_attempt_at END WHERE id=?`,
  )
    .bind(now(), entry.id)
    .run();
}
async function replaceUncertainEntry(env: Env, entry: Entry, lease: string) {
  await env.DB.batch([
    env.DB.prepare('UPDATE stock_search_entries SET current=0 WHERE id=? AND lease_until=?').bind(
      entry.id,
      lease,
    ),
    env.DB.prepare(
      `INSERT INTO stock_search_entries(stock_id,user_id)
      SELECT id,user_id FROM stocks WHERE id=? AND user_id=?
      AND NOT EXISTS(SELECT 1 FROM stock_search_entries WHERE stock_id=? AND current=1)`,
    ).bind(entry.stock_id, entry.user_id, entry.stock_id),
  ]);
}

export async function syncSearchIndex(env: Env): Promise<void> {
  const at = now();
  await env.DB.prepare(
    `DELETE FROM stock_search_entries WHERE current=0 AND touched=0
    AND (lease_until IS NULL OR lease_until<=?)`,
  )
    .bind(at)
    .run();
  if (!env.SEARCH_INDEX) return;
  const entries = await env.DB.prepare(
    `SELECT id,stock_id,user_id,current,touched,write_pending FROM stock_search_entries e
    WHERE (e.current=0 OR (e.ready=0 AND EXISTS(SELECT 1 FROM stocks s JOIN articles a ON a.id=s.article_id
      WHERE s.id=e.stock_id AND s.user_id=e.user_id AND a.status IN ('ready','failed'))))
    AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?)
    ORDER BY current,created_at,id LIMIT 10`,
  )
    .bind(at, at)
    .all<Entry>();
  for (const entry of entries.results) {
    if (entry.current && !env.AI) continue;
    const lease = new Date(Date.now() + 120000).toISOString();
    const claim = await env.DB.prepare(
      `UPDATE stock_search_entries SET lease_until=? WHERE id=?
      AND (current=0 OR ready=0) AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) RETURNING current,touched,write_pending`,
    )
      .bind(lease, entry.id, at, at)
      .first<Pick<Entry, 'current' | 'touched' | 'write_pending'>>();
    if (!claim) continue;
    let attempted = false;
    try {
      if (!claim.current) {
        if (claim.touched) await searchTimeout(env.SEARCH_INDEX.deleteByIds([entry.id]));
        // 削除開始後にupsertが完了する場合があるため、開始時点で未確定なら必ず次回も削除する。
        if (!claim.write_pending) {
          await env.DB.prepare(
            'DELETE FROM stock_search_entries WHERE id=? AND current=0 AND lease_until=? AND write_pending=0',
          )
            .bind(entry.id, lease)
            .run();
        }
        await env.DB.prepare(
          `UPDATE stock_search_entries SET next_attempt_at=CASE WHEN write_pending=1 THEN ? ELSE ? END
          WHERE id=? AND lease_until=?`,
        )
          .bind(new Date(Date.now() + 3600000).toISOString(), now(), entry.id, lease)
          .run();
        continue;
      }
      if (claim.touched) {
        // 停止した処理と同じVectorize IDを使い回さず、未確定の旧書き込みを隔離する。
        await replaceUncertainEntry(env, entry, lease);
        continue;
      }
      const source = await env.DB.prepare(
        `SELECT COALESCE(s.title,a.title) AS title,s.note,a.summary_json,a.status,s.project_id
        FROM stock_search_entries e JOIN stocks s ON s.id=e.stock_id AND s.user_id=e.user_id
        JOIN articles a ON a.id=s.article_id WHERE e.id=? AND e.current=1 AND a.status IN ('ready','failed')`,
      )
        .bind(entry.id)
        .first<Document>();
      if (!source) continue;
      const values = await embedSearchText(env, entry.user_id, documentText(source), 'index');
      const touched = await env.DB.prepare(
        `UPDATE stock_search_entries SET touched=1,write_pending=1 WHERE id=?
        AND current=1 AND lease_until=?`,
      )
        .bind(entry.id, lease)
        .run();
      if (!touched.meta.changes) continue;
      attempted = true;
      await searchTimeout(
        env.SEARCH_INDEX.upsert([
          {
            id: entry.id,
            namespace: entry.user_id,
            values,
            metadata: { project_id: source.project_id },
          },
        ]).then(
          async (result) => {
            await settleWrite(env, entry);
            return result;
          },
          async (error) => {
            await settleWrite(env, entry);
            throw error;
          },
        ),
      );
      const published = await env.DB.prepare(
        `UPDATE stock_search_entries SET ready=1
        WHERE id=? AND current=1 AND lease_until=?`,
      )
        .bind(entry.id, lease)
        .run();
      if (!published.meta.changes) await retainCleanup(env, entry);
    } catch (error) {
      if (attempted) {
        await retainCleanup(env, entry, 1);
        await replaceUncertainEntry(env, entry, lease);
      }
      const delay = error instanceof SearchError && error.status === 429 ? 3600000 : 60000;
      await env.DB.prepare(
        'UPDATE stock_search_entries SET next_attempt_at=? WHERE id=? AND lease_until=?',
      )
        .bind(new Date(Date.now() + delay).toISOString(), entry.id, lease)
        .run();
      console.error('search_index_retry_pending');
    } finally {
      await env.DB.prepare(
        'UPDATE stock_search_entries SET lease_until=NULL WHERE id=? AND lease_until=?',
      )
        .bind(entry.id, lease)
        .run();
    }
  }
}
