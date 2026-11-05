import { parseHTML } from 'linkedom';

// 明示された次ページだけを扱う。同じサイトの関連記事やコメント欄へは進まない。
export function nextArticlePage(html: string, current: URL): string | null {
  const { document } = parseHTML(html);
  const link =
    document.querySelector('link[rel~=next], a[rel~=next]') ??
    Array.from(document.querySelectorAll('a[href]')).find((a) =>
      /^(?:次へ|次のページ|次ページ|next(?: page)?)[\s›»→]*$/i.test(a.textContent?.trim() ?? ''),
    );
  const href = link?.getAttribute('href');
  if (!href) return null;
  try {
    return new URL(href, current).href;
  } catch {
    return href;
  }
}
export function isArticlePage(candidate: URL, first: URL): boolean {
  if (candidate.origin !== first.origin || candidate.username || candidate.password) return false;
  const root = first.pathname.replace(/\/page\/\d+\/?$/, '').replace(/\/$/, '');
  const path = candidate.pathname.replace(/\/$/, '');
  if (path !== root && !/^\/page\/\d+$/.test(path.slice(root.length))) return false;
  if (!path.startsWith(root)) return false;
  const stableQuery = (url: URL) => {
    const params = new URLSearchParams(url.search);
    for (const key of ['page']) params.delete(key);
    params.sort();
    return params.toString();
  };
  return stableQuery(candidate) === stableQuery(first);
}
