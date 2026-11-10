// Imported only by the scratch Worker entry created by scripts/e2e/runtime.ts.
// Keep the real URL validation, extraction, Workflow, D1 and R2 paths; replace
// only outbound HTTP/DNS. No request is sent to example.com or a DNS service.
const articleText =
  'URLから取得した記事です。保存と要約を分離し、失敗後も同じストックで再試行します。'.repeat(12);
const releases = new Map<string, { ready: Promise<void>; release: () => void }>();
function gate(key: string) {
  let entry = releases.get(key);
  if (!entry) {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    entry = { ready, release };
    releases.set(key, entry);
  }
  return entry;
}

globalThis.fetch = async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    url.origin === 'https://cloudflare-dns.com' &&
    url.pathname === '/dns-query' &&
    url.searchParams.get('name') === 'example.com'
  ) {
    return Response.json({
      Status: 0,
      Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.215.14' }] : [],
    });
  }
  const key = url.searchParams.get('key') ?? '';
  if (
    url.origin !== 'https://example.com' ||
    url.pathname !== '/pufu-e2e/article' ||
    !/^[a-f0-9-]{36}$/.test(key)
  ) {
    throw new Error('E2Eではfixture以外の外部取得を許可しません。');
  }
  if (url.searchParams.get('fail') === 'true')
    return new Response('Fixture unavailable', { status: 503 });
  // The browser releases this after observing the actual extracting state.
  await gate(key).ready;
  return new Response(
    `<html lang="ja"><head><title>E2EのURL記事</title></head><body><article><h1>E2EのURL記事</h1><p>${articleText}</p></article></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
};

export function handleArticleControl(request: Request): Response | undefined {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/__e2e__\/articles\/([a-f0-9-]{36})\/release$/);
  if (!match) return;
  if (url.hostname !== '127.0.0.1' || request.method !== 'POST')
    return new Response(null, { status: 405 });
  gate(match[1]).release();
  return Response.json({ ok: true });
}
