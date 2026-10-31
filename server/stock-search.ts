import { projectListFilter } from './project-access';
import type { Env } from './env';
import { embedSearchText, SearchError, searchTimeout } from './search-ai';

export type StockSearch = {
  userId: string;
  projectId: string | null;
  projectIds?: string[] | null;
  q: string;
  status: string;
  source: string;
  favorite: string;
  page: number;
  limit: number;
  order: 'asc' | 'desc';
  detail: 'compact' | 'full';
  mode: 'keyword' | 'semantic' | 'hybrid';
  min_score: number;
};
const candidateLimit = 100;
const joins = 'stocks s JOIN articles a ON a.id=s.article_id JOIN projects p ON p.id=s.project_id';
// D1のLIKEパターン上限（50バイト）を避け、従来と同じ英字の大小を区別しない部分一致にする。
const match =
  '(instr(lower(COALESCE(s.title,a.title)),lower(?))>0 OR instr(lower(a.summary_json),lower(?))>0 OR instr(lower(s.note),lower(?))>0)';
const queryParams = (q: string) => [q, q, q];
function filter(options: StockSearch) {
  const projects = projectListFilter(options.projectId, options.projectIds);
  return {
    where:
      's.user_id=? AND ' +
      projects.sql +
      " AND (?='all' OR (?='processing' AND a.status IN ('queued','extracting','summarizing')) OR a.status=?) AND (?='all' OR a.source_type=?)" +
      (options.favorite === 'true' ? ' AND s.is_favorite=1' : ''),
    params: [
      options.userId,
      ...projects.params,
      options.status,
      options.status,
      options.status,
      options.source,
      options.source === 'web' ? 'url' : 'text',
    ],
  };
}
function columns(detail: StockSearch['detail']) {
  return detail === 'compact'
    ? "s.id,s.project_id,p.name AS project_name,s.created_at,COALESCE(s.title,a.title) AS title,a.status,CASE WHEN a.status!='failed' THEN substr(json_extract(a.summary_json,'$.overview'),1,201) END AS summary_excerpt"
    : 's.id,s.is_favorite,s.article_id,s.project_id,p.name AS project_name,s.note,s.created_at,COALESCE(s.title,a.title) AS title,a.source_type,a.source_url,a.domain,a.status,a.summary_json,a.error,a.model';
}
function serialize(row: Record<string, unknown>, detail: StockSearch['detail']) {
  const data = { ...row };
  delete data.search_entry_id;
  delete data.search_ready;
  delete data.keyword_match;
  if (detail === 'compact') {
    const { summary_excerpt, ...stock } = data;
    const characters = typeof summary_excerpt === 'string' ? Array.from(summary_excerpt) : [];
    const truncated = characters.length > 200;
    return {
      ...stock,
      summary_excerpt:
        typeof summary_excerpt === 'string'
          ? truncated
            ? characters.slice(0, 199).join('') + '…'
            : summary_excerpt
          : null,
      summary_truncated: truncated,
    };
  }
  const { summary_json, ...stock } = data;
  return {
    ...stock,
    summary: stock.status !== 'failed' && summary_json ? JSON.parse(String(summary_json)) : null,
  };
}
async function keyword(env: Env, options: StockSearch) {
  const { where, params } = filter(options);
  const direction = options.order === 'asc' ? 'ASC' : 'DESC';
  const bound = [...params, ...queryParams(options.q)];
  const [rows, totals] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      'SELECT ' +
        columns(options.detail) +
        ' FROM ' +
        joins +
        ' WHERE ' +
        where +
        ' AND ' +
        match +
        ' ORDER BY s.created_at ' +
        direction +
        ',s.id ' +
        direction +
        ' LIMIT ? OFFSET ?',
    ).bind(...bound, options.limit, (options.page - 1) * options.limit),
    env.DB.prepare(
      'SELECT COUNT(*) AS count FROM ' + joins + ' WHERE ' + where + ' AND ' + match,
    ).bind(...bound),
  ]);
  const total = Number(totals.results[0].count);
  return {
    stocks: rows.results.map((row) => serialize(row, options.detail)),
    total,
    page: options.page,
    pageSize: options.limit,
    has_more: options.page * options.limit < total,
    sort_by: 'created_at',
    order: options.order,
    detail: options.detail,
  };
}
type Candidate = { id: string; created_at: string; vector_id?: string };
async function semantic(env: Env, options: StockSearch) {
  if (!env.AI || !env.SEARCH_INDEX) throw new SearchError('not_configured');
  const { where, params } = filter(options);
  const coverage = await env.DB.prepare(
    'SELECT COUNT(*) AS total,COALESCE(SUM(e.ready),0) AS indexed FROM ' +
      joins +
      ' LEFT JOIN stock_search_entries e ON e.stock_id=s.id AND e.user_id=s.user_id AND e.current=1 WHERE ' +
      where,
  )
    .bind(...params)
    .first<{ total: number; indexed: number }>();
  const pending = coverage!.total - coverage!.indexed;
  if (coverage!.total && !coverage!.indexed) throw new SearchError('index_pending');
  const lexical =
    options.mode === 'hybrid'
      ? (
          await env.DB.prepare(
            'SELECT s.id,s.created_at FROM ' +
              joins +
              ' WHERE ' +
              where +
              ' AND ' +
              match +
              ' ORDER BY s.created_at DESC,s.id DESC LIMIT ?',
          )
            .bind(...params, ...queryParams(options.q), candidateLimit + 1)
            .all<Candidate>()
        ).results
      : [];
  let matches: VectorizeMatch[] = [];
  if (coverage!.indexed) {
    const values = await embedSearchText(env, options.userId, options.q, 'query');
    try {
      const selected = options.projectId ? [options.projectId] : options.projectIds;
      // Keep each metadata filter bounded, then rank the union across selected projects.
      const groups: (string[] | null)[] = selected == null ? [null] : [];
      if (selected)
        for (let start = 0; start < selected.length; start += 10)
          groups.push(selected.slice(start, start + 10));
      const responses = await searchTimeout(
        Promise.all(
          groups.map((group) =>
            env.SEARCH_INDEX!.query(values, {
              topK: candidateLimit,
              namespace: options.userId,
              returnValues: false,
              returnMetadata: 'none',
              ...(group
                ? { filter: { project_id: group.length === 1 ? group[0] : { $in: group } } }
                : {}),
            }),
          ),
        ),
      );
      if (responses.some((response) => !Array.isArray(response.matches)))
        throw new SearchError('service_error');
      matches = responses
        .flatMap((response) => response.matches)
        .filter((item) => typeof item.id === 'string' && Number.isFinite(item.score))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, candidateLimit);
    } catch {
      throw new SearchError('service_error');
    }
  }
  const vectorIds = [
    ...new Set(
      matches
        .filter(
          (item) =>
            typeof item.id === 'string' &&
            Number.isFinite(item.score) &&
            item.score >= options.min_score,
        )
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .map((item) => item.id),
    ),
  ];
  // D1のバインド変数上限内で処理し、VectorizeのIDを現行世代・本人のデータに照合する。
  const semanticRows: Candidate[] = [];
  for (let start = 0; start < vectorIds.length; start += 80) {
    const ids = vectorIds.slice(start, start + 80);
    const rows = await env.DB.prepare(
      'SELECT s.id,s.created_at,e.id AS vector_id FROM ' +
        joins +
        ' JOIN stock_search_entries e ON e.stock_id=s.id AND e.user_id=s.user_id AND e.current=1 AND e.ready=1 WHERE ' +
        where +
        ' AND e.id IN (' +
        ids.map(() => '?').join(',') +
        ')',
    )
      .bind(...params, ...ids)
      .all<Candidate>();
    semanticRows.push(...rows.results);
  }
  const byVector = new Map(semanticRows.map((row) => [row.vector_id!, row]));
  const semanticRank = vectorIds.flatMap((id) => (byVector.has(id) ? [byVector.get(id)!] : []));
  const lexicalRank = lexical.slice(0, candidateLimit);
  const candidates = new Map<string, Candidate>();
  const scores = new Map<string, number>();
  for (const list of [lexicalRank, semanticRank])
    list.forEach((row, index) => {
      candidates.set(row.id, row);
      scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (60 + index + 1));
    });
  const ordered = [...candidates.values()].sort(
    (a, b) =>
      scores.get(b.id)! - scores.get(a.id)! ||
      b.created_at.localeCompare(a.created_at) ||
      b.id.localeCompare(a.id),
  );
  const ids = ordered
    .slice((options.page - 1) * options.limit, options.page * options.limit)
    .map((row) => row.id);
  const semanticVersions = new Map(semanticRank.map((row) => [row.id, row.vector_id]));
  const lexicalIds = new Set(lexicalRank.map((row) => row.id));
  let rows: Record<string, unknown>[] = [];
  if (ids.length)
    rows = (
      await env.DB.prepare(
        'SELECT ' +
          columns(options.detail) +
          ',e.id AS search_entry_id,e.ready AS search_ready,CASE WHEN ' +
          match +
          ' THEN 1 ELSE 0 END AS keyword_match FROM ' +
          joins +
          ' LEFT JOIN stock_search_entries e ON e.stock_id=s.id AND e.user_id=s.user_id AND e.current=1 WHERE ' +
          where +
          ' AND s.id IN (' +
          ids.map(() => '?').join(',') +
          ')',
      )
        .bind(...queryParams(options.q), ...params, ...ids)
        .all<Record<string, unknown>>()
    ).results;
  const byId = new Map(
    rows
      .filter(
        (row) =>
          (lexicalIds.has(String(row.id)) && row.keyword_match === 1) ||
          (row.search_ready === 1 && semanticVersions.get(String(row.id)) === row.search_entry_id),
      )
      .map((row) => [String(row.id), row]),
  );
  return {
    stocks: ids.flatMap((id) => (byId.has(id) ? [serialize(byId.get(id)!, options.detail)] : [])),
    total: ordered.length,
    page: options.page,
    pageSize: options.limit,
    has_more: options.page * options.limit < ordered.length,
    sort_by: 'relevance',
    order: 'desc',
    detail: options.detail,
    search: {
      requested_mode: options.mode,
      mode: options.mode,
      candidate_limit: candidateLimit,
      candidates_truncated:
        lexical.length > candidateLimit ||
        (options.projectIds == null
          ? matches.length === candidateLimit
          : semanticRank.length === candidateLimit),
      total_scope: 'candidates',
      indexed_count: coverage!.indexed,
      pending_count: pending,
      min_score: options.min_score,
    },
  };
}
export async function listStocks(env: Env, options: StockSearch) {
  if (options.mode === 'keyword') return keyword(env, options);
  if (!options.q.trim())
    return {
      ...(await keyword(env, { ...options, q: '' })),
      search: { requested_mode: options.mode, mode: 'keyword', fallback_reason: 'empty_query' },
    };
  try {
    return await semantic(env, { ...options, q: options.q.trim() });
  } catch (error) {
    if (!(error instanceof SearchError) || options.mode !== 'hybrid') throw error;
    return {
      ...(await keyword(env, options)),
      search: { requested_mode: options.mode, mode: 'keyword', fallback_reason: error.reason },
    };
  }
}
