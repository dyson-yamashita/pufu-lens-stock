import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../server/api';
import { cleanupStockImages } from '../server/stock-images';
import { stockImageMaxBytes, type StockImage } from '../shared/stock-images';
import { testApp } from './helpers';
import worker from '../server/index';
import { mcpToken } from './mcp-helpers';
import type { Principal } from '../server/env';

let app: Awaited<ReturnType<typeof testApp>>;
let originalDelete: R2Bucket['delete'];
let originalPut: R2Bucket['put'];
const png = Uint8Array.from(readFileSync(new URL('./fixtures/stock-image.png', import.meta.url)));
const base = '/api/v1/stocks/stock/images';
beforeEach(async () => {
  app = await testApp();
  const bucket = app.env.CONTENT;
  originalDelete = bucket.delete.bind(bucket);
  originalPut = bucket.put.bind(bucket);
  const put = vi.fn(originalPut);
  const remove = vi.fn(originalDelete);
  app.env.CONTENT = new Proxy(bucket, {
    get(target, property) {
      if (property === 'put') return put;
      if (property === 'delete') return remove;
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await app.env.DB.batch([
    app.env.DB.prepare(
      "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,source_type,status) VALUES ('article','alice','text:images','','画像付き','','text','ready')",
    ),
    app.env.DB.prepare(
      "INSERT INTO stocks(id,user_id,project_id,article_id,note) VALUES ('stock','alice','alice-project','article',''), ('other','alice','alice-second','article','')",
    ),
  ]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.dispose();
});
const upload = (
  bytes = png,
  type = 'image/png',
  headers = {},
  path = base,
  principal?: Principal,
) =>
  createApp(principal).request(
    app.env.APP_URL + path,
    {
      method: 'POST',
      headers: {
        Cookie: 'stock_session=alice-session',
        Origin: app.env.APP_URL,
        'Content-Type': type,
        'X-File-Name': encodeURIComponent('添付.png'),
        ...headers,
      },
      body: bytes,
    },
    app.env,
    app.ctx,
  );
async function saved() {
  const response = await upload();
  expect(response.status).toBe(201);
  return ((await response.json()) as { image: StockImage }).image;
}
const objects = async () => (await app.env.CONTENT.list({ prefix: 'alice/stock-images/' })).objects;

it('画像と名前を保存し、再取得・ストック移動でも保持し、同じ記事の別ストックとは分離する', async () => {
  const image = await saved();
  expect(image).toMatchObject({
    filename: '添付.png',
    content_type: 'image/png',
    size: png.length,
  });
  expect(await (await app.request(base)).json()).toEqual({ images: [image] });
  expect(await (await app.request('/api/v1/stocks/other/images')).json()).toEqual({ images: [] });
  const response = await app.request(`${base}/${image.id}`);
  expect(response.headers.get('Content-Type')).toBe('image/png');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  await app.request('/api/v1/stocks/other', { method: 'DELETE' });
  await app.request('/api/v1/stocks/stock', {
    method: 'PATCH',
    body: { note: '', project_id: 'alice-second' },
  });
  expect((await app.request(`${base}/${image.id}`)).status).toBe(200);
});

it('他人・未認証・別ストック・別サイト・token・MCPの許可範囲外を拒否し、公開状態に従う', async () => {
  const image = await saved();
  for (const method of ['GET', 'DELETE']) {
    expect((await app.request(`${base}/${image.id}`, { method, user: 'bob' })).status).toBe(404);
    expect(
      (await app.request(`${base}/${image.id}`, { method, headers: { Cookie: '' } })).status,
    ).toBe(401);
    expect((await app.request(`/api/v1/stocks/other/images/${image.id}`, { method })).status).toBe(
      404,
    );
  }
  expect((await upload(png, 'image/png', { Cookie: 'stock_session=bob-session' })).status).toBe(
    404,
  );
  expect((await upload(png, 'image/png', { Origin: 'https://evil.example' })).status).toBe(403);
  const { token } = (await (
    await app.request('/api/v1/tokens', { method: 'POST', body: { name: 'test' } })
  ).json()) as { token: string };
  expect((await upload(png, 'image/png', { Authorization: `Bearer ${token}` })).status).toBe(403);
  const principal = {
    kind: 'mcp' as const,
    tokenProjectId: 'alice-second',
    user: {
      id: 'alice',
      name: 'Alice',
      bio: '',
      avatar_url: null,
      onboarding_completed_at: '2026-10-30',
    },
  };
  expect(
    (await createApp(principal).request(app.env.APP_URL + base, {}, app.env, app.ctx)).status,
  ).toBe(404);
  const { publication } = (await (
    await app.request('/api/v1/projects/alice-project/publication', {
      method: 'PATCH',
      body: { is_public: true, public_description: '' },
    })
  ).json()) as { publication: { public_id: string } };
  const publicPath = `/api/public/projects/${publication.public_id}/stocks/stock`;
  const content = await (await app.request(publicPath, { headers: { Cookie: '' } })).text();
  expect(content).toContain(image.id);
  expect(content).toContain('添付.png');
  const publicImage = `${publicPath}/images/${image.id}`;
  expect((await app.request(publicImage, { headers: { Cookie: '' } })).status).toBe(200);
  expect(
    (
      await app.request(publicImage.replace('/stocks/stock/', '/stocks/other/'), {
        headers: { Cookie: '' },
      })
    ).status,
  ).toBe(404);
  await app.request('/api/v1/projects/alice-project/publication', {
    method: 'PATCH',
    body: { is_public: false, public_description: '' },
  });
  expect((await app.request(publicImage, { headers: { Cookie: '' } })).status).toBe(404);
  expect((await app.request(publicPath + '/images', { headers: { Cookie: '' } })).status).toBe(404);
  expect((await app.request(`${base}/${image.id}`, { headers: { Cookie: '' } })).status).toBe(401);
});

it('形式偽装・SVG・空・過大入力を拒否し、ファイル名を検証する', async () => {
  for (const [bytes, type] of [
    [png, 'image/jpeg'],
    [new TextEncoder().encode('<svg onload="alert(1)"/>'), 'image/svg+xml'],
    [new Uint8Array(), 'image/png'],
  ] as const)
    expect((await upload(bytes, type)).status).toBe(400);
  expect((await upload(new Uint8Array(stockImageMaxBytes + 1))).status).toBe(413);
  for (const name of ['', '%ZZ', encodeURIComponent('a'.repeat(256)), '%00'])
    expect((await upload(png, 'image/png', { 'X-File-Name': name })).status).toBe(400);
  expect(await objects()).toHaveLength(0);
});

it('並行アップロードでも上限を守り、削除後は再添付できる', async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, () => upload()));
  expect(responses.filter((response) => response.status === 201)).toHaveLength(10);
  expect(responses.filter((response) => response.status === 409)).toHaveLength(2);
  const { images } = (await (await app.request(base)).json()) as { images: StockImage[] };
  expect((await app.request(`${base}/${images[0].id}`, { method: 'DELETE' })).status).toBe(200);
  expect((await app.request(`${base}/${images[0].id}`)).status).toBe(404);
  expect(await objects()).toHaveLength(9);
  await saved();
  expect(await objects()).toHaveLength(10);
});

it.each(['stock', 'project', 'account'])(
  '%sの削除に追従し、R2の削除失敗を再試行する',
  async (target) => {
    const image = await saved();
    const remove = vi.mocked(app.env.CONTENT.delete).mockRejectedValue(new Error('R2 unavailable'));
    const path =
      target === 'stock'
        ? '/api/v1/stocks/stock'
        : target === 'project'
          ? '/api/v1/projects/alice-project'
          : '/api/v1/me';
    await app.request(path, { method: 'DELETE' });
    expect((await app.request(`${base}/${image.id}`)).status).not.toBe(200);
    expect(
      (await app.env.DB.prepare('SELECT content_key FROM stock_image_cleanup').all()).results,
    ).toHaveLength(1);
    remove.mockImplementation(originalDelete);
    await cleanupStockImages(app.env);
    expect(await objects()).toHaveLength(0);
    expect(
      (await app.env.DB.prepare('SELECT content_key FROM stock_image_cleanup').all()).results,
    ).toHaveLength(0);
  },
);

it('保存失敗や保存中の親削除で画像を残さず、中断された保存も掃除する', async () => {
  const put = vi.mocked(app.env.CONTENT.put).mockRejectedValueOnce(new Error('write failed'));
  expect((await upload()).status).toBe(500);
  await app.request('/api/v1/me'); // drain background cleanup
  expect(await objects()).toHaveLength(0);
  put.mockImplementationOnce(async (...args: Parameters<typeof originalPut>) => {
    await app.request('/api/v1/projects/alice-project', { method: 'DELETE' });
    return originalPut(...args);
  });
  expect((await upload()).status).toBe(409);
  await app.request('/api/v1/me');
  expect(await objects()).toHaveLength(0);
  await app.env.DB.prepare(
    "INSERT INTO stock_images(id,stock_id,content_key,filename,content_type,size,content_hash,status,created_at) VALUES ('stale','other','alice/stock-images/stale','test.png','image/png',1,'hash','pending','2000-01-01')",
  ).run();
  await originalPut('alice/stock-images/stale', png);
  await app.env.DB.prepare("UPDATE stock_image_writes SET created_at='2000-01-01'").run();
  await cleanupStockImages(app.env);
  expect(await objects()).toHaveLength(0);
  expect((await app.env.DB.prepare('SELECT id FROM stock_images').all()).results).toHaveLength(0);
  // Keep a tombstone for a put whose provider-side completion was never observed.
  expect(
    (await app.env.DB.prepare('SELECT content_key FROM stock_image_writes').all()).results,
  ).toHaveLength(1);
  await originalPut('alice/stock-images/stale', png);
  await cleanupStockImages(app.env);
  expect(await objects()).toHaveLength(0);
});

it('通信再試行は画像を重複させず、同じIDで異なる画像の上書きを拒否する', async () => {
  const requestId = crypto.randomUUID();
  const first = await upload(png, 'image/png', { 'Idempotency-Key': requestId });
  expect(first.status).toBe(201);
  const retry = await upload(png, 'image/png', { 'Idempotency-Key': requestId });
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(await first.json());
  expect(
    (await upload(png, 'image/png', { 'Idempotency-Key': requestId, 'X-File-Name': 'other.png' }))
      .status,
  ).toBe(409);
  expect(await objects()).toHaveLength(1);
});

it('親削除中に同じリクエストIDを再利用しても、古い保存処理は新しい画像を変更しない', async () => {
  const requestId = crypto.randomUUID();
  const headers = { 'Idempotency-Key': requestId };
  vi.mocked(app.env.CONTENT.put).mockImplementationOnce(
    async (...args: Parameters<typeof originalPut>) => {
      await app.request('/api/v1/projects/alice-project', { method: 'DELETE' });
      expect((await upload(png, 'image/png', headers, '/api/v1/stocks/other/images')).status).toBe(
        201,
      );
      return originalPut(...args);
    },
  );
  expect((await upload(png, 'image/png', headers)).status).toBe(409);
  await app.request('/api/v1/me');
  expect((await app.request(`/api/v1/stocks/other/images/${requestId}`)).status).toBe(200);
  expect(await objects()).toHaveLength(1);
});

it('MCPの保存中にストックが許可範囲外へ移動した場合は添付を確定しない', async () => {
  const { user } = (await (await app.request('/api/v1/me')).json()) as { user: Principal['user'] };
  const principal: Principal = { kind: 'mcp', tokenProjectId: 'alice-project', user };
  await app.request('/api/v1/stocks/other', { method: 'DELETE' });
  vi.mocked(app.env.CONTENT.put).mockImplementationOnce(
    async (...args: Parameters<typeof originalPut>) => {
      expect(
        (
          await app.request('/api/v1/stocks/stock', {
            method: 'PATCH',
            body: { note: '', project_id: 'alice-second' },
          })
        ).status,
      ).toBe(200);
      return originalPut(...args);
    },
  );
  expect((await upload(png, 'image/png', {}, base, principal)).status).toBe(409);
  expect(await (await app.request(base)).json()).toEqual({ images: [] });
  expect(await objects()).toHaveLength(0);
});

it('MCPの追加権限とプロジェクト範囲を守り、Base64画像を添付・再送できる', async () => {
  const token = await mcpToken(app, 'alice-project', ['stocks:write']);
  const call = async (
    accessToken: string,
    args: Record<string, unknown>,
    name = 'add_stock_image',
  ) => {
    const response = await worker.fetch(
      new Request(app.env.APP_URL + '/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Host: new URL(app.env.APP_URL).host,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      }),
      app.env,
      app.ctx,
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const message = response.headers.get('Content-Type')?.includes('application/json')
      ? JSON.parse(text)
      : JSON.parse(
          text
            .split('\n')
            .find((line) => line.startsWith('data: '))!
            .slice(6),
        );
    return message.result as { isError?: boolean; structuredContent: Record<string, unknown> };
  };
  const bytes = new Uint8Array(300000);
  bytes.set(png);
  const args = {
    stock_id: 'stock',
    filename: 'mcp.png',
    content_type: 'image/png',
    base64: Buffer.from(bytes).toString('base64'),
    request_id: crypto.randomUUID(),
  };
  const first = await call(token, args);
  expect(first.isError).not.toBe(true);
  expect(first.structuredContent).toMatchObject({
    image: { filename: 'mcp.png', size: bytes.length },
  });
  expect((await call(token, args)).structuredContent).toEqual(first.structuredContent);
  expect(
    (await call(token, { ...args, stock_id: 'other', request_id: crypto.randomUUID() })).isError,
  ).toBe(true);
  expect((await call(token, { ...args, base64: 'not valid base64' })).isError).toBe(true);
  const readToken = await mcpToken(app, 'alice-project', ['stocks:read']);
  expect((await call(readToken, args)).isError).toBe(true);
  const detail = await call(readToken, { stock_id: 'stock' }, 'get_stock');
  expect(detail.structuredContent.images).toMatchObject([{ filename: 'mcp.png' }]);
  expect(await objects()).toHaveLength(1);
});
