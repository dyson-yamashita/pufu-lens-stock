import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Response as CacheResponse } from 'miniflare';
import { hash } from '../server/infrastructure/security';
import { testApp } from './helpers';

describe('公開・画像リンク境界の形式モデルとの照合', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  const token = 'B'.repeat(43);
  const imagePath = `/api/pufu-images/${token}.png`;
  const contentKey = 'alice/mcp-pufu-images/boundary.png';
  const anonymous = { Cookie: '', Origin: '' };
  const png = new Uint8Array([137, 80, 78, 71]);
  const open = (method = 'GET') => app.request(imagePath, { method, headers: anonymous });

  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await app.dispose();
  });

  async function seedImageLink() {
    // 発行・描画のテストは既存pufu-image-linksに任せ、匿名取得のDB/R2条件を分離する。
    await app.env.DB.prepare(
      "INSERT INTO pufu_scores(id,user_id,project_id,task,input_json,score_json,editor_version,status) VALUES('boundary-pufu','alice','alice-project','課題','{}','{}','0.9.19','ready')",
    ).run();
    await app.env.DB.prepare(
      `INSERT INTO pufu_image_links(token_hash,user_id,pufu_id,project_id,phase,revision,content_key,expires_at,ready)
       VALUES(?,'alice','boundary-pufu','alice-project',1,1,?,'2099-01-01T00:00:00.000Z',1)`,
    )
      .bind(await hash(token), contentKey)
      .run();
    await app.env.CONTENT.put(contentKey, png);
  }

  it('公開IDを変更すると旧キャッシュを使わず、旧IDの匿名取得を拒否する', async () => {
    const store = await (await app.getCaches()).open('public-project-directory');
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async (key: Request) => {
          const response = await store.match(new Request(key).url);
          return response ? new Response(await response.arrayBuffer()) : undefined;
        },
        put: async (key: Request, response: Response) =>
          store.put(
            new Request(key).url,
            new CacheResponse(await response.arrayBuffer(), {
              headers: Array.from(response.headers),
            }),
          ),
      }),
    });
    const published = await app.request('/api/v1/projects/alice-project/publication', {
      method: 'PATCH',
      body: { is_public: true, public_description: '公開する紹介文' },
    });
    expect(published.status).toBe(200);
    const { publication } = (await published.json()) as { publication: { public_id: string } };
    const directory = () => app.request('/api/public/projects', { headers: anonymous });
    expect(await (await directory()).json()).toMatchObject({
      items: [{ public_id: publication.public_id }],
    });
    const oldGeneration = await app.env.DB.prepare(
      'SELECT revision FROM public_directory_revision WHERE id=1',
    ).first('revision');
    await app.env.DB.prepare(
      "UPDATE projects SET public_id='boundary-new-id' WHERE id='alice-project'",
    ).run();
    expect(
      await app.env.DB.prepare('SELECT revision FROM public_directory_revision WHERE id=1').first(
        'revision',
      ),
    ).not.toBe(oldGeneration);
    expect(await (await directory()).json()).toMatchObject({
      items: [{ public_id: 'boundary-new-id' }],
    });
    expect(
      (await app.request(`/api/public/projects/${publication.public_id}`, { headers: anonymous }))
        .status,
    ).toBe(404);
    expect(
      (await app.request('/api/public/projects/boundary-new-id', { headers: anonymous })).status,
    ).toBe(200);
  });

  it.each([
    ['pending', 'UPDATE pufu_image_links SET ready=0'],
    ['リンク所有者不一致', "UPDATE pufu_image_links SET user_id='bob'"],
    ['リンク保存先不一致', "UPDATE pufu_image_links SET project_id='alice-second'"],
    ['プ譜未完成', "UPDATE pufu_scores SET status='generating' WHERE id='boundary-pufu'"],
  ])('%sはGET/HEADのR2照会前に拒否し、保存内容を変更しない', async (_, sql) => {
    await seedImageLink();
    await app.env.DB.prepare(sql).run();
    const original = app.env.CONTENT;
    const get = vi.fn(original.get.bind(original));
    const head = vi.fn(original.head.bind(original));
    app.env.CONTENT = new Proxy(original, {
      get: (target, key) =>
        key === 'get' ? get : key === 'head' ? head : Reflect.get(target, key),
    });
    const before = await app.env.DB.batch([
      app.env.DB.prepare('SELECT * FROM pufu_image_links'),
      app.env.DB.prepare("SELECT * FROM pufu_scores WHERE id='boundary-pufu'"),
    ]);
    expect((await open()).status).toBe(404);
    expect((await open('HEAD')).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
    const after = await app.env.DB.batch([
      app.env.DB.prepare('SELECT * FROM pufu_image_links'),
      app.env.DB.prepare("SELECT * FROM pufu_scores WHERE id='boundary-pufu'"),
    ]);
    expect(after.map((result) => result.results)).toEqual(before.map((result) => result.results));
    expect(Buffer.from(await (await original.get(contentKey))!.arrayBuffer())).toEqual(
      Buffer.from(png),
    );
  });

  it.each(['GET', 'HEAD'])('R2の%s照会後に期限切れとなったリンクは応答しない', async (method) => {
    await seedImageLink();
    const original = app.env.CONTENT;
    const operation = method === 'GET' ? 'get' : 'head';
    app.env.CONTENT = new Proxy(original, {
      get: (target, key) =>
        key === operation
          ? async (content: string) => {
              const result = await original[operation](content);
              await app.env.DB.prepare(
                "UPDATE pufu_image_links SET expires_at='2000-01-01T00:00:00.000Z'",
              ).run();
              return result;
            }
          : Reflect.get(target, key),
    });
    expect((await open(method)).status).toBe(404);
    expect(Buffer.from(await (await original.get(contentKey))!.arrayBuffer())).toEqual(
      Buffer.from(png),
    );
  });

  it('秘密画像リンクは匿名公開と独立し、非公開化だけでは失効しない', async () => {
    await seedImageLink();
    const publication = (is_public: boolean) =>
      app.request('/api/v1/projects/alice-project/publication', {
        method: 'PATCH',
        body: { is_public, public_description: '' },
      });
    const published = await publication(true);
    expect(published.status).toBe(200);
    const { publication: settings } = (await published.json()) as {
      publication: { public_id: string };
    };
    expect((await publication(false)).status).toBe(200);
    expect(
      (await app.request(`/api/public/projects/${settings.public_id}`, { headers: anonymous }))
        .status,
    ).toBe(404);
    const image = await open();
    expect(image.status).toBe(200);
    expect(Buffer.from(await image.arrayBuffer())).toEqual(Buffer.from(png));
    expect((await open('HEAD')).status).toBe(200);
  });
});
