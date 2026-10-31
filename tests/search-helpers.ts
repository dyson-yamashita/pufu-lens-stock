import { vi } from 'vitest';
import type { Env } from '../server/env';
import type { testApp } from './helpers';

export function searchBindings(env: Env) {
  const vectors = new Map<string, VectorizeVector>();
  const values = [1, ...Array<number>(1023).fill(0)];
  const run = vi.fn(async (_model: string, _input: unknown) => ({ data: [values] }));
  const query = vi.fn(
    async (_values: VectorFloatArray | number[], options?: VectorizeQueryOptions) => {
      const matches = [...vectors.values()]
        .filter(
          (vector) =>
            vector.namespace === options?.namespace &&
            (!options?.filter?.project_id ||
              (typeof options.filter.project_id === 'object' && '$in' in options.filter.project_id
                ? options.filter.project_id.$in?.includes(vector.metadata?.project_id as string)
                : vector.metadata?.project_id === options.filter.project_id)),
        )
        .map((vector) => ({ id: vector.id, score: 0.9 }));
      return { matches: matches.slice(0, options?.topK), count: matches.length };
    },
  );
  const upsert = vi.fn(async (items: VectorizeVector[]) => {
    for (const item of items) vectors.set(item.id, item);
    return { mutationId: crypto.randomUUID() };
  });
  const deleteByIds = vi.fn(async (ids: string[]) => {
    for (const id of ids) vectors.delete(id);
    return { mutationId: crypto.randomUUID() };
  });
  env.AI = { run };
  env.SEARCH_INDEX = { query, upsert, deleteByIds };
  return { vectors, run, query, upsert, deleteByIds, values };
}
export async function searchStock(
  app: Awaited<ReturnType<typeof testApp>>,
  id: string,
  options: {
    owner?: string;
    project?: string;
    title?: string;
    note?: string;
    favorite?: number;
    source?: string;
    status?: string;
  } = {},
) {
  const owner = options.owner ?? 'alice';
  await app.env.DB.batch([
    app.env.DB.prepare(
      `INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,source_type,input_text,status,summary_json)
      VALUES(?,?,?,'',?,'',?,'本文限定の秘密語',?,?)`,
    ).bind(
      id,
      owner,
      'text:' + id,
      options.title ?? 'コードレビューの習慣',
      options.source ?? 'text',
      options.status ?? 'ready',
      JSON.stringify({
        overview: '変更内容を丁寧に確認する',
        keyPoints: ['要点の検索対象'],
        topics: ['トピックの検索対象'],
      }),
    ),
    app.env.DB.prepare(
      'INSERT INTO stocks(id,user_id,project_id,article_id,note,is_favorite,created_at) VALUES(?,?,?,?,?,?,?)',
    ).bind(
      's-' + id,
      owner,
      options.project ?? owner + '-project',
      id,
      options.note ?? '保存したメモ',
      options.favorite ?? 0,
      '2026-10-20T00:00:00.000Z',
    ),
  ]);
  return 's-' + id;
}
export async function searchEntry(env: Env, stockId: string) {
  const row = await env.DB.prepare(
    'SELECT id FROM stock_search_entries WHERE stock_id=? AND current=1',
  )
    .bind(stockId)
    .first<{ id: string }>();
  return row!.id;
}
