import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import worker from '../server/index';
import { publicViewsCron } from '../server/features/public-projects/public-views';
import { testApp } from './helpers';
import { socialImagePath } from '../scripts/social-image';
import type { Publication } from '../shared/public-project';
let app: Awaited<ReturnType<typeof testApp>>;
let key: string;
const read = (path: string, method = 'GET') =>
  worker.fetch(new Request(`https://untrusted.example${path}`, { method }), app.env, app.ctx);
beforeEach(async () => {
  app = await testApp();
  const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  app.env.ASSETS = {
    fetch: async (request: Request) =>
      new URL(request.url).pathname === '/index.html'
        ? Response.redirect(`${app.env.APP_URL}/`, 307)
        : new Response(template),
  } as unknown as Fetcher;
  const published = await app.request('/api/v1/projects/alice-project/publication', {
    method: 'PATCH',
    body: { is_public: true, public_description: '公開紹介 <script>alert(1)</script>' },
  });
  key = ((await published.json()) as { publication: { public_id: string } }).publication.public_id;
  const score = JSON.parse(
    await readFile(new URL('./fixtures/pufu-sparse.json', import.meta.url), 'utf8'),
  );
  score.gainingGoal.text = '公開された目標 <img src=x onerror=alert(1)>';
  await app.env.DB.batch([
    app.env.DB.prepare(
      "UPDATE projects SET description='PRIVATE_DESCRIPTION' WHERE id='alice-project'",
    ),
    app.env.DB.prepare(
      "INSERT INTO questions (id,project_id,source,text,status) VALUES ('q','alice-project','user','実践の問い？','ready'),('hidden','alice-second','user','PRIVATE_QUESTION','ready')",
    ),
    app.env.DB.prepare(
      "INSERT INTO articles (id,user_id,canonical_url,source_url,domain,title,status,summary_json) VALUES ('article','alice','https://example.com/a','https://example.com/a','example.com','公開ストック','ready','{\"overview\":\"概要\",\"keyPoints\":[\"要点\"],\"topics\":[\"topic\"]}')",
    ),
    app.env.DB.prepare(
      "INSERT INTO stocks (id,user_id,project_id,article_id,created_at) VALUES ('stock','alice','alice-project','article','2026-10-28T00:00:00.000Z')",
    ),
    app.env.DB.prepare(
      "INSERT INTO pufu_scores (id,user_id,project_id,task,input_json,score_json,editor_version,status,current_phase,updated_at) VALUES ('pf','alice','alice-project','公開された課題','{\"memory\":\"PRIVATE_MEMORY\"}',?,'0.9.19','ready',1,'2026-10-29T00:00:00.000Z')",
    ).bind(JSON.stringify(score)),
    app.env.DB.prepare("INSERT INTO pufu_questions (pufu_id,question_id) VALUES ('pf','q')"),
  ]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.dispose();
});
async function allow(value = true) {
  await app.request('/api/v1/projects/alice-project/publication', {
    method: 'PATCH',
    body: { is_public: true, search_indexable: value, public_description: '紹介文' },
  });
}
it('公開本文と個別リンクを初期HTMLで返し、検索掲載は初期OFF、HEADも同じ制御になる', async () => {
  const res = await read(`/p/${key}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('text/html');
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(res.headers.get('X-Robots-Tag')).toBe('noindex, follow');
  const html = await res.text();
  const { document } = parseHTML(html);
  expect(document.querySelector('h1')?.textContent).toBe('Alice project');
  expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toContain(
    '公開紹介',
  );
  expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
    `${app.env.APP_URL}/p/${key}`,
  );
  expect(html).not.toContain('PRIVATE_');
  expect(document.querySelector('#root script')).toBeNull();
  expect(document.querySelector('a[href*="view=questions"]')).not.toBeNull();
  const questions = await read(`/p/${key}?view=questions`);
  expect(await questions.text()).toContain(`/p/${key}/questions/q`);
  const pufus = await read(`/p/${key}?view=pufus`);
  expect(await pufus.text()).toContain(`/p/${key}/pufus/pf`);
  const head = await read(`/p/${key}`, 'HEAD');
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect(head.headers.get('X-Robots-Tag')).toBe('noindex, follow');
});
it('プ譜と問いの個別URLは本文、固有title、OGPを返し、利用者入力をエスケープする', async () => {
  await allow();
  const res = await read(`/p/${key}/pufus/pf?tracking=ignored`);
  expect(res.status).toBe(200);
  expect(res.headers.get('X-Robots-Tag')).toBe('index, follow');
  expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
  expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  const html = await res.text();
  const { document } = parseHTML(html);
  expect(html).toContain('公開された目標');
  expect(html).not.toContain('PRIVATE_');
  expect(document.querySelector('#root img[onerror]')).toBeNull();
  expect(document.querySelector('title')?.textContent).toContain('公開された課題');
  expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(
    `${app.env.APP_URL}/p/${key}/pufus/pf`,
  );
  expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(
    `${app.env.APP_URL}${socialImagePath}`,
  );
  const question = await read(`/p/${key}/questions/q`);
  expect(await question.text()).toContain('実践の問い？');
});
it('titleに</title>を含む公開名でもtitle要素を破れない', async () => {
  await app.env.DB.prepare("UPDATE projects SET name=? WHERE id='alice-project'")
    .bind('Alice</title><script>alert(1)</script>')
    .run();
  await allow();
  const html = await (await read(`/p/${key}`)).text();
  const titleTag = html.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '';
  expect(titleTag).toContain('Alice&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(titleTag).not.toContain('<script>');
  const { document } = parseHTML(html);
  expect(document.querySelectorAll('title')).toHaveLength(1);
  expect(document.querySelector('title')?.textContent).toContain(
    'Alice</title><script>alert(1)</script>',
  );
  expect(
    document.querySelector('head script:not([src]):not([type="application/ld+json"])'),
  ).toBeNull();
});
it.each([
  '/questions/hidden',
  '/pufus/missing',
  '/pufus/pf?phase=2',
  '/pufus/pf?phase=bad',
  '/unknown',
])('不正な公開対象をSPAの200にしない: %s', async (suffix) => {
  const res = await read(`/p/${key}${suffix}`);
  expect([400, 404]).toContain(res.status);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(res.headers.get('X-Robots-Tag')).toBe('noindex, follow');
  const html = await res.text();
  expect(html).not.toContain('PRIVATE_');
  expect(html).not.toContain('公開された課題');
});
it('掲載解除・非公開化・削除後の取得で古い本文やOGPを再利用しない', async () => {
  await allow();
  expect((await read(`/p/${key}/pufus/pf`)).status).toBe(200);
  await allow(false);
  expect((await read(`/p/${key}/pufus/pf`)).headers.get('X-Robots-Tag')).toBe('noindex, follow');
  await app.request('/api/v1/projects/alice-project/publication', {
    method: 'PATCH',
    body: { is_public: false, public_description: '' },
  });
  for (const suffix of ['', '/questions/q', '/pufus/pf']) {
    const res = await read(`/p/${key}${suffix}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toContain('公開された目標');
    expect(html).not.toContain('og:');
  }
  expect((await read(`/p/${key}/pufus/pf`, 'HEAD')).status).toBe(404);
});
async function sitemapUrls() {
  const index = await (await read('/sitemap.xml')).text();
  return [...index.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
}
it('robotsと分割サイトマップには掲載を許可した公開ページだけを載せる', async () => {
  const robots = await read('/robots.txt');
  expect(robots.status).toBe(200);
  expect(await robots.text()).toContain(`Sitemap: ${app.env.APP_URL}/sitemap.xml`);
  expect(await sitemapUrls()).toEqual(['/sitemaps/site.xml']);
  await allow();
  const paths = await sitemapUrls();
  expect(paths).toEqual(
    expect.arrayContaining([
      '/sitemaps/site.xml',
      `/sitemaps/${key}/project.xml`,
      `/sitemaps/${key}/questions-1.xml`,
      `/sitemaps/${key}/pufus-1.xml`,
      `/sitemaps/${key}/stocks-1.xml`,
    ]),
  );
  const xml = (await Promise.all(paths.map(async (path) => (await read(path)).text()))).join('');
  expect(xml).toContain(`${app.env.APP_URL}/p/${key}</loc>`);
  expect(xml).toContain(`/p/${key}/questions/q</loc>`);
  expect(xml).toContain(`/p/${key}/pufus/pf</loc>`);
  expect(xml).toContain(`/p/${key}/stocks/`);
  expect(xml).toContain('<lastmod>');
  expect(xml).toContain(`${app.env.APP_URL}/manual</loc>`);
  expect(xml).toContain(`${app.env.APP_URL}/faq</loc>`);
  expect(xml).toContain(`${app.env.APP_URL}/en/faq</loc>`);
  expect(xml).not.toContain('hidden');
  await allow(false);
  expect(await sitemapUrls()).toEqual(['/sitemaps/site.xml']);
  for (const path of paths.filter((path) => path !== '/sitemaps/site.xml'))
    expect((await read(path)).status).toBe(404);
  expect((await read(`/sitemaps/${key}/questions-0.xml`)).status).toBe(404);
  expect((await read(`/sitemaps/${key}/questions-9007199254740991.xml`)).status).toBe(404);
});
it('サイトマップを固定範囲1000行以下で分割し、削除したプ譜を残さない', async () => {
  await allow();
  await app.env.DB.prepare(
    `WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<1000)
    INSERT INTO questions(id,project_id,source,text,status) SELECT 'many-'||n,'alice-project','user','問い'||n,'ready' FROM nums`,
  ).run();
  const paths = await sitemapUrls();
  const all: string[] = [];
  for (const path of paths) {
    const xml = await (await read(path)).text();
    const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
    expect(urls.length).toBeLessThanOrEqual(1000);
    all.push(...urls);
  }
  // site.xml (10) + project + 1001 questions + 1 pufu + existing stocks in fixture
  expect(all.length).toBeGreaterThanOrEqual(1003 + 10);
  expect(paths).toContain(`/sitemaps/${key}/questions-2.xml`);
  await app.env.DB.prepare("DELETE FROM pufu_scores WHERE id='pf'").run();
  expect((await read(`/p/${key}/pufus/pf`)).status).toBe(404);
  expect(await (await read(`/sitemaps/${key}/pufus-1.xml`)).text()).not.toContain('/pufus/pf');
  // The project-only indexes also include SQLite's rowid, so both range bounds are seekable.
  const plan = await app.env.DB.prepare(
    'EXPLAIN QUERY PLAN SELECT id FROM questions INDEXED BY public_search_questions_project WHERE project_id=? AND rowid>=? AND rowid<?',
  )
    .bind('alice-project', 1, 1001)
    .all<{ detail: string }>();
  expect(plan.results.some((row) => row.detail.includes('rowid>? AND rowid<?'))).toBe(true);
});

it('別プロジェクトの大量挿入によるrowidの隙間を空サイトマップとして列挙しない', async () => {
  await allow();
  await app.env.DB.batch([
    app.env.DB.prepare(
      "INSERT INTO questions(rowid,id,project_id,source,text,status) VALUES (50000001,'large-private','alice-second','user','PRIVATE','ready')",
    ),
    app.env.DB.prepare(
      "INSERT INTO questions(id,project_id,source,text,status) VALUES ('after-gap','alice-project','user','追加の公開問い','ready')",
    ),
  ]);
  const response = await read('/sitemap.xml');
  expect(response.status).toBe(200);
  const paths = await sitemapUrls();
  expect(paths).toContain('/sitemaps/site.xml');
  expect(paths).toContain(`/sitemaps/${key}/questions-50001.xml`);
  expect(await (await read(`/sitemaps/${key}/questions-50001.xml`)).text()).toContain(
    '/questions/after-gap',
  );
});

it('問い・プ譜・ストックHTMLにArticle JSON-LDを埋め込み、llms.txtと不明URLのhard 404にセキュリティヘッダーを付ける', async () => {
  await allow();
  const question = await read(`/p/${key}/questions/q`);
  expect(question.headers.get('Strict-Transport-Security')).toContain('max-age=');
  expect(question.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  const questionHtml = await question.text();
  expect(questionHtml).toContain('application/ld+json');
  expect(questionHtml).toContain('"@type":"Article"');
  const pufu = await read(`/p/${key}/pufus/pf`);
  expect(pufu.headers.get('X-Robots-Tag')).toBe('index, follow');
  expect(await pufu.text()).toContain('"@type":"Article"');
  const stock = await read(`/p/${key}/stocks/stock`);
  expect(stock.status).toBe(200);
  expect(stock.headers.get('X-Robots-Tag')).toBe('index, follow');
  expect(stock.headers.get('Strict-Transport-Security')).toContain('max-age=');
  expect(await stock.text()).toContain('"@type":"Article"');
  const home = await read('/');
  expect(home.status).toBe(200);
  expect(home.headers.get('Strict-Transport-Security')).toContain('max-age=');
  expect(home.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  const manual = await read('/manual');
  expect(manual.headers.get('Strict-Transport-Security')).toContain('max-age=');
  for (const path of ['/faq', '/faq/', '/en/faq', '/en/faq/']) {
    const faq = await read(path);
    expect(faq.status).toBe(200);
    expect(faq.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(faq.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect((await read(path, 'HEAD')).status).toBe(200);
  }
  const english = await read('/en');
  expect(english.headers.get('Strict-Transport-Security')).toContain('max-age=');
  const llms = await read('/llms.txt');
  expect(llms.status).toBe(200);
  expect(llms.headers.get('Strict-Transport-Security')).toContain('max-age=');
  const llmsText = await llms.text();
  expect(llmsText).toContain('Sitemap:');
  expect(llmsText).toContain('/en/manual');
  const missing = await read('/this-page-does-not-exist');
  expect(missing.status).toBe(404);
  expect(missing.headers.get('Strict-Transport-Security')).toContain('max-age=');
  expect(missing.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
});

it('本文採用モードの原文全体を公開HTMLへ安全に表示する', async () => {
  const text =
    '\n  原文 <img src=x onerror=alert(1)>\n https://example.com/a?x=1&y=2。 javascript:alert(1)\n' +
    '本文の内容。'.repeat(400) +
    '\n  ';
  await app.env.DB.prepare(
    "UPDATE articles SET skip_summary = 1, summary_json = ? WHERE id = 'article'",
  )
    .bind(JSON.stringify({ overview: text, keyPoints: [], topics: [], verbatim: true }))
    .run();
  for (const path of [`/p/${key}?view=stocks`, `/p/${key}/stocks/stock`]) {
    const response = await read(path);
    expect(response.status).toBe(200);
    const html = await response.text();
    const { document } = parseHTML(html);
    expect(html).toContain('公開ストック');
    expect(document.querySelector('#root article .public-summary')?.textContent).toBe(text);
    const links = document.querySelectorAll('#root article .public-summary a');
    if (path.endsWith('?view=stocks')) expect(links).toHaveLength(0);
    else {
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute('href')).toBe('https://example.com/a?x=1&y=2');
      expect(links[0].getAttribute('target')).toBe('_blank');
      expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(document.querySelector('#root article')?.classList.contains('public-stock-card')).toBe(
      path.endsWith('?view=stocks'),
    );
    expect(document.querySelector('#root img[onerror]')).toBeNull();
    expect(document.querySelector('#root article ul')).toBeNull();
    expect(html).not.toContain('PRIVATE_');
  }
  const result = await app.request('/api/v1/projects/alice-project/publication', {
    method: 'PATCH',
    body: { is_public: false, public_description: '' },
  });
  expect(result.status).toBe(200);
  expect((await read(`/p/${key}/stocks/stock`)).status).toBe(404);
});

it('画面遷移の総回数を日次で確定し、各公開画面と所有者の設定に返す', async () => {
  const browserHeaders = { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' };
  const background: Promise<unknown>[] = [];
  const ctx = { ...app.ctx, waitUntil: (work: Promise<unknown>) => background.push(work) };
  const base = `/p/${key}`;
  const api = `/api/public/projects/${key}`;
  const navigate = (path: string, headers: HeadersInit = browserHeaders, method = 'GET') =>
    worker.fetch(new Request(`${app.env.APP_URL}${path}`, { method, headers }), app.env, ctx);
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const afterDay = now + 24 * 60 * 60 * 1000;
  const aggregate = async (scheduledTime: number) => {
    worker.scheduled({ scheduledTime, cron: publicViewsCron } as ScheduledController, app.env, ctx);
    await Promise.all(background.splice(0));
  };
  const publication = '/api/v1/projects/alice-project/publication';
  const readStats = async () =>
    ((await (await app.request(publication)).json()) as { publication: Publication }).publication
      .view_stats;
  for (const suffix of [
    '',
    '?view=questions',
    '/stocks/stock',
    '/stocks/stock',
    '/questions/q',
    '/pufus/pf',
  ])
    expect((await navigate(base + suffix)).status).toBe(200);
  expect((await navigate(base, browserHeaders, 'HEAD')).status).toBe(200);
  expect((await navigate(base, { ...browserHeaders, 'Sec-Purpose': 'prefetch' })).status).toBe(200);
  expect((await navigate(base + '/stocks/stock', { 'Sec-Fetch-Mode': 'cors' })).status).toBe(200);
  expect((await navigate(base + '/questions/hidden')).status).toBe(404);
  expect((await navigate(api + '/pufus/pf?phase=1')).status).toBe(200);
  await Promise.all(background.splice(0));

  await aggregate(now);
  expect(await readStats()).toEqual({
    totals: { project: 0, stocks: 0, questions: 0, pufus: 0 },
    top: [],
  });
  await aggregate(afterDay);
  await aggregate(afterDay);
  const counts = await readStats();
  expect(counts).toEqual({
    totals: { project: 2, stocks: 2, questions: 1, pufus: 1 },
    top: [
      { kind: 'stocks', id: 'stock', title: '公開ストック', views: 2 },
      { kind: 'pufus', id: 'pf', title: '公開された課題', views: 1 },
      { kind: 'questions', id: 'q', title: '実践の問い？', views: 1 },
    ],
  });
  expect(await (await app.request(api)).json()).toMatchObject({ project: { view_count: 2 } });
  expect(await (await app.request('/api/public/projects')).json()).toMatchObject({
    items: [{ view_count: 2 }],
  });
  for (const [kind, views] of [
    ['stocks', 2],
    ['questions', 1],
    ['pufus', 1],
  ] as const)
    expect(await (await app.request(`${api}/${kind}`)).json()).toMatchObject({
      items: [{ view_count: views }],
    });
  expect((await app.request(publication, { user: 'bob' })).status).toBe(404);
  const privateResult = await app.request(publication, {
    method: 'PATCH',
    body: { is_public: false, public_description: '' },
  });
  expect(await privateResult.json()).toMatchObject({ publication: { view_stats: null } });
  expect((await navigate(base)).status).toBe(404);
});

it('上位5件は現在公開されている詳細だけを横断し、同数を安定した順に表示する', async () => {
  const db = app.env.DB;
  await db.batch([
    ...Array.from({ length: 6 }, (_, i) =>
      db
        .prepare(
          "INSERT INTO questions (id,project_id,source,text,status) VALUES (?,'alice-project','user',?,'ready')",
        )
        .bind(`rank-${i}`, `公開の問い ${i}`),
    ),
    ...Array.from({ length: 6 }, (_, i) =>
      db
        .prepare(
          "INSERT INTO public_view_totals (project_id,kind,item_id,views) VALUES ('alice-project','questions',?,?)",
        )
        .bind(`rank-${i}`, 3),
    ),
    db.prepare(`INSERT INTO public_view_totals (project_id,kind,item_id,views) VALUES
      ('alice-project','project','',200),('alice-project','questions','hidden',100),
      ('alice-project','stocks','deleted',90),('alice-project','pufus','pf',5)`),
  ]);
  const data = (await (await app.request('/api/v1/projects/alice-project/publication')).json()) as {
    publication: Publication;
  };
  expect(data.publication.view_stats?.top.map(({ id }) => id)).toEqual([
    'pf',
    'rank-0',
    'rank-1',
    'rank-2',
    'rank-3',
  ]);
});
