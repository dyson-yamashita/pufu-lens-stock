import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchArticle } from '../server/ingest';
import { ArticleWorkflow } from '../server/workflows';
import type { Env, Job } from '../server/env';
import { mockEvent, mockStep, testApp } from './helpers';

const videoId = 'dQw4w9WgXcQ';
const apiKey = 'test-youtube-key';
const metadata = {
  videoId,
  channelTitle: '学びのチャンネル',
  thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  hasDescription: true,
};
function videoResponse(description = '小さな検証から始める方法を紹介します。') {
  return {
    items: [
      {
        id: videoId,
        snippet: {
          title: '小さく始めるプロジェクト',
          description,
          channelTitle: '学びのチャンネル',
          thumbnails: { high: { url: metadata.thumbnailUrl, width: 480, height: 360 } },
        },
      },
    ],
  };
}
function mockApi(response: () => Response = () => Response.json(videoResponse())) {
  const requests: { url: URL; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push({ url, init });
      if (url.hostname !== 'www.googleapis.com') throw new Error('Unexpected external request');
      return response();
    }),
  );
  return requests;
}
afterEach(() => vi.unstubAllGlobals());

describe('YouTube動画情報の取得', () => {
  const env = { YOUTUBE_API_KEY: apiKey } as unknown as Env;
  it.each([
    `https://www.youtube.com/watch?v=${videoId}&t=10`,
    `https://youtu.be/${videoId}?si=shared`,
    `https://m.youtube.com/watch?v=${videoId}`,
    `https://music.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com/shorts/${videoId}`,
    `https://www.youtube.com/live/${videoId}`,
    `https://www.youtube-nocookie.com/embed/${videoId}`,
  ])('短い説明文でも通常の記事抽出をせず動画情報を取得する: %s', async (url) => {
    const requests = mockApi();
    const result = await fetchArticle(env, url);
    expect(result).toMatchObject({ title: '小さく始めるプロジェクト', youtube: metadata });
    expect(result.text).toContain('小さな検証から始める方法を紹介します。');
    expect(result.text).toContain('学びのチャンネル');
    expect(result.text).toContain('動画本編・字幕は取得していません');
    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe('/youtube/v3/videos');
    expect(requests[0].url.searchParams.get('id')).toBe(videoId);
    expect(requests[0].url.searchParams.get('part')).toBe('snippet');
    expect(requests[0].url.href).not.toContain(apiKey);
    const headers = new Headers(requests[0].init?.headers);
    expect(headers.get('X-Goog-Api-Key')).toBe(apiKey);
    expect(headers.has('Cookie')).toBe(false);
    expect(headers.has('Authorization')).toBe(false);
    expect(requests[0].init?.redirect).toBe('manual');
  });
  it('説明文とサムネイルがなくてもタイトルを保存できる', async () => {
    const json = videoResponse('');
    Object.assign(json.items[0].snippet, { thumbnails: {} });
    mockApi(() => Response.json(json));
    const result = await fetchArticle(env, `https://youtu.be/${videoId}`);
    expect(result.title).toBe('小さく始めるプロジェクト');
    expect(result).toMatchObject({ youtube: { hasDescription: false, thumbnailUrl: null } });
    expect(result.text).toContain('説明文はありません');
  });
  it('APIキーが未設定なら設定方法を案内する', async () => {
    const requests = mockApi();
    await expect(fetchArticle({} as Env, `https://youtu.be/${videoId}`)).rejects.toThrow(
      'YOUTUBE_API_KEY',
    );
    expect(requests).toHaveLength(0);
  });
  it.each([
    'https://youtube.com/playlist?list=example',
    'https://youtube.com/watch?v=bad',
    'https://youtu.be/invalid/extra',
  ])('動画を特定できないURLはAPIに送らない: %s', async (url) => {
    const requests = mockApi();
    await expect(fetchArticle(env, url)).rejects.toThrow('動画URL');
    expect(requests).toHaveLength(0);
  });
  it.each([
    { status: 400, reason: 'keyInvalid', message: 'APIキー' },
    { status: 403, reason: 'accessNotConfigured', message: '有効化' },
    { status: 403, reason: 'quotaExceeded', message: '利用上限' },
    { status: 429, reason: 'rateLimitExceeded', message: '利用上限' },
    { status: 302, reason: '', message: '取得できません' },
  ])(
    'API失敗を秘密情報を含めず案内する: $status / $reason',
    async ({ status, reason, message }) => {
      mockApi(() =>
        Response.json({ error: { message: apiKey, errors: [{ reason }] } }, { status }),
      );
      const error = await fetchArticle(env, `https://youtu.be/${videoId}`).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(message);
      expect((error as Error).message).not.toContain(apiKey);
    },
  );
  it.each([
    { items: [] },
    { items: [{ id: 'anotherId00', snippet: videoResponse().items[0].snippet }] },
    { items: [{ id: videoId, snippet: { title: '' } }] },
  ])('存在しない動画や不正な応答を成功扱いにしない: %j', async (json) => {
    mockApi(() => Response.json(json));
    await expect(fetchArticle(env, `https://youtu.be/${videoId}`)).rejects.toThrow();
  });
  it('外部や安全でないサムネイルURLを画面へ渡さない', async () => {
    const json = videoResponse();
    json.items[0].snippet.thumbnails.high.url = 'http://127.0.0.1/private';
    mockApi(() => Response.json(json));
    expect(await fetchArticle(env, `https://youtu.be/${videoId}`)).toMatchObject({
      youtube: { thumbnailUrl: null },
    });
  });
  it('通信例外のURLやキーを利用者向けエラーへ流さない', async () => {
    mockApi(() => {
      throw new Error(`https://www.googleapis.com/?key=${apiKey}`);
    });
    const error = await fetchArticle(env, `https://youtu.be/${videoId}`).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(apiKey);
    expect((error as Error).message).toContain('YouTube');
  });
});

describe('YouTubeストックの保存と再試行', () => {
  it('動画情報の要約失敗後に本文を補完したら、APIを呼ばず取得元の表示を更新する', async () => {
    const app = await testApp();
    try {
      app.env.LOCAL_DEMO_ENABLED = 'true';
      app.env.YOUTUBE_API_KEY = apiKey;
      app.env.AI = { run: vi.fn().mockRejectedValue(new Error('summary generation failed')) };
      const response = await app.request('/api/v1/stocks', {
        method: 'POST',
        body: { project_id: 'alice-project', url: `https://youtu.be/${videoId}` },
      });
      const { id } = (await response.json()) as { id: string };
      const requests = mockApi();
      const job = (await app.env.DB.prepare(
        "SELECT * FROM processing_jobs WHERE kind='article'",
      ).first<Job>())!;
      await expect(
        new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job.id), mockStep()),
      ).rejects.toThrow();
      expect(await (await app.request(`/api/v1/stocks/${id}`)).json()).toMatchObject({
        stock: { status: 'failed', youtube: metadata },
      });
      app.env.AI = undefined;
      expect(
        (
          await app.request(`/api/v1/stocks/${id}/retry`, {
            method: 'POST',
            body: {
              supplemental_text:
                '動画の文字起こしを自分で入力した本文です。保存した情報から要約を作成します。',
            },
          })
        ).status,
      ).toBe(202);
      const next = (await app.env.DB.prepare(
        "SELECT * FROM processing_jobs WHERE kind='article' ORDER BY revision DESC LIMIT 1",
      ).first<Job>())!;
      await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(next.id), mockStep());
      expect(await (await app.request(`/api/v1/stocks/${id}`)).json()).toMatchObject({
        stock: { status: 'ready', youtube: null },
      });
      expect(requests).toHaveLength(1);
    } finally {
      await app.dispose();
    }
  });

  it('動画情報・要約を保存し、一覧・詳細・根拠リンクでも取得元を返す', async () => {
    const app = await testApp();
    try {
      app.env.LOCAL_DEMO_ENABLED = 'true';
      Object.assign(app.env, { YOUTUBE_API_KEY: apiKey });
      const run = vi.fn<NonNullable<Env['AI']>['run']>().mockResolvedValue({
        response: {
          overview: '小さな検証から始める方法を紹介する動画です。',
          keyPoints: ['小さな検証から始める方法を紹介します。'],
          topics: ['プロジェクト'],
        },
      });
      app.env.AI = { run };
      const response = await app.request('/api/v1/stocks', {
        method: 'POST',
        body: { project_id: 'alice-project', url: `https://youtu.be/${videoId}` },
      });
      expect(response.status).toBe(202);
      const { id } = (await response.json()) as { id: string };
      mockApi();
      const job = (await app.env.DB.prepare(
        "SELECT * FROM processing_jobs WHERE kind='article'",
      ).first<Job>())!;
      await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job.id), mockStep());
      expect(run.mock.calls[0][1].messages[0].content).toContain('動画本編・字幕は未取得');
      expect(run.mock.calls[0][1].messages[0].content).not.toContain('300〜600字');
      const detail = (await (await app.request(`/api/v1/stocks/${id}`)).json()) as {
        stock: { article_id: string; summary: { overview: string } };
      };
      expect(detail).toMatchObject({
        stock: { title: '小さく始めるプロジェクト', status: 'ready', youtube: metadata },
      });
      expect(detail.stock.summary.overview).toContain('小さな検証');
      expect(await (await app.request('/api/v1/stocks')).json()).toMatchObject({
        stocks: [{ youtube: metadata }],
      });
      expect(
        await (await app.request(`/api/v1/articles/${detail.stock.article_id}`)).json(),
      ).toMatchObject({ stock: { youtube: metadata } });
      const content = (await (await app.request(`/api/v1/stocks/${id}/content`)).json()) as {
        content: string;
      };
      expect(content.content).toContain('小さな検証から始める方法を紹介します。');
      expect((await app.request(`/api/v1/stocks/${id}`, { user: 'bob' })).status).toBe(404);
    } finally {
      await app.dispose();
    }
  });
  it('キー未設定の失敗でもURLを保持し、設定後の再試行で取得する', async () => {
    const app = await testApp();
    try {
      app.env.LOCAL_DEMO_ENABLED = 'true';
      const response = await app.request('/api/v1/stocks', {
        method: 'POST',
        body: { project_id: 'alice-project', url: `https://youtu.be/${videoId}` },
      });
      const { id } = (await response.json()) as { id: string };
      const job = (await app.env.DB.prepare(
        "SELECT * FROM processing_jobs WHERE kind='article'",
      ).first<Job>())!;
      mockApi();
      await expect(
        new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job.id), mockStep()),
      ).rejects.toThrow('YOUTUBE_API_KEY');
      expect(await (await app.request(`/api/v1/stocks/${id}`)).json()).toMatchObject({
        stock: { status: 'failed', source_url: `https://youtu.be/${videoId}` },
      });
      Object.assign(app.env, { YOUTUBE_API_KEY: apiKey });
      expect((await app.request(`/api/v1/stocks/${id}/retry`, { method: 'POST' })).status).toBe(
        202,
      );
      const next = (await app.env.DB.prepare(
        "SELECT * FROM processing_jobs WHERE kind='article' ORDER BY revision DESC LIMIT 1",
      ).first<Job>())!;
      await new ArticleWorkflow(app.ctx, app.env).run(mockEvent(next.id), mockStep());
      expect(await (await app.request(`/api/v1/stocks/${id}`)).json()).toMatchObject({
        stock: { status: 'ready', youtube: metadata },
      });
    } finally {
      await app.dispose();
    }
  });
});
