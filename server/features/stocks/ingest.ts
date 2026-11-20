import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom/worker';
import { isYouTubeUrl, youtubeUnavailableMessage } from '../../../shared/youtube';
import type { Env } from '../../env';
import { limitedBytes } from '../../infrastructure/limited-bytes';
import { assertPublicDestination, validateUrl } from '../../infrastructure/security';
import { fetchXPost, xPostId } from '../integrations/x';
import { isArticlePage, nextArticlePage } from './article-pages';
import { parsePdf } from './pdf/pdf-client';
import {
  crawlerName,
  createRobotsGuard,
  RobotsError,
  robotsPath,
  type RobotsGuard,
} from './robots';

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_ARTICLE_HTML_BYTES = 3 * 1024 * 1024;
const ARTICLE_HTML_TOO_LARGE = 'ページが大きすぎます（上限3MB）。';

function isHtmlContentType(contentType: string): boolean {
  return /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType);
}

export async function limitedText(response: Response): Promise<string> {
  return new TextDecoder().decode(
    await limitedBytes(response, MAX_TEXT_BYTES, 'ページが大きすぎます（上限2MB）。'),
  );
}

async function limitedArticleHtml(response: Response): Promise<string> {
  return new TextDecoder().decode(
    await limitedBytes(response, MAX_ARTICLE_HTML_BYTES, ARTICLE_HTML_TOO_LARGE),
  );
}
type ArticleContent = { title: string; text: string; ogImageUrl?: string };
export function extractHtml(html: string, url: string): ArticleContent {
  const { document } = parseHTML(html);
  let ogImageUrl: string | undefined;
  for (const selector of [
    'meta[property="og:image:secure_url"]',
    'meta[property="og:image"], meta[property="og:image:url"]',
    'meta[name="twitter:image"], meta[property="twitter:image"]',
  ]) {
    for (const meta of document.querySelectorAll(selector)) {
      const value = meta.getAttribute('content')?.trim();
      if (!value) continue;
      try {
        ogImageUrl = validateUrl(new URL(value, url).href).href;
        break;
      } catch {
        // Invalid preview metadata must not prevent article extraction.
      }
    }
    if (ogImageUrl) break;
  }
  const base = document.createElement('base');
  base.setAttribute('href', url);
  document.head.insertBefore(base, document.head.firstChild);
  const fallbackTitle = document.title || new URL(url).hostname;
  const parsed = new Readability(document as unknown as Document).parse();
  const text = (parsed?.textContent ?? document.querySelector('article, main')?.textContent ?? '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    title: (parsed?.title || fallbackTitle).trim().slice(0, 300),
    text,
    ...(ogImageUrl ? { ogImageUrl } : {}),
  };
}
async function renderHtml(
  env: Env,
  url: string,
  robots: RobotsGuard,
  deadline: number,
): Promise<string> {
  if (!env.BROWSER)
    throw new Error(
      '本文を取得できませんでした。JavaScript対応のBrowser Runを設定するか、別の公開URLをお試しください。',
    );
  const { launch } = await import('@cloudflare/playwright');
  const browser = await launch(env.BROWSER);
  const controller = new AbortController();
  let articleError: Error | undefined;
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    const page = await context.newPage();
    // 自動リダイレクトも含め、ブラウザのHTTPアクセスをWorkersの検証付き取得で代行する。
    await context.route('**/*', async (route) => {
      const request = route.request();
      const isMainDocument = () => {
        if (request.resourceType() !== 'document') return false;
        try {
          return request.frame() === page.mainFrame();
        } catch {
          // A navigation can start before Playwright has created its frame.
          return false;
        }
      };
      try {
        if (
          request.method() !== 'GET' ||
          ['image', 'media', 'font', 'stylesheet'].includes(request.resourceType())
        ) {
          await route.abort();
          return;
        }
        const { response } = await fetchPublic(request.url(), {
          robots,
          deadline,
          signal: controller.signal,
        });
        const contentType = response.headers.get('Content-Type') ?? 'text/plain';
        const body = await (isHtmlContentType(contentType) && isMainDocument()
          ? limitedArticleHtml(response)
          : limitedText(response));
        await route.fulfill({
          status: response.status,
          contentType,
          body,
        });
      } catch (error) {
        if (
          (error instanceof RobotsError && isMainDocument()) ||
          (error instanceof Error && error.message === ARTICLE_HTML_TOO_LARGE)
        )
          articleError = error;
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
    if (articleError) throw articleError;
    if (new TextEncoder().encode(html).byteLength > MAX_ARTICLE_HTML_BYTES)
      throw new Error(ARTICLE_HTML_TOO_LARGE);
    return html;
  } catch (error) {
    throw articleError ?? error;
  } finally {
    controller.abort();
    await browser.close();
  }
}
type FetchOptions = {
  guard?: (url: URL) => void;
  deadline?: number;
  accept?: string;
  robots?: RobotsGuard;
  signal?: AbortSignal;
};

async function fetchValidated(
  value: string,
  {
    guard,
    deadline = Date.now() + 120000,
    accept = 'text/html,application/pdf,text/plain;q=0.8,application/octet-stream;q=0.5',
    robots,
    signal,
  }: FetchOptions,
): Promise<{ response: Response; url: URL }> {
  let url = validateUrl(value);
  const timeout = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (let redirects = 0; redirects <= 5; redirects++) {
    guard?.(url);
    if (Date.now() >= deadline) throw new Error('記事取得の時間上限を超えました。');
    if (isYouTubeUrl(url.href)) throw new Error(youtubeUnavailableMessage);
    requestSignal.throwIfAborted();
    await robots?.(url, deadline, requestSignal);
    requestSignal.throwIfAborted();
    await assertPublicDestination(url, fetch, requestSignal);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('記事取得の時間上限を超えました。');
    // アプリのCookieやBearerトークンは取得先に一切渡さない。
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': `${crawlerName}/0.1 (personal article bookmarks)`,
        Accept: accept,
      },
      signal: AbortSignal.any([requestSignal, AbortSignal.timeout(Math.min(20000, remaining))]),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      await response.body?.cancel();
      if (!location || redirects === 5)
        throw new Error('リダイレクトが多すぎるか、移動先が無効です。');
      url = validateUrl(new URL(location, url).href);
      continue;
    }
    return { response, url };
  }
  throw new Error('リダイレクトを完了できませんでした。');
}

async function fetchRobots(target: URL, deadline: number, signal: AbortSignal): Promise<Response> {
  const targetPath = robotsPath(target);
  const { response } = await fetchValidated(`${target.origin}/robots.txt`, {
    deadline,
    signal,
    accept: 'text/plain, */*;q=0.1',
    guard: (url) => {
      if (url.origin === target.origin && robotsPath(url) === targetPath)
        throw new Error('robots.txt redirects to the article URL');
    },
  });
  return response;
}

export function fetchPublic(
  value: string,
  { robots = createRobotsGuard(fetchRobots), ...options }: FetchOptions = {},
) {
  return fetchValidated(value, { ...options, robots });
}

export async function fetchArticle(
  env: Env,
  value: string,
  userId?: string,
): Promise<ArticleContent & { pages?: string[]; complete?: boolean }> {
  const deadline = Date.now() + 60000;
  const postId = xPostId(validateUrl(value).href);
  if (postId) {
    if (!userId) throw new Error('Xの取得にはユーザー認証が必要です。');
    return fetchXPost(env, userId, postId);
  }
  const robots = createRobotsGuard(fetchRobots);
  const { response, url } = await fetchPublic(value, { deadline, robots });
  if (!response.ok)
    throw new Error(
      `本文を取得できませんでした（HTTP ${response.status}）。ログインやアクセス制限が必要なページは保存URLのみ保持します。`,
    );
  const contentType = response.headers.get('Content-Type') ?? '';
  if (/^application\/(pdf|octet-stream)(?:\s*;|$)/i.test(contentType)) {
    return parsePdf(env, response, url);
  }
  const isHtml = isHtmlContentType(contentType);
  if (!isHtml && !/^text\/plain(?:\s*;|$)/i.test(contentType))
    throw new Error('現在はHTML・テキスト・PDFの記事に対応しています。');
  let content = await (isHtml ? limitedArticleHtml(response) : limitedText(response));
  let result: ArticleContent = isHtml
    ? extractHtml(content, url.href)
    : { title: url.hostname, text: content.trim() };
  if (!result || result.text.length < 200) {
    content = await renderHtml(env, url.href, robots, deadline);
    const rendered = extractHtml(content, url.href);
    result = { ...rendered, ogImageUrl: rendered.ogImageUrl ?? result.ogImageUrl };
  }
  if (result.text.length < 200)
    throw new Error(
      '記事本文を十分に取得できませんでした。ログインやアクセス制限が必要な可能性があります。',
    );
  if (result.text.length > 120000)
    throw new Error('本文が長すぎます（上限12万文字）。URLは保存されています。');
  if (!isHtml) return result;
  let next = nextArticlePage(content, url);
  if (!next) return result;
  const pages = [url.href];
  const seen = new Set(pages);
  let complete = true;
  while (next) {
    try {
      if (pages.length >= 5) throw new Error('ページ数上限');
      const guard = (candidate: URL) => {
        if (!isArticlePage(candidate, url) || seen.has(candidate.href))
          throw new Error('同一記事の未取得ページではありません。');
      };
      const page = await fetchPublic(next, { guard, deadline, robots });
      if (!page.response.ok || !isHtmlContentType(page.response.headers.get('Content-Type') ?? ''))
        throw new Error('続きの本文を取得できませんでした。');
      const html = await limitedArticleHtml(page.response);
      const extracted = extractHtml(html, page.url.href);
      if (extracted.text.length < 200 || result.text.length + extracted.text.length + 2 > 120000)
        throw new Error('続きの本文の長さが取得条件を満たしません。');
      pages.push(page.url.href);
      seen.add(page.url.href);
      result = { ...result, text: `${result.text}\n\n${extracted.text}` };
      next = nextArticlePage(html, page.url);
    } catch {
      complete = false;
      break;
    }
  }
  return { ...result, pages, complete };
}
