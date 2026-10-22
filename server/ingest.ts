import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { fetchXPost, xPostId } from './x';
import { isYouTubeUrl, youtubeUnavailableMessage } from '../shared/youtube';
import type { Env } from './env';
import { assertPublicDestination, validateUrl } from './security';

const MAX_BYTES = 2 * 1024 * 1024;
async function limitedBytes(response: Response, maxBytes = MAX_BYTES): Promise<Uint8Array> {
  const message =
    maxBytes === MAX_BYTES
      ? 'ページが大きすぎます（上限2MB）。'
      : 'PDFが大きすぎます（上限10MB）。';
  if (Number(response.headers.get('Content-Length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error(message);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(message);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } finally {
    await reader.cancel();
  }
}
export async function limitedText(response: Response): Promise<string> {
  return new TextDecoder().decode(await limitedBytes(response));
}
export function extractHtml(html: string, url: string): { title: string; text: string } {
  const { document } = parseHTML(html);
  const base = document.createElement('base');
  base.setAttribute('href', url);
  document.head.insertBefore(base, document.head.firstChild);
  const fallbackTitle = document.title || new URL(url).hostname;
  const parsed = new Readability(document as unknown as Document).parse();
  const text = (parsed?.textContent ?? document.querySelector('article, main')?.textContent ?? '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title: (parsed?.title || fallbackTitle).trim().slice(0, 300), text };
}
async function renderHtml(env: Env, url: string): Promise<string> {
  if (!env.BROWSER)
    throw new Error(
      '本文を取得できませんでした。JavaScript対応のBrowser Runを設定するか、別の公開URLをお試しください。',
    );
  const { launch } = await import('@cloudflare/playwright');
  const browser = await launch(env.BROWSER);
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    const page = await context.newPage();
    // 自動リダイレクトも含め、ブラウザのHTTPアクセスをWorkersの検証付き取得で代行する。
    await context.route('**/*', async (route) => {
      const request = route.request();
      try {
        if (
          request.method() !== 'GET' ||
          ['image', 'media', 'font', 'stylesheet'].includes(request.resourceType())
        ) {
          await route.abort();
          return;
        }
        const { response } = await fetchPublic(request.url());
        const body = await limitedText(response);
        await route.fulfill({
          status: response.status,
          contentType: response.headers.get('Content-Type') ?? 'text/plain',
          body,
        });
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (!response || !response.ok()) throw new Error('公開された本文を取得できませんでした。');
    await page.locator('article, main, body').first().waitFor({ timeout: 5000 });
    await page
      .waitForFunction(
        "(document.querySelector('article, main')?.textContent || '').length >= 200",
        null,
        { timeout: 5000 },
      )
      .catch(() => undefined);
    const html = await page.content();
    if (new TextEncoder().encode(html).byteLength > MAX_BYTES)
      throw new Error('ページが大きすぎます（上限2MB）。');
    return html;
  } finally {
    await browser.close();
  }
}
export async function fetchPublic(value: string): Promise<{ response: Response; url: URL }> {
  let url = validateUrl(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (isYouTubeUrl(url.href)) throw new Error(youtubeUnavailableMessage);
    await assertPublicDestination(url);
    // アプリのCookieやBearerトークンは取得先に一切渡さない。
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'PufuLens/0.1 (personal article bookmarks)',
        Accept: 'text/html,application/pdf,text/plain;q=0.8,application/octet-stream;q=0.5',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (!location || redirects === 5)
        throw new Error('リダイレクトが多すぎるか、移動先が無効です。');
      url = validateUrl(new URL(location, url).href);
      await response.body?.cancel();
      continue;
    }
    return { response, url };
  }
  throw new Error('リダイレクトを完了できませんでした。');
}
export async function fetchArticle(
  env: Env,
  value: string,
  userId?: string,
): Promise<{ title: string; text: string }> {
  const postId = xPostId(validateUrl(value).href);
  if (postId) {
    if (!userId) throw new Error('Xの取得にはユーザー認証が必要です。');
    return fetchXPost(env, userId, postId);
  }
  const { response, url } = await fetchPublic(value);
  if (!response.ok)
    throw new Error(
      `本文を取得できませんでした（HTTP ${response.status}）。ログインやアクセス制限が必要なページは保存URLのみ保持します。`,
    );
  const contentType = response.headers.get('Content-Type') ?? '';
  if (/^application\/(pdf|octet-stream)(?:\s*;|$)/i.test(contentType)) {
    const data = await limitedBytes(response, 10 * 1024 * 1024);
    const { extractPdf } = await import('./pdf');
    return extractPdf(data, url, env.ASSETS);
  }
  if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(contentType))
    throw new Error('現在はHTML・テキスト・PDFの記事に対応しています。');
  const content = await limitedText(response);
  let result = contentType.includes('text/plain')
    ? { title: url.hostname, text: content.trim() }
    : extractHtml(content, url.href);
  if (!result || result.text.length < 200)
    result = extractHtml(await renderHtml(env, url.href), url.href);
  if (result.text.length < 200)
    throw new Error(
      '記事本文を十分に取得できませんでした。ログインやアクセス制限が必要な可能性があります。',
    );
  if (result.text.length > 120000)
    throw new Error('本文が長すぎます（上限12万文字）。URLは保存されています。');
  return result;
}
