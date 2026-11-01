import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { parseHTML } from 'linkedom';
import type { AppEnv } from './env';
import { documentSecureHeaders } from './document-headers';
import { publicProjectsApp, publicPufuWhere, publicQuestionWhere } from './public-projects';
import type {
  PublicProjectDetail,
  PublicList,
  PublicStock,
  PublicQuestion,
  PublicPufu,
  PublicPufuSummary,
  PublicStockDetail,
} from '../shared/public-project';
import { elementKeys, pufuDisplayTitle, type PufuScore } from '../shared/pufu';
import { publicPathPattern } from '../shared/public-route';
import { articleJsonLd } from '../shared/seo';
import { publicDocumentAssetPaths } from '../shared/public-document-routes';
import { homePath, legalPath, manualPath, siteOrigin } from '../shared/site-paths';

const publicApi = publicProjectsApp();
const sitemapSize = 1000;
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
const link = (href: string, text: string) => `<a href="${escape(href)}">${escape(text)}</a>`;
const paragraph = (text: string) => `<p>${escape(text)}</p>`;
function pageNumber(value: string | undefined) {
  const page = value === undefined ? 1 : Number(value);
  if (!Number.isInteger(page) || page < 1 || page > 5000) throw new HTTPException(400);
  return page;
}
async function readPublic<T>(c: Context<AppEnv>, path: string): Promise<T> {
  // Process-local call: no network, session, private API, or generation context.
  const response = await publicApi.request(
    new URL(`/projects/${path}`, c.env.APP_URL),
    {},
    c.env,
    c.executionCtx,
  );
  if (!response.ok)
    throw new HTTPException(response.status === 404 ? 404 : response.status === 400 ? 400 : 500);
  return response.json() as Promise<T>;
}
function stockText(stock: PublicStock) {
  const source =
    stock.source_url && /^https?:\/\//i.test(stock.source_url)
      ? link(stock.source_url, '出典を読む')
      : '';
  return `<article><h2>${escape(stock.title)}</h2>${paragraph(stock.summary?.overview ?? '')}<ul>${stock.summary?.keyPoints.map((point) => `<li>${escape(point)}</li>`).join('') ?? ''}</ul>${source}</article>`;
}
function pufuText(score: PufuScore) {
  const labels = ['人員', '予算', '時間', '品質', '商流', '環境', '競合', '外敵'];
  const nodes = [
    { label: '獲得目標', node: score.gainingGoal },
    { label: '勝利条件', node: score.winCondition },
    ...elementKeys.map((key, i) => ({ label: labels[i], node: score.elements[key] })),
    ...score.purposes.flatMap((purpose, i) => [
      { label: `中間目的 ${i + 1}`, node: purpose },
      ...purpose.measures.map((node, j) => ({ label: `施策 ${i + 1}.${j + 1}`, node })),
    ]),
  ];
  return `<dl>${nodes.map(({ label, node }) => `<dt>${label}</dt><dd>${paragraph(node.text)}${node.comment.text ? paragraph(node.comment.text) : ''}</dd>`).join('')}</dl>`;
}
function pagination(base: string, view: string, page: number, hasMore: boolean) {
  const href = (n: number) => `${base}?view=${view}&page=${n}`;
  return `<nav aria-label="ページ切替">${page > 1 ? link(href(page - 1), '前へ') : ''} ${hasMore ? link(href(page + 1), '次へ') : ''}</nav>`;
}
function errorPage(status: number, method: string) {
  const text =
    status === 404
      ? '公開されているページが見つかりません。'
      : status === 400
        ? 'URLを確認してください。'
        : 'ページを取得できませんでした。';
  return new Response(
    method === 'HEAD'
      ? null
      : `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="robots" content="noindex, follow"><title>${text}</title><body><main><h1>${text}</h1>${link('/', 'Pufu Lens')}</main></body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, follow',
      },
    },
  );
}

function lastmod(value: string | null | undefined): string {
  if (!value) return '';
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `<lastmod>${date}</lastmod>` : '';
}

function urlEntry(loc: string, modified?: string | null) {
  return `<url><loc>${escape(loc)}</loc>${lastmod(modified)}</url>`;
}

/** Rewrite built home HTML into a public page via DOM (no regex HTML "sanitization"). */
function assemblePublicDocument(
  template: string,
  options: {
    title: string;
    description: string;
    body: string;
    robots: string;
    canonical: string;
    ogType: string;
    ogImage: string;
    jsonLd?: unknown;
  },
): string {
  if (!template.includes('<!--public-root-start-->') || !template.includes('<!--public-root-end-->')) {
    throw new Error('Public HTML template markers unavailable');
  }
  const { document } = parseHTML(template);
  for (const el of document.querySelectorAll(
    'link[rel="canonical"], link[hreflang], script[type="application/ld+json"]',
  )) {
    el.remove();
  }
  document.title = options.title;
  let description = document.querySelector('meta[name="description"]');
  if (!description) {
    description = document.createElement('meta');
    description.setAttribute('name', 'description');
    document.head.appendChild(description);
  }
  description.setAttribute('content', options.description);
  const root = document.getElementById('root');
  if (!root) throw new Error('Public HTML template root unavailable');
  root.innerHTML = options.body;

  const appendMeta = (attrs: Record<string, string>) => {
    const meta = document.createElement('meta');
    for (const [key, value] of Object.entries(attrs)) meta.setAttribute(key, value);
    document.head.appendChild(meta);
  };
  appendMeta({ name: 'robots', content: options.robots });
  const canonical = document.createElement('link');
  canonical.setAttribute('rel', 'canonical');
  canonical.setAttribute('href', options.canonical);
  document.head.appendChild(canonical);
  appendMeta({ property: 'og:type', content: options.ogType });
  appendMeta({ property: 'og:site_name', content: 'Pufu Lens' });
  appendMeta({ property: 'og:title', content: options.title });
  appendMeta({ property: 'og:description', content: options.description });
  appendMeta({ property: 'og:url', content: options.canonical });
  appendMeta({ property: 'og:image', content: options.ogImage });
  if (options.jsonLd !== undefined) {
    const script = document.createElement('script');
    script.setAttribute('type', 'application/ld+json');
    script.textContent = JSON.stringify(options.jsonLd).replace(/</g, '\\u003c');
    document.head.appendChild(script);
  }
  return document.toString();
}

async function projectPage(c: Context<AppEnv>) {
  const match = publicPathPattern.exec(c.req.path);
  if (!match) throw new HTTPException(404);
  const [, key, kind, id] = match;
  const base = `/p/${key}`;
  const { project } = await readPublic<{ project: PublicProjectDetail }>(c, key);
  const page = pageNumber(c.req.query('page'));
  const query = new URLSearchParams();
  let title = project.name;
  let description = project.public_description || project.name;
  let content = '';
  let datePublished: string | null = null;
  let dateModified: string | null = null;
  if (kind === 'pufus') {
    const phase = c.req.query('phase');
    const { pufu } = await readPublic<{ pufu: PublicPufu }>(
      c,
      `${key}/pufus/${id}${phase === undefined ? '' : `?phase=${encodeURIComponent(phase)}`}`,
    );
    title = `${pufuDisplayTitle(pufu)} | ${project.name}`;
    description = pufu.task;
    dateModified = pufu.updated_at;
    content = `<h2>${escape(pufuDisplayTitle(pufu))}</h2>${paragraph(pufu.task)}<p>第${pufu.phase}局面</p>${pufuText(pufu.score)}<h2>関連する問い</h2><ul>${(pufu.questions ?? []).map((q) => `<li>${link(`${base}/questions/${encodeURIComponent(q.id)}`, q.text)}</li>`).join('')}</ul>`;
  } else if (kind === 'questions') {
    const result = await readPublic<{
      question: PublicQuestion;
      stocks: PublicStock[];
      pufus: PublicPufuSummary[];
      has_more: boolean;
    }>(c, `${key}/questions/${id}?page=${page}`);
    title = `${result.question.text} | ${project.name}`;
    description = result.question.text;
    datePublished = result.question.created_at;
    content = `<h2>${escape(result.question.text)}</h2><h3>関連するストック</h3><ul>${result.stocks.map((s) => `<li>${link(`${base}/stocks/${encodeURIComponent(s.id)}`, s.title)}</li>`).join('')}</ul><h3>関連するプ譜</h3><ul>${result.pufus.map((p) => `<li>${link(`${base}/pufus/${encodeURIComponent(p.id)}`, pufuDisplayTitle(p))}</li>`).join('')}</ul>${pagination(`${base}/questions/${id}`, 'questions', page, result.has_more)}`;
  } else if (kind === 'stocks') {
    const result = await readPublic<PublicStockDetail>(c, `${key}/stocks/${id}?page=${page}`);
    title = `${result.stock.title} | ${project.name}`;
    description = result.stock.summary?.overview || result.stock.title;
    datePublished = result.stock.created_at;
    content = `${stockText(result.stock)}<h3>関連する問い</h3><ul>${result.questions.map((q) => `<li>${link(`${base}/questions/${encodeURIComponent(q.id)}`, q.text)}</li>`).join('')}</ul>${pagination(`${base}/stocks/${id}`, 'stocks', page, result.has_more)}`;
  } else {
    const view = c.req.query('view') ?? 'stocks';
    if (!['stocks', 'questions', 'pufus'].includes(view)) throw new HTTPException(400);
    if (view !== 'stocks') query.set('view', view);
    if (view === 'pufus') {
      const result = await readPublic<PublicList<PublicPufuSummary>>(
        c,
        `${key}/pufus?page=${page}`,
      );
      content = `<h2>プ譜</h2><ul>${result.items.map((p) => `<li>${link(`${base}/pufus/${encodeURIComponent(p.id)}`, pufuDisplayTitle(p))}</li>`).join('')}</ul>${pagination(base, view, page, result.has_more)}`;
    } else if (view === 'questions') {
      const result = await readPublic<PublicList<PublicQuestion>>(
        c,
        `${key}/questions?page=${page}`,
      );
      content = `<h2>問い・気づき</h2><ul>${result.items.map((q) => `<li>${link(`${base}/questions/${encodeURIComponent(q.id)}`, q.text)}</li>`).join('')}</ul>${pagination(base, view, page, result.has_more)}`;
    } else {
      const result = await readPublic<PublicList<PublicStock>>(c, `${key}/stocks?page=${page}`);
      content = `<h2>ストック</h2>${result.items.map((s) => `${link(`${base}/stocks/${encodeURIComponent(s.id)}`, s.title)}${stockText(s)}`).join('')}${pagination(base, view, page, result.has_more)}`;
    }
  }
  if (page > 1) query.set('page', String(page));
  const canonical = new URL(
    `${base}${kind ? `/${kind}/${id}` : ''}${query.size ? `?${query}` : ''}`,
    c.env.APP_URL,
  ).href;
  const indexable = Boolean(project.search_indexable) && c.req.query('phase') === undefined;
  const robots = indexable ? 'index, follow' : 'noindex, follow';
  const fullTitle = `${title} | Pufu Lens`;
  const shortDescription = description.replace(/\s+/g, ' ').slice(0, 200);
  const jsonLd =
    kind === 'questions' || kind === 'pufus' || kind === 'stocks'
      ? articleJsonLd({
          url: canonical,
          title: fullTitle,
          description: shortDescription,
          datePublished,
          dateModified: dateModified ?? datePublished,
          origin: c.env.APP_URL,
        })
      : undefined;
  if (!c.env.ASSETS) throw new Error('Public assets binding unavailable');
  const assets = await c.env.ASSETS.fetch(new Request(new URL('/', c.env.APP_URL)));
  if (!assets.ok) throw new Error('Public HTML template unavailable');
  const template = await assets.text();
  const body = `<div class="public-page"><header class="public-header">${link('/', 'Pufu Lens')}</header><main class="public-main"><h1>${escape(project.name)}</h1>${paragraph(project.public_description)}<nav>${link(base, 'ストック')} ${link(`${base}?view=questions`, '問い・気づき')} ${link(`${base}?view=pufus`, 'プ譜')}</nav>${content}</main></div>`;
  // Built home HTML may already carry canonical/hreflang/JSON-LD; remove those nodes
  // via DOM and set page-specific title/description/meta (avoids regex HTML sanitization).
  const document = assemblePublicDocument(template, {
    title: fullTitle,
    description: shortDescription,
    body,
    robots,
    canonical,
    ogType: kind ? 'article' : 'website',
    ogImage: new URL('/pufu-lens-logo.png', c.env.APP_URL).href,
    jsonLd,
  });
  c.header('X-Robots-Tag', robots);
  return c.html(document);
}

/** Serve a built static document through the Worker so secureHeaders apply. */
async function assetDocument(c: Context<AppEnv>, assetPath: string) {
  if (!c.env.ASSETS) throw new HTTPException(503, { message: 'Document unavailable.' });
  const assetUrl = new URL(assetPath, c.req.url);
  const asset = await c.env.ASSETS.fetch(new Request(assetUrl, c.req.raw));
  if (asset.status === 404) throw new HTTPException(404);
  const response = new Response(c.req.method === 'HEAD' ? null : asset.body, asset);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function llmsTxt(origin: string): string {
  const root = siteOrigin(origin);
  return `# Pufu Lens

> Pufu Lens helps people save articles and text as Stocks, organize them in projects, and grow questions, insights, Memory, and Pufu diagrams with AI.

Pufu Lens is a web app at ${root}/. Product terms: Stock, Pufu, Memory, MCP.

## Languages

- Japanese (default): ${root}/ , ${root}/manual , ${root}/privacy , ${root}/terms
- English: ${root}/en , ${root}/en/manual , ${root}/en/privacy , ${root}/en/terms
- Language is selected by URL. Responses do not auto-redirect based on Accept-Language.

## Key public paths

- Home: ${root}/ and ${root}/en
- User manual: ${root}/manual and ${root}/en/manual
- Public projects: ${root}/p/<public-id>
- Public stocks / questions / Pufu: ${root}/p/<public-id>/stocks/<id> , .../questions/<id> , .../pufus/<id>
- Privacy / Terms: ${root}/privacy , ${root}/terms and /en/... variants
- Sitemap: ${root}/sitemap.xml
- Robots: ${root}/robots.txt

## Optional

- Only projects that owners publish and mark search-indexable appear in the sitemap.
- Public pages expose title, description, canonical, Open Graph, and JSON-LD where applicable.
`;
}

const eligible = 'p.is_public=1 AND p.search_indexable=1';
const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>${body}`;
const xmlHeaders = { 'Content-Type': 'application/xml; charset=utf-8' };

export function publicPagesApp() {
  const app = new Hono<AppEnv>();
  // Same secureHeaders() defaults as before for /p/* — HSTS, X-Frame-Options, CORP/COOP, etc.
  app.use('*', documentSecureHeaders());
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.onError((error, c) => {
    if (!(error instanceof HTTPException)) console.error('public_page_failed');
    return errorPage(error instanceof HTTPException ? error.status : 500, c.req.method);
  });

  app.on(['GET', 'HEAD'], '/llms.txt', (c) =>
    c.text(llmsTxt(c.env.APP_URL), 200, { 'Content-Type': 'text/plain; charset=utf-8' }),
  );

  for (const [path, assetPath] of Object.entries(publicDocumentAssetPaths)) {
    app.on(['GET', 'HEAD'], path, (c) => assetDocument(c, assetPath));
  }

  app.get('/p/*', projectPage);
  app.get('/robots.txt', (c) =>
    c.text(`User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', c.env.APP_URL).href}\n`),
  );
  app.get('/sitemap.xml', async (c) => {
    const origin = c.env.APP_URL;
    const rows = await c.env.DB.prepare(
      `SELECT p.public_id,'project' AS kind,0 AS bucket
      FROM projects p WHERE ${eligible}
      UNION ALL SELECT p.public_id,'questions' AS kind,CAST((q.rowid-1)/${sitemapSize} AS INTEGER)+1 AS bucket
      FROM projects p JOIN questions q INDEXED BY public_search_questions_project ON q.project_id=p.id
      WHERE ${eligible} AND ${publicQuestionWhere} GROUP BY p.public_id,bucket
      UNION ALL SELECT p.public_id,'pufus' AS kind,CAST((pf.rowid-1)/${sitemapSize} AS INTEGER)+1 AS bucket
      FROM projects p JOIN pufu_scores pf INDEXED BY public_search_pufus_project ON pf.project_id=p.id
      WHERE ${eligible} AND ${publicPufuWhere} GROUP BY p.public_id,bucket
      UNION ALL SELECT p.public_id,'stocks' AS kind,CAST((s.rowid-1)/${sitemapSize} AS INTEGER)+1 AS bucket
      FROM projects p JOIN stocks s INDEXED BY public_search_stocks_project ON s.project_id=p.id
      WHERE ${eligible} GROUP BY p.public_id,bucket
      LIMIT 50001`,
    ).all<{ public_id: string; kind: string; bucket: number }>();
    if (rows.results.length > 50000) throw new Error('Sitemap index capacity exceeded');
    const files = [
      `<sitemap><loc>${escape(new URL('/sitemaps/site.xml', origin).href)}</loc></sitemap>`,
      ...rows.results.map((row) => {
        const root = `/sitemaps/${encodeURIComponent(row.public_id)}`;
        const file = row.kind === 'project' ? 'project.xml' : `${row.kind}-${row.bucket}.xml`;
        return `<sitemap><loc>${escape(new URL(`${root}/${file}`, origin).href)}</loc></sitemap>`;
      }),
    ];
    return c.body(
      xml(
        `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.join('')}</sitemapindex>`,
      ),
      200,
      xmlHeaders,
    );
  });
  app.get('/sitemaps/site.xml', (c) => {
    const origin = c.env.APP_URL;
    const paths = [
      homePath('ja'),
      homePath('en'),
      manualPath('ja'),
      manualPath('en'),
      legalPath('privacy', 'ja'),
      legalPath('privacy', 'en'),
      legalPath('terms', 'ja'),
      legalPath('terms', 'en'),
    ];
    return c.body(
      xml(
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths
          .map((path) => urlEntry(new URL(path === '/' ? '/' : path, origin).href))
          .join('')}</urlset>`,
      ),
      200,
      xmlHeaders,
    );
  });
  app.get('/sitemaps/:key/:file', async (c) => {
    const key = c.req.param('key');
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new HTTPException(404);
    const project = await c.env.DB.prepare(
      `SELECT p.id FROM projects p WHERE p.public_id=? AND ${eligible}`,
    )
      .bind(key)
      .first<{ id: string }>();
    if (!project) throw new HTTPException(404);
    const file = c.req.param('file');
    const origin = c.env.APP_URL;
    if (file === 'project.xml') {
      return c.body(
        xml(
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urlEntry(new URL(`/p/${encodeURIComponent(key)}`, origin).href)}</urlset>`,
        ),
        200,
        xmlHeaders,
      );
    }
    const match = /^(questions|pufus|stocks)-([1-9]\d*)\.xml$/.exec(file);
    if (!match) throw new HTTPException(404);
    const bucket = Number(match[2]);
    const upper = bucket * sitemapSize + 1;
    if (!Number.isSafeInteger(upper)) throw new HTTPException(404);
    const lower = upper - sitemapSize;
    const kind = match[1];
    const rows =
      kind === 'questions'
        ? await c.env.DB.prepare(
            `SELECT q.id,q.created_at AS modified FROM questions q INDEXED BY public_search_questions_project JOIN projects p ON p.id=q.project_id WHERE q.project_id=? AND q.rowid>=? AND q.rowid<? AND ${eligible} AND ${publicQuestionWhere} LIMIT ?`,
          )
            .bind(project.id, lower, upper, sitemapSize)
            .all<{ id: string; modified: string }>()
        : kind === 'pufus'
          ? await c.env.DB.prepare(
              `SELECT pf.id,pf.updated_at AS modified FROM pufu_scores pf INDEXED BY public_search_pufus_project JOIN projects p ON p.id=pf.project_id WHERE pf.project_id=? AND pf.rowid>=? AND pf.rowid<? AND ${eligible} AND ${publicPufuWhere} LIMIT ?`,
            )
              .bind(project.id, lower, upper, sitemapSize)
              .all<{ id: string; modified: string }>()
          : await c.env.DB.prepare(
              `SELECT s.id,s.created_at AS modified FROM stocks s INDEXED BY public_search_stocks_project JOIN projects p ON p.id=s.project_id WHERE s.project_id=? AND s.rowid>=? AND s.rowid<? AND ${eligible} LIMIT ?`,
            )
              .bind(project.id, lower, upper, sitemapSize)
              .all<{ id: string; modified: string }>();
    const entries = rows.results.map((row) =>
      urlEntry(
        new URL(`/p/${encodeURIComponent(key)}/${kind}/${encodeURIComponent(row.id)}`, origin).href,
        row.modified,
      ),
    );
    return c.body(
      xml(
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</urlset>`,
      ),
      200,
      xmlHeaders,
    );
  });
  app.notFound((c) => errorPage(404, c.req.method));
  return app;
}
