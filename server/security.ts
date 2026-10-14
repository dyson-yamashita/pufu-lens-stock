import ipaddr from 'ipaddr.js';
import { HTTPException } from 'hono/http-exception';

export function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
export async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function publicIp(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export function validateUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HTTPException(400, { message: '有効な記事URLを入力してください。' });
  }
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (
    value.length > 4096 ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port)) ||
    (!host.includes('.') && !host.includes(':')) ||
    host === 'localhost' ||
    /\.(localhost|local|internal|test|example|invalid)$/.test(host) ||
    (ipaddr.isValid(host) && !publicIp(host))
  ) {
    throw new HTTPException(400, { message: '公開されているHTTP(S)の記事URLを指定してください。' });
  }
  url.hash = '';
  return url;
}
export function canonicalUrl(value: string): string {
  const url = validateUrl(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'msclkid'].includes(key.toLowerCase()))
      url.searchParams.delete(key);
  }
  return url.href;
}
export async function assertPublicDestination(
  url: URL,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  validateUrl(url.href);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (ipaddr.isValid(hostname)) return;
  const replies = await Promise.all(
    ['A', 'AAAA'].map(async (type) => {
      const endpoint = new URL('https://cloudflare-dns.com/dns-query');
      endpoint.searchParams.set('name', hostname);
      endpoint.searchParams.set('type', type);
      const response = await fetcher(endpoint, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('URLの接続先を確認できませんでした。');
      return response.json() as Promise<{
        Status: number;
        Answer?: { type: number; data: string }[];
      }>;
    }),
  );
  if (replies.some((r) => ![0, 3].includes(r.Status)))
    throw new Error('URLの接続先を確認できませんでした。');
  const addresses = replies
    .flatMap((r) => r.Answer ?? [])
    .filter((a) => a.type === 1 || a.type === 28);
  if (!addresses.length || addresses.some((a) => !publicIp(a.data)))
    throw new Error('公開ネットワーク以外へのアクセスはできません。');
}
