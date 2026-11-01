// Keep legacy hash links readable while giving each public resource an HTTP URL.
export const publicPathPattern =
  /^\/p\/([A-Za-z0-9_-]+)(?:\/(stocks|questions|pufus)\/([A-Za-z0-9_-]+))?\/?$/;
export function publicHref(base: string, hash: string): string {
  const detail = /^#(stock|question|pufu)\/([^/?]+)(?:\?from=(pufus))?$/.exec(hash);
  if (detail) return `${base}/${detail[1]}s/${detail[2]}${detail[3] ? '?from=pufus' : ''}`;
  const view = hash.slice(1);
  return ['stocks', 'questions', 'pufus'].includes(view)
    ? `${base}${view === 'stocks' ? '' : `?view=${view}`}`
    : base;
}
export function publicHash(pathname: string, search: string, hash: string): string {
  if (hash) return hash;
  const match = publicPathPattern.exec(pathname);
  const query = new URLSearchParams(search);
  return match?.[2] && match[3]
    ? `#${match[2].slice(0, -1)}/${match[3]}${query.get('from') === 'pufus' ? '?from=pufus' : ''}`
    : `#${query.get('view') || 'stocks'}`;
}
