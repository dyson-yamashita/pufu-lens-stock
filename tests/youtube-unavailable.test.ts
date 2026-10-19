import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchArticle } from '../server/ingest';
import { ArticleWorkflow } from '../server/workflows';
import type { Env } from '../server/env';
import type { Stock } from '../shared/domain';
import { mockEvent, mockStep, testApp } from './helpers';

const url = 'https://youtu.be/dQw4w9WgXcQ';
afterEach(() => vi.unstubAllGlobals());

describe('YouTubeは外部取得せず記録不可を案内する', () => {
  it.each([
    url,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    'https://youtube.com/playlist?list=example',
    'https://youtube.com/@channel',
    'https://youtu.be/invalid/extra',
    'https://gaming.youtube.com/',
    'https://www.youtube.com./watch?v=dQw4w9WgXcQ',
  ])('DNS・API・ページへ接続せず拒否する: %s', async (source) => {
    const network = vi.fn(async () => {
      throw new Error('外部へ接続してはいけません。');
    });
    vi.stubGlobal('fetch', network);
    await expect(fetchArticle({} as Env, source)).rejects.toThrow(/YouTube.*記録できません/);
    expect(network).not.toHaveBeenCalled();
  });

  it.each([undefined, '補完した動画の説明です。'])(
    'URLと記録不可の理由を残し、本文・要約・問い・メモリの処理を作らない（補完: %s）',
    async (supplemental_text) => {
      const app = await testApp();
      try {
        const response = await app.request('/api/v1/stocks', {
          method: 'POST',
          body: { project_id: 'alice-project', url, note: 'あとで見る', supplemental_text },
        });
        expect(response.status).toBe(202);
        const { id } = (await response.json()) as { id: string };
        const { stock } = (await (await app.request(`/api/v1/stocks/${id}`)).json()) as {
          stock: Stock;
        };
        expect(stock).toMatchObject({
          source_url: url,
          status: 'failed',
          note: 'あとで見る',
          summary: null,
        });
        expect(stock.error).toMatch(/YouTube.*記録できません/);
        expect(await (await app.request(`/api/v1/stocks/${id}/content`)).json()).toEqual({
          content: null,
        });
        expect(
          await app.env.DB.prepare('SELECT input_text, content_key FROM articles').first(),
        ).toEqual({ input_text: null, content_key: null });
        for (const table of ['processing_jobs', 'questions'])
          expect(await app.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).toEqual({
            n: 0,
          });
        expect(await (await app.request('/api/v1/stocks')).json()).toMatchObject({
          stocks: [{ id, status: 'failed', error: stock.error }],
        });
      } finally {
        await app.dispose();
      }
    },
  );

  it.each([{}, { supplemental_text: '補完した動画の説明です。' }])(
    '再試行や本文補完でも処理を再開しない: %j',
    async (body) => {
      const app = await testApp();
      try {
        const { id } = (await (
          await app.request('/api/v1/stocks', {
            method: 'POST',
            body: { project_id: 'alice-project', url },
          })
        ).json()) as { id: string };
        // 旧バージョンで失敗したストックの再試行も拒否する。
        await app.env.DB.prepare("UPDATE articles SET status = 'failed'").run();
        const response = await app.request(`/api/v1/stocks/${id}/retry`, { method: 'POST', body });
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          error: expect.stringMatching(/YouTube.*記録できません/),
        });
        expect(
          await app.env.DB.prepare('SELECT generation, input_text FROM articles').first(),
        ).toEqual({ generation: 1, input_text: null });
      } finally {
        await app.dispose();
      }
    },
  );

  it('重複送信と別プロジェクトへの保存でも記録不可のストックを保持する', async () => {
    const app = await testApp();
    try {
      const options = {
        method: 'POST',
        body: { project_id: 'alice-project', url },
        headers: { 'Idempotency-Key': 'youtube-unavailable' },
      };
      const { id } = (await (await app.request('/api/v1/stocks', options)).json()) as {
        id: string;
      };
      expect(await (await app.request('/api/v1/stocks', options)).json()).toMatchObject({
        id,
        duplicate: true,
      });
      expect(
        (
          await app.request('/api/v1/stocks', {
            method: 'POST',
            body: { project_id: 'alice-second', url },
          })
        ).status,
      ).toBe(202);
      const { stocks } = (await (await app.request('/api/v1/stocks')).json()) as {
        stocks: Stock[];
      };
      expect(stocks).toHaveLength(2);
      expect(
        stocks.every(
          (stock) => stock.status === 'failed' && /記録できません/.test(stock.error ?? ''),
        ),
      ).toBe(true);
      expect(new Set(stocks.map((stock) => stock.article_id)).size).toBe(1);
    } finally {
      await app.dispose();
    }
  });

  it.each(['ready', 'failed', 'queued'])(
    '旧バージョンの同URLがあっても、新規保存・重複再送を記録不可に揃える: %s',
    async (status) => {
      const app = await testApp();
      try {
        const options = {
          method: 'POST',
          body: { project_id: 'alice-project', url },
          headers: { 'Idempotency-Key': 'legacy-youtube-save' },
        };
        const { id } = (await (await app.request('/api/v1/stocks', options)).json()) as {
          id: string;
        };
        const oldSummary = JSON.stringify({
          overview: '以前取得した動画情報',
          keyPoints: ['旧要点'],
          topics: ['旧動画'],
        });
        const restoreLegacy = () =>
          app.env.DB.prepare(
            "UPDATE articles SET title = '旧動画タイトル', status = ?, summary_json = ?, input_text = '旧本文', content_key = 'legacy-body', error = NULL",
          )
            .bind(status, oldSummary)
            .run();
        await app.env.CONTENT.put('legacy-body', '旧本文');
        await restoreLegacy();
        const response = await app.request('/api/v1/stocks', {
          method: 'POST',
          body: { project_id: 'alice-second', url },
        });
        expect(response.status).toBe(202);
        const { id: secondId } = (await response.json()) as { id: string };
        for (const stockId of [id, secondId]) {
          const { stock } = (await (await app.request(`/api/v1/stocks/${stockId}`)).json()) as {
            stock: Stock;
          };
          expect(stock).toMatchObject({
            title: 'YouTube（記録不可）',
            status: 'failed',
            summary: null,
          });
          expect(stock.error).toMatch(/YouTube.*記録できません/);
          expect(await (await app.request(`/api/v1/stocks/${stockId}/content`)).json()).toEqual({
            content: null,
          });
          expect(
            await (await app.request(`/api/v1/articles/${stock.article_id}`)).json(),
          ).toMatchObject({ stock: { summary: null, status: 'failed' } });
        }
        expect(await (await app.request('/api/v1/stocks?detail=compact')).json()).toMatchObject({
          stocks: [
            { title: 'YouTube（記録不可）', summary_excerpt: null, status: 'failed' },
            { title: 'YouTube（記録不可）', summary_excerpt: null, status: 'failed' },
          ],
        });
        const publication = (await (
          await app.request('/api/v1/projects/alice-second/publication', {
            method: 'PATCH',
            body: { is_public: true, public_description: '' },
          })
        ).json()) as { publication: { public_id: string } };
        expect(
          await (
            await app.request(`/api/public/projects/${publication.publication.public_id}/stocks`)
          ).json(),
        ).toMatchObject({ items: [{ title: 'YouTube（記録不可）', summary: null }] });
        await restoreLegacy();
        expect(await (await app.request('/api/v1/stocks', options)).json()).toMatchObject({
          id,
          duplicate: true,
        });
        expect(await (await app.request(`/api/v1/stocks/${id}`)).json()).toMatchObject({
          stock: {
            status: 'failed',
            summary: null,
            error: expect.stringMatching(/YouTube.*記録できません/),
          },
        });
        // 案内へ切り替えても過去データは一括削除しない。
        expect(
          await app.env.DB.prepare(
            'SELECT summary_json, input_text, content_key FROM articles',
          ).first(),
        ).toEqual({ summary_json: oldSummary, input_text: '旧本文', content_key: 'legacy-body' });
        expect(await (await app.env.CONTENT.get('legacy-body'))!.text()).toBe('旧本文');
        expect(
          await app.env.DB.prepare('SELECT COUNT(*) AS n FROM processing_jobs').first(),
        ).toEqual({ n: 0 });
      } finally {
        await app.dispose();
      }
    },
  );

  it('処理待ちだったYouTube URLも、補完本文からAI処理へ進めない', async () => {
    const app = await testApp();
    try {
      await app.request('/api/v1/stocks', {
        method: 'POST',
        body: { project_id: 'alice-project', url },
      });
      await app.env.DB.batch([
        app.env.DB.prepare(
          "UPDATE articles SET status = 'queued', input_text = '旧バージョンで補完した本文'",
        ),
        app.env.DB.prepare(
          "INSERT OR IGNORE INTO processing_jobs (id, user_id, kind, target_id, revision) SELECT 'legacy-youtube', user_id, 'article', id, generation FROM articles",
        ),
      ]);
      const run = vi.fn(async () => {
        throw new Error('YouTubeをAI処理してはいけません。');
      });
      app.env.AI = { run };
      await expect(
        new ArticleWorkflow(app.ctx, app.env).run(mockEvent('legacy-youtube'), mockStep()),
      ).rejects.toThrow(/YouTube.*記録できません/);
      expect(run).not.toHaveBeenCalled();
      expect(
        await app.env.DB.prepare('SELECT status, content_key, summary_json FROM articles').first(),
      ).toEqual({ status: 'failed', content_key: null, summary_json: null });
    } finally {
      await app.dispose();
    }
  });

  it('保存済みのYouTubeメタデータをAPIから返さない', async () => {
    const app = await testApp();
    try {
      const { id } = (await (
        await app.request('/api/v1/stocks', {
          method: 'POST',
          body: { project_id: 'alice-project', url },
        })
      ).json()) as { id: string };
      await app.env.DB.prepare('UPDATE articles SET youtube_json = ?')
        .bind(JSON.stringify({ thumbnailUrl: 'https://i.ytimg.com/vi/old/default.jpg' }))
        .run();
      const { stock } = (await (await app.request(`/api/v1/stocks/${id}`)).json()) as {
        stock: Stock;
      };
      for (const path of [
        `/api/v1/stocks/${id}`,
        `/api/v1/articles/${stock.article_id}`,
        '/api/v1/stocks',
      ]) {
        const result = (await (await app.request(path)).json()) as {
          stock?: Stock;
          stocks?: Stock[];
        };
        expect(result.stock ?? result.stocks![0]).not.toHaveProperty('youtube');
        expect(JSON.stringify(result)).not.toContain('ytimg.com');
      }
    } finally {
      await app.dispose();
    }
  });
});
