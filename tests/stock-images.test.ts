import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../server/api/app';
import { cleanupStockImages } from '../server/features/stocks/stock-images';
import { stockImageMaxBytes, type StockImage } from '../shared/stock-images';
import { pauseOperation, testApp } from './helpers';
import worker from '../server/index';
import { mcpToken } from './mcp-helpers';
import { stockImageUploadPaths } from './models/stock-image-upload';
import type { Principal } from '../server/env';
import { searchBindings } from './search-helpers';
import { syncSearchIndex } from '../server/infrastructure/ai/search-index';

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
const upload = async (
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

it.each(['keyword', 'semantic', 'hybrid'])(
  '一覧に保存済み画像だけを添付順で返し、ストック・所有者を分離する: %s',
  async (mode) => {
    const first = await saved();
    const second = await saved();
    await app.env.DB.batch([
      app.env.DB.prepare('UPDATE stock_images SET created_at=? WHERE id=?').bind(
        '2026-11-01T00:00:00Z',
        first.id,
      ),
      app.env.DB.prepare('UPDATE stock_images SET created_at=? WHERE id=?').bind(
        '2026-11-02T00:00:00Z',
        second.id,
      ),
      app.env.DB.prepare(
        "INSERT INTO stock_images(id,stock_id,content_key,filename,content_type,size,content_hash,status) VALUES ('pending','stock','pending-key','未保存.png','image/png',1,'hash','pending')",
      ),
    ]);
    searchBindings(app.env);
    await syncSearchIndex(app.env);
    const response = await app.request(`/api/v1/stocks?q=画像&mode=${mode}`);
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      stocks: { id: string; image_previews: { id: string; filename: string }[] }[];
    };
    expect(data.stocks).toHaveLength(2);
    expect(data.stocks.find((stock) => stock.id === 'stock')?.image_previews).toEqual(
      [first, second].map(({ id, filename }) => ({ id, filename })),
    );
    expect(data.stocks.find((stock) => stock.id === 'other')?.image_previews).toEqual([]);
    expect(await (await app.request('/api/v1/stocks', { user: 'bob' })).json()).toMatchObject({
      stocks: [],
    });
    const compact = await app.request(`/api/v1/stocks?q=画像&mode=${mode}&detail=compact`);
    expect(compact.status).toBe(200);
    const compactData = (await compact.json()) as { stocks: Record<string, unknown>[] };
    expect(compactData.stocks).toHaveLength(2);
    for (const stock of compactData.stocks) expect(stock).not.toHaveProperty('image_previews');
  },
);

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

it('公開ストック一覧は公開中のストックに添付された保存済み画像だけを添付順で返す', async () => {
  const first = await saved();
  const second = await saved();
  const privateUpload = await upload(png, 'image/png', {}, '/api/v1/stocks/other/images');
  expect(privateUpload.status).toBe(201);
  await app.env.DB.batch([
    app.env.DB.prepare('UPDATE stock_images SET created_at=? WHERE id=?').bind(
      '2026-11-01T00:00:00Z',
      first.id,
    ),
    app.env.DB.prepare('UPDATE stock_images SET created_at=? WHERE id=?').bind(
      '2026-11-02T00:00:00Z',
      second.id,
    ),
    app.env.DB.prepare(
      "INSERT INTO stock_images(id,stock_id,content_key,filename,content_type,size,content_hash,status) VALUES ('pending','stock','pending-key','未保存.png','image/png',1,'hash','pending')",
    ),
  ]);
  const { publication } = (await (
    await app.request('/api/v1/projects/alice-project/publication', {
      method: 'PATCH',
      body: { is_public: true, public_description: '' },
    })
  ).json()) as { publication: { public_id: string } };
  const list = `/api/public/projects/${publication.public_id}/stocks`;
  const headers = { Cookie: '' };
  const { items } = (await (await app.request(list, { headers })).json()) as {
    items: { id: string; images: (StockImage & { url: string })[] }[];
  };
  expect(items.map((stock) => stock.id)).toEqual(['stock']);
  expect(items[0].images).toEqual(
    [first, second].map((image, i) => ({
      ...image,
      created_at: `2026-11-0${i + 1}T00:00:00Z`,
      url: `${list}/stock/images/${image.id}`,
    })),
  );
  expect((await app.request(items[0].images[0].url, { headers })).status).toBe(200);
  await app.request('/api/v1/projects/alice-project/publication', {
    method: 'PATCH',
    body: { is_public: false, public_description: '' },
  });
  expect((await app.request(list, { headers })).status).toBe(404);
  expect((await app.request(items[0].images[0].url, { headers })).status).toBe(404);
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
  const responses = await Promise.all(Array.from({ length: 7 }, () => upload()));
  expect(responses.filter((response) => response.status === 201)).toHaveLength(5);
  expect(responses.filter((response) => response.status === 409)).toHaveLength(2);
  const { images } = (await (await app.request(base)).json()) as { images: StockImage[] };
  expect((await app.request(`${base}/${images[0].id}`, { method: 'DELETE' })).status).toBe(200);
  expect((await app.request(`${base}/${images[0].id}`)).status).toBe(404);
  expect(await objects()).toHaveLength(4);
  await saved();
  expect(await objects()).toHaveLength(5);
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

const imageCases = stockImageUploadPaths.map(({ steps }) => {
  const operations = steps.slice(1);
  return { name: operations.map(({ event }) => event.type).join(' → '), operations };
});

it('B14 MBTはストック・プロジェクトの削除ごとに両方の完了順と再送・掃除を通す', () => {
  expect(imageCases.map(({ name }) => name).sort()).toEqual(
    ['deleteProject', 'deleteStock'].flatMap((deletion) =>
      ['completeOriginal → completeReplacement', 'completeReplacement → completeOriginal'].map(
        (order) =>
          `${deletion} → beginReplacement → replayReplacement → cleanup → ${order} → cleanup → replayReplacement`,
      ),
    ),
  );
});

it.each(imageCases)('B14 MBT $name', async ({ operations }) => {
  const id = crypto.randomUUID();
  const replacementBase = '/api/v1/stocks/other/images';
  const replacementBytes = Uint8Array.from(
    readFileSync(new URL('./fixtures/detail-image.png', import.meta.url)),
  );
  const uploadReplacement = () =>
    upload(
      replacementBytes,
      'image/png',
      { 'Idempotency-Key': id, 'X-File-Name': 'replacement.png' },
      replacementBase,
    );
  const originalPutGate = pauseOperation<string>('旧画像のR2 PUT前');
  const replacementPutGate = pauseOperation<string>('再添付画像のR2 PUT後');
  const put = vi.mocked(app.env.CONTENT.put).mockImplementationOnce(async (...args) => {
    await originalPutGate.pause(args[0]);
    return originalPut(...args);
  });
  const original = upload(png, 'image/png', { 'Idempotency-Key': id });
  let replacement: Promise<Response> | undefined;
  let replacementKey: string | undefined;
  let replacementImage: StockImage | undefined;
  const deleteParent = async (path: string) => {
    expect((await app.request(path, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`${base}/${id}`)).status).toBe(404);
  };
  const execute = {
    deleteStock: () => deleteParent('/api/v1/stocks/stock'),
    deleteProject: () => deleteParent('/api/v1/projects/alice-project'),
    beginReplacement: async () => {
      put.mockImplementationOnce(async (...args) => {
        const stored = await originalPut(...args);
        await replacementPutGate.pause(args[0]);
        return stored;
      });
      replacement = uploadReplacement();
      replacementKey = await replacementPutGate.waitForPause(replacement);
    },
    completeOriginal: async () => {
      originalPutGate.resume();
      expect((await original).status).toBe(409);
    },
    completeReplacement: async () => {
      replacementPutGate.resume();
      const response = await replacement!;
      expect(response.status).toBe(201);
      replacementImage = ((await response.json()) as { image: StockImage }).image;
    },
    replayReplacement: async (ready: boolean) => {
      const response = await uploadReplacement();
      expect(response.status).toBe(ready ? 200 : 409);
      if (ready) expect(await response.json()).toEqual({ image: replacementImage });
    },
    cleanup: () => cleanupStockImages(app.env),
  };
  try {
    const originalKey = await originalPutGate.waitForPause(original);
    expect(
      await app.env.DB.prepare('SELECT id,stock_id,content_key,status FROM stock_images').first(),
    ).toEqual({ id, stock_id: 'stock', content_key: originalKey, status: 'pending' });
    for (const { event, state } of operations) {
      const ready = state.hasTag('replacementReady');
      const pending = state.hasTag('replacementPending');
      const cleanupQueued = state.hasTag('originalCleanupQueued');
      await execute[event.type](ready);
      // testApp.requestは旧画像の失敗時に登録されたwaitUntilの掃除も待つ。
      const image = await app.request(`${replacementBase}/${id}`);
      expect(image.status, event.type).toBe(ready ? 200 : 404);
      if (ready) expect(new Uint8Array(await image.arrayBuffer())).toEqual(replacementBytes);
      if (replacementKey) expect(replacementKey).not.toBe(originalKey);
      const [images, cleanup, writes] = await app.env.DB.batch([
        app.env.DB.prepare('SELECT id,stock_id,content_key,status FROM stock_images'),
        app.env.DB.prepare('SELECT content_key FROM stock_image_cleanup'),
        app.env.DB.prepare('SELECT content_key FROM stock_image_writes ORDER BY content_key'),
      ]);
      expect(images.results, event.type).toEqual(
        pending || ready
          ? [
              {
                id,
                stock_id: 'other',
                content_key: replacementKey,
                status: ready ? 'ready' : 'pending',
              },
            ]
          : [],
      );
      expect(cleanup.results).toEqual(cleanupQueued ? [{ content_key: originalKey }] : []);
      expect(writes.results).toEqual(
        [...(cleanupQueued ? [originalKey] : []), ...(pending ? [replacementKey!] : [])]
          .sort()
          .map((content_key) => ({ content_key })),
      );
      expect((await objects()).map(({ key }) => key)).toEqual(
        pending || ready ? [replacementKey] : [],
      );
      expect(put).toHaveBeenCalledTimes(pending || ready ? 2 : 1);
    }
  } finally {
    originalPutGate.resume();
    replacementPutGate.resume();
    await Promise.allSettled([original, replacement]);
  }
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
  for (let i = 0; i < 4; i++)
    expect((await call(token, { ...args, request_id: crypto.randomUUID() })).isError).not.toBe(
      true,
    );
  const sixth = await call(token, { ...args, request_id: crypto.randomUUID() });
  expect(sixth.isError).toBe(true);
  expect(sixth.structuredContent.status).toBe(409);
  expect(await objects()).toHaveLength(5);
});
