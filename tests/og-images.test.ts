import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArticleWorkflow } from '../server/infrastructure/jobs/workflows';
import type { Job } from '../server/env';
import { mockEvent, mockStep, testApp } from './helpers';
import { ogImageKey } from '../server/features/stocks/og-image';

const png = Uint8Array.from(readFileSync(new URL('./fixtures/stock-image.png', import.meta.url)));
let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
  app.env.LOCAL_DEMO_ENABLED = 'true';
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await app.dispose();
});

async function save(
  imageUrl = '/cover.png',
  imageResponse = () => new Response(png, { headers: { 'Content-Type': 'image/png' } }),
) {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === 'cloudflare-dns.com')
        return Response.json({
          Status: 0,
          Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '8.8.8.8' }] : [],
        });
      expect(new Headers(init?.headers).get('Cookie')).toBeNull();
      expect(new Headers(init?.headers).get('Authorization')).toBeNull();
      if (url.pathname === '/robots.txt') return new Response(null, { status: 404 });
      requests.push(url.href);
      if (url.pathname !== '/story') return imageResponse();
      return new Response(
        `<html><head><title>OGP付き記事</title><meta property="og:image" content="${imageUrl}"></head><body><article><p>${'URLから記事と画像を保存し、要約と問いを生成します。'.repeat(20)}</p></article></body></html>`,
        { headers: { 'Content-Type': 'text/html' } },
      );
    }),
  );
  const saved = (await (
    await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { project_id: 'alice-project', url: 'https://example.com/story' },
    })
  ).json()) as { id: string };
  const job = await app.env.DB.prepare(
    "SELECT * FROM processing_jobs WHERE kind='article'",
  ).first<Job>();
  await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
  return { id: saved.id, requests };
}

it('OGP画像を保存して一覧・本人・公開閲覧へ配信し、公開停止と削除に追従する', async () => {
  const { id, requests } = await save();
  expect(requests).toEqual(['https://example.com/story', 'https://example.com/cover.png']);
  const path = `/api/v1/stocks/${id}/og-image`;
  expect(await (await app.request(`/api/v1/stocks/${id}`)).json()).toMatchObject({
    stock: { has_og_image: 1, status: 'ready' },
  });
  expect(await (await app.request('/api/v1/stocks')).json()).toMatchObject({
    stocks: [{ has_og_image: 1 }],
  });
  const image = await app.request(path);
  expect(image.headers.get('Content-Type')).toBe('image/png');
  expect(image.headers.get('Cache-Control')).toBe('private, no-store');
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
  expect((await app.request(path, { user: 'bob' })).status).toBe(404);
  expect((await app.request(path, { headers: { Cookie: '' } })).status).toBe(401);
  const published = (await (
    await app.request('/api/v1/projects/alice-project/publication', {
      method: 'PATCH',
      body: { is_public: true, public_description: '' },
    })
  ).json()) as { publication: { public_id: string } };
  const root = `/api/public/projects/${published.publication.public_id}`;
  expect(
    await (await app.request(`${root}/stocks`, { headers: { Cookie: '' } })).json(),
  ).toMatchObject({
    items: [{ id, og_image_url: `${root}/stocks/${id}/og-image` }],
  });
  const data = (await (
    await app.request(`${root}/stocks/${id}`, { headers: { Cookie: '' } })
  ).json()) as { stock: { og_image_url: string } };
  expect(data.stock.og_image_url).toBe(`${root}/stocks/${id}/og-image`);
  expect((await app.request(data.stock.og_image_url, { headers: { Cookie: '' } })).status).toBe(
    200,
  );
  await app.request('/api/v1/projects/alice-project/publication', {
    method: 'PATCH',
    body: { is_public: false, public_description: '' },
  });
  expect((await app.request(data.stock.og_image_url, { headers: { Cookie: '' } })).status).toBe(
    404,
  );
  const article = await app.env.DB.prepare('SELECT content_key FROM articles').first<{
    content_key: string;
  }>();
  await app.request(`/api/v1/stocks/${id}`, { method: 'DELETE' });
  const cleanup = await app.env.DB.prepare(
    "SELECT * FROM processing_jobs WHERE kind='cleanup'",
  ).first<Job>();
  await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(cleanup!.id), mockStep());
  expect(await app.env.CONTENT.get(ogImageKey(article!.content_key))).toBeNull();
});

it.each(['unavailable', 'svg', 'large', 'private', 'redirect'])(
  '画像が%sでも記事保存・要約を完了し、不正な画像は配信しない',
  async (failure) => {
    const { id, requests } = await save(
      failure === 'private' ? 'http://127.0.0.1/private.png' : '/cover.png',
      () => {
        if (failure === 'svg')
          return new Response('<svg></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
        if (failure === 'large')
          return new Response(png, {
            headers: { 'Content-Type': 'image/png', 'Content-Length': String(5 * 1024 * 1024 + 1) },
          });
        if (failure === 'redirect')
          return new Response(null, {
            status: 302,
            headers: { Location: 'http://127.0.0.1/private.png' },
          });
        return new Response(null, { status: 503 });
      },
    );
    expect(await (await app.request(`/api/v1/stocks/${id}`)).json()).toMatchObject({
      stock: { has_og_image: 0, status: 'ready' },
    });
    expect((await app.request(`/api/v1/stocks/${id}/og-image`)).status).toBe(404);
    expect(requests.every((url) => new URL(url).hostname === 'example.com')).toBe(true);
    expect((await app.env.CONTENT.list()).objects.map((object) => object.key)).toHaveLength(1);
  },
);
