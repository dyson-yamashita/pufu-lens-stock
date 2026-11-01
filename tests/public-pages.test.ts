import { afterEach, beforeEach, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import worker from '../server/index';
import { testApp } from './helpers';
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
afterEach(async () => app.dispose());
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
    `${app.env.APP_URL}/pufu-lens-logo.png`,
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
  expect(document.querySelector('head script:not([src]):not([type="application/ld+json"])')).toBeNull();
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
  // site.xml (8) + project + 1001 questions + 1 pufu + existing stocks in fixture
  expect(all.length).toBeGreaterThanOrEqual(1003 + 8);
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
