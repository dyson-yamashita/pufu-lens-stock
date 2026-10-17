import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { fetchXPost, xPostId } from './x';
import { fetchYouTubeVideo, youtubeVideoId } from './youtube';
import type { YouTubeMetadata } from '../shared/domain';
import type { Env } from './env';
import { assertPublicDestination, validateUrl } from './security';

const MAX_BYTES = 2 * 1024 * 1024;
export async function limitedText(response: Response): Promise<string> {
  if (Number(response.headers.get('Content-Length')) > MAX_BYTES)
    throw new Error('ページが大きすぎます（上限2MB）。');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('ページが大きすぎます（上限2MB）。');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
  }
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
    await assertPublicDestination(url);
    // アプリのCookieやBearerトークンは取得先に一切渡さない。
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'PufuLens/0.1 (personal article bookmarks)',
        Accept: 'text/html,text/plain;q=0.8',
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
): Promise<{ title: string; text: string; youtube?: YouTubeMetadata }> {
  const videoId = youtubeVideoId(validateUrl(value).href);
  if (videoId) return fetchYouTubeVideo(env, videoId);
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
  if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(contentType))
    throw new Error('現在はHTML・テキストの記事に対応しています。');
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
