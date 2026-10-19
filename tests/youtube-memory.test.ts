import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Job } from '../server/env';
import type { MemoryData, MemoryCoverage } from '../shared/domain';
import { MemoryWorkflow } from '../server/workflows';
import { mockEvent, mockStep, testApp } from './helpers';

let app: Awaited<ReturnType<typeof testApp>>;
const prompts: { sources?: { articleId: string; note: string }[] }[] = [];
beforeEach(async () => {
  app = await testApp();
  prompts.length = 0;
  app.env.AI = {
    run: vi.fn(async (_model: string, options: { messages: { content: string }[] }) => {
      prompts.push(JSON.parse(options.messages[1].content));
      return { response: { interests: [], knowledge: [], questions: [] } };
    }),
  };
});
afterEach(async () => app.dispose());
async function save(note = '', project_id = 'alice-project') {
  const response = await app.request('/api/v1/stocks', {
    method: 'POST',
    body: { project_id, url: 'https://youtu.be/M7lc1UVf-VE', note },
  });
  expect(response.status).toBe(202);
  return ((await response.json()) as { id: string }).id;
}
async function memory(projectId: string | null) {
  return (await (
    await app.request(`/api/v1/memory${projectId ? `?project_id=${projectId}` : ''}`)
  ).json()) as {
    memory: { article_count: number; data: MemoryData } | null;
    coverage: MemoryCoverage;
  };
}
async function execute(projectId: string | null) {
  const job = await app.env.DB.prepare(
    'SELECT * FROM processing_jobs WHERE kind=? AND target_id=? ORDER BY revision DESC LIMIT 1',
  )
    .bind(projectId ? 'project_memory' : 'user_memory', projectId ?? 'alice')
    .first<Job>();
  expect(job).not.toBeNull();
  await new MemoryWorkflow(app.ctx, app.env).run(mockEvent(job!.id), mockStep());
}
it.each(['note', 'move', 'delete'])(
  'メモのないYouTubeの%sではメモリ更新を起動せず、待機件数にも含めない',
  async (change) => {
    const id = await save(' \n\t　');
    expect((await memory(null)).coverage.waiting_count).toBe(0);
    expect(
      (
        await app.request(`/api/v1/stocks/${id}`, {
          method: change === 'delete' ? 'DELETE' : 'PATCH',
          ...(change === 'delete'
            ? {}
            : {
                body: {
                  note: '',
                  project_id: change === 'move' ? 'alice-second' : 'alice-project',
                },
              }),
        })
      ).status,
    ).toBe(200);
    expect(
      await app.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM processing_jobs WHERE kind LIKE '%memory'",
      ).first(),
    ).toEqual({ n: 0 });
  },
);
it.each(['alice-project', null])(
  'YouTubeのメモだけを取り込み、追加・編集・削除を反映する: %s',
  async (projectId) => {
    const id = await save('手書きの気づき');
    for (const note of ['手書きの気づき', '変更した手書きメモ', '']) {
      if (note !== '手書きの気づき')
        expect(
          (
            await app.request(`/api/v1/stocks/${id}`, {
              method: 'PATCH',
              body: { project_id: 'alice-project', note },
            })
          ).status,
        ).toBe(200);
      prompts.length = 0;
      await execute(projectId);
      const result = await memory(projectId);
      expect(result.memory?.article_count).toBe(note ? 1 : 0);
      expect(result.coverage.waiting_count).toBe(0);
      if (note) expect(JSON.stringify(prompts)).toContain(note);
      else expect(prompts).toEqual([]);
    }
  },
);
it.each(['alice-project', null])(
  '旧取得データを渡さず、メモのない先頭25件を越えて更新対象を読む: %s',
  async (projectId) => {
    const hosts = [
      'youtube.com',
      'm.youtube.com',
      'youtu.be',
      'www.youtube-nocookie.com',
      'WWW.YOUTUBE.COM.',
    ];
    const summaries = JSON.stringify({
      overview: 'OLD_VIDEO_DATA',
      keyPoints: ['OLD_VIDEO_DATA'],
      topics: ['OLD_VIDEO_DATA'],
    });
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < 28; i++) {
      const id = i < 26 ? `a-youtube-${String(i).padStart(2, '0')}` : `z-source-${i}`;
      const youtube = i !== 27;
      const host = youtube ? hosts[i % hosts.length] : 'youtube.com.example.com';
      const url = `https://${host}/watch?v=M7lc1UVf-VE&item=${i}`;
      statements.push(
        app.env.DB.prepare(
          "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,source_type,status,summary_json) VALUES (?,'alice',?,?,'OLD_VIDEO_TITLE',?,'url','ready',?)",
        ).bind(
          id,
          url,
          url,
          host,
          youtube
            ? summaries
            : JSON.stringify({ overview: '通常記事', keyPoints: ['通常記事の要点'], topics: [] }),
        ),
        app.env.DB.prepare(
          "INSERT INTO stocks (id,user_id,project_id,article_id,note) VALUES (?,'alice','alice-project',?,?)",
        ).bind(id, id, i === 26 ? '残しておきたい自分のメモ' : i % 2 ? '' : ' \n\t　'),
      );
    }
    await app.env.DB.batch(statements);
    expect((await memory(projectId)).coverage).toMatchObject({ ready_count: 2, waiting_count: 0 });
    expect(
      (
        await app.request('/api/v1/memory/rebuild', {
          method: 'POST',
          body: { project_id: projectId, mode: 'full' },
        })
      ).status,
    ).toBe(202);
    await execute(projectId);
    expect((await memory(projectId)).memory?.article_count).toBe(2);
    const sources = prompts.flatMap((input) => input.sources ?? []);
    expect(sources.map((source) => source.articleId).sort()).toEqual([
      'z-source-26',
      'z-source-27',
    ]);
    expect(JSON.stringify(prompts)).not.toContain('OLD_VIDEO_DATA');
    // YouTubeの旧取得タイトルも参照せず、手書きメモだけを入力する。
    expect(
      JSON.stringify(sources.find((source) => source.articleId === 'z-source-26')),
    ).not.toContain('OLD_VIDEO_TITLE');
  },
);
it('同じ動画でも、メモを書いた保存先だけをメモリの材料にする', async () => {
  await save('', 'alice-project');
  await save('別の保存先で書いたメモ', 'alice-second');
  expect((await memory('alice-project')).coverage).toMatchObject({
    ready_count: 0,
    waiting_count: 0,
  });
  expect((await memory('alice-second')).coverage).toMatchObject({
    ready_count: 1,
    waiting_count: 0,
  });
  expect((await memory(null)).coverage).toMatchObject({ ready_count: 1, waiting_count: 0 });
});
