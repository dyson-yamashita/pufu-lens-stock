import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectScoreModel } from '@goto-lab/pufu-editor';
import { elementKeys, type PufuScore } from '../shared/pufu';
import worker from '../server/index';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';
import { searchBindings } from './search-helpers';
import { syncSearchIndex } from '../server/search-index';
import * as imageRenderer from '../server/pufu-renderer';
import { readFile } from 'node:fs/promises';
import imageScore from './fixtures/pufu-sparse.json';

type Result = {
  result: {
    isError?: boolean;
    structuredContent: Record<string, unknown>;
    content?: { type: string; text: string; data?: string; mimeType?: string }[];
    tools?: { name: string; annotations: { readOnlyHint: boolean } }[];
  };
};
describe('MCPによるストックと問いの取得・追加', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
  });
  afterEach(async () => {
    await app.dispose();
  });
  let id = 0;
  async function rpc(token: string, method: string, params: unknown = {}) {
    const response = await worker.fetch(
      new Request(`${app.env.APP_URL}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Host: new URL(app.env.APP_URL).host,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      }),
      app.env,
      app.ctx,
    );
    expect(response.status, response.status === 200 ? '' : await response.clone().text()).toBe(200);
    if (response.headers.get('Content-Type')?.includes('application/json'))
      return (await response.json()) as Result;
    const messages = (await response.text())
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as Result & { id?: number });
    return messages.find((message) => message.id === id)!;
  }
  const call = (token: string, name: string, args: unknown = {}) =>
    rpc(token, 'tools/call', { name, arguments: args });
  async function seedStock(
    name: string,
    savedAt: string,
    owner = 'alice',
    projectId = `${owner}-project`,
  ) {
    const summary = {
      overview: '😀'.repeat(210),
      keyPoints: ['要点だけの検索語'],
      topics: ['トピックだけの検索語'],
    };
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,source_type,input_text,status,summary_json) VALUES (?,?,?,'',?,'','text',?,'ready',?)",
      ).bind(
        name,
        owner,
        `text:${name}`,
        `MCP資料 ${name}`,
        '本文だけの検索語',
        JSON.stringify(summary),
      ),
      app.env.DB.prepare(
        'INSERT INTO stocks (id,user_id,project_id,article_id,note,is_favorite,created_at) VALUES (?,?,?,?,?,1,?)',
      ).bind(`stock-${name}`, owner, projectId, name, 'メモだけの検索語', savedAt),
    ]);
  }

  function score(): PufuScore & ProjectScoreModel {
    const node = (text: string) => ({
      uuid: crypto.randomUUID(),
      text,
      comment: { color: 'blue' as const, text: '保存済みのコメント\n改行も保持' },
    });
    return {
      gainingGoal: node('獲得目標'),
      winCondition: node('勝利条件'),
      purposes: [
        {
          ...node('2番目という名前の最初の目的'),
          measures: ['red', 'green', 'yellow', 'blue', 'white'].map((color, index) => ({
            ...node(`施策${5 - index}`),
            color: color as PufuScore['purposes'][number]['measures'][number]['color'],
            comment: { color: index % 2 ? 'green' : 'red', text: `コメント${index}` },
            ...(index === 0 ? { id: 'saved-id', progress: 0 } : {}),
            ...(index === 1 ? { progress: 100 } : {}),
            ...(index === 2 ? { progress: 42.5 } : {}),
          })),
        },
        { ...node('1番目という名前の最後の目的'), measures: [] },
      ],
      elements: Object.fromEntries(
        elementKeys.map((key) => [key, node(key)]),
      ) as PufuScore['elements'],
    };
  }
  async function seedPufu(
    questionId: string,
    json: string | null,
    options: { id?: string; status?: string; phase?: number; createdAt?: string } = {},
  ) {
    const pufuId = options.id ?? crypto.randomUUID();
    await app.env.DB.prepare(
      `INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,generated_json,score_json,
      editor_version,status,current_phase,created_at,updated_at)
      SELECT ?,p.user_id,q.id,'課題','{"userMemory":"SECRET_CONTEXT"}','SECRET_GENERATED',?,
      '0.9.15',?,?,?,'2026-10-20T09:00:00Z' FROM questions q JOIN projects p ON p.id=q.project_id WHERE q.id=?`,
    )
      .bind(
        pufuId,
        json,
        options.status ?? 'ready',
        options.phase ?? 1,
        options.createdAt ?? '2026-10-20T08:00:00Z',
        questionId,
      )
      .run();
    return pufuId;
  }

  it('プ譜画像をリクエスト時に1回生成し、PNGのimage contentだけに返す', async () => {
    const token = await mcpToken(app, 'alice-project');
    const question = (
      await call(token, 'add_question', {
        project_id: 'alice-project',
        text: '画像で確認',
        request_id: crypto.randomUUID(),
      })
    ).result.structuredContent.question as { id: string };
    expect(
      (await call(token, 'get_pufu_image', { question_id: question.id })).result.structuredContent,
    ).toMatchObject({ status: 'not_created' });
    await seedPufu(question.id, JSON.stringify(imageScore));
    app.env.ASSETS = {
      fetch: async () =>
        new Response(await readFile(new URL('../public/fonts/pufu-jp.otf', import.meta.url))),
    } as unknown as Fetcher;
    const snapshot = () =>
      app.env.DB.batch([
        app.env.DB.prepare('SELECT * FROM pufu_scores'),
        app.env.DB.prepare('SELECT * FROM pufu_phases'),
        app.env.DB.prepare('SELECT * FROM processing_jobs'),
      ]).then((results) => results.map((r) => r.results));
    const before = await snapshot();
    const render = vi.spyOn(imageRenderer, 'renderSavedPufu');
    const run = vi.fn();
    app.env.AI = { run };
    const result = (await call(token, 'get_pufu_image', { question_id: question.id })).result;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: 'ready',
      mime_type: 'image/png',
      phase: 1,
    });
    const image = result.content?.find((item) => item.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    expect(Buffer.from(image!.data!, 'base64').subarray(0, 8).toString('hex')).toBe(
      '89504e470d0a1a0a',
    );
    expect(JSON.stringify(result.structuredContent)).not.toContain(image!.data!);
    expect(JSON.stringify(result)).not.toContain('/mcp-pufu-images/');
    const imageUrl = String(result.structuredContent.image_url);
    expect(imageUrl).toMatch(/^http:\/\/localhost:5173\/api\/pufu-images\/[A-Za-z0-9_-]{43}\.png$/);
    const anonymous = { headers: { Cookie: '', Origin: '' } };
    const preview = await app.request(new URL(imageUrl).pathname, anonymous);
    expect(preview.status).toBe(200);
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(Buffer.from(image!.data!, 'base64'));
    const downloadUrl = new URL(String(result.structuredContent.download_url));
    const download = await app.request(downloadUrl.pathname + downloadUrl.search, anonymous);
    expect(download.headers.get('Content-Disposition')).toContain('attachment');
    expect(
      result.content?.some(
        (item) =>
          item.type === 'text' && item.text.includes('show_pufu') && item.text.includes(imageUrl),
      ),
    ).toBe(true);
    expect(
      result.content
        ?.filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n'),
    ).not.toMatch(/!\[[^\]]*\]\(/);
    expect(JSON.stringify(result)).not.toContain('SECRET_');
    expect(await snapshot()).toEqual(before);
    expect(render).toHaveBeenCalledTimes(1);
    render.mockRestore();
    expect(run).not.toHaveBeenCalled();
    const other = await mcpToken(app, 'alice-second');
    expect(
      (await call(other, 'get_pufu_image', { question_id: question.id })).result,
    ).toMatchObject({ isError: true, structuredContent: { status: 404 } });
    const noRead = await mcpToken(app, null, ['projects:read']);
    expect(
      (await call(noRead, 'get_pufu_image', { question_id: question.id })).result,
    ).toMatchObject({ isError: true, structuredContent: { status: 403 } });
  });

  it('問い詳細のプ譜一覧からIDを選び、複数のプ譜のJSON・PNGを取得できる', async () => {
    const token = await mcpToken(app, 'alice-project');
    const create = async (text: string) =>
      (
        await call(token, 'add_question', {
          project_id: 'alice-project',
          text,
          request_id: crypto.randomUUID(),
        })
      ).result.structuredContent.question as { id: string };
    const question = await create('複数のプ譜を選ぶ');
    const unrelated = await create('別の問い');
    const original = score();
    const newer = score();
    newer.gainingGoal.text = '別のプ譜の目標';
    await seedPufu(question.id, JSON.stringify(original), {
      id: 'chosen-pufu',
      createdAt: '2026-10-19',
    });
    await seedPufu(question.id, JSON.stringify(newer), {
      id: 'newer-pufu',
      createdAt: '2026-10-20',
    });
    const detail = (await call(token, 'get_question', { question_id: question.id })).result
      .structuredContent;
    expect(detail.pufus).toMatchObject([
      { id: 'newer-pufu', status: 'ready' },
      { id: 'chosen-pufu', status: 'ready' },
    ]);
    expect(JSON.stringify(detail)).not.toContain('SECRET_');
    const selected = { question_id: question.id, pufu_id: 'chosen-pufu' };
    const json = (await call(token, 'get_pufu', selected)).result;
    expect(json.isError).not.toBe(true);
    expect(json.structuredContent).toMatchObject({ ...selected, projectScore: original });
    expect(
      (await call(token, 'get_pufu', { ...selected, pufu_id: 'newer-pufu' })).result
        .structuredContent,
    ).toMatchObject({ pufu_id: 'newer-pufu', projectScore: newer });
    app.env.ASSETS = {
      fetch: async () =>
        new Response(await readFile(new URL('../public/fonts/pufu-jp.otf', import.meta.url))),
    } as unknown as Fetcher;
    const render = vi.spyOn(imageRenderer, 'renderSavedPufu');
    try {
      const image = (await call(token, 'get_pufu_image', selected)).result;
      expect(image.isError).not.toBe(true);
      expect(image.structuredContent).toMatchObject({
        ...selected,
        status: 'ready',
        mime_type: 'image/png',
      });
      expect(
        image.content?.some((item) => item.type === 'image' && item.mimeType === 'image/png'),
      ).toBe(true);
      expect(render).toHaveBeenCalledExactlyOnceWith(app.env, original);
      for (const tool of ['get_pufu', 'get_pufu_image']) {
        expect(
          (await call(token, tool, { ...selected, question_id: unrelated.id })).result,
        ).toMatchObject({ isError: true, structuredContent: { status: 404 } });
        for (const pufu_id of ['missing', 'image'])
          expect((await call(token, tool, { ...selected, pufu_id })).result).toMatchObject({
            isError: true,
            structuredContent: { status: 404 },
          });
        const restricted = await mcpToken(app, 'alice-second');
        expect((await call(restricted, tool, selected)).result).toMatchObject({
          isError: true,
          structuredContent: { status: 404 },
        });
      }
      expect(render).toHaveBeenCalledTimes(1);
    } finally {
      render.mockRestore();
    }
  });
  it('問いIDから保存済みの最新局面をEditor形式のまま取得し、DB更新・生成を行わない', async () => {
    const token = await mcpToken(app, 'alice-project');
    const question = (
      await call(token, 'add_question', {
        project_id: 'alice-project',
        text: '保存したプ譜をレビューしたい',
        request_id: crypto.randomUUID(),
      })
    ).result.structuredContent.question as { id: string };
    expect(
      (await call(token, 'get_question', { question_id: question.id })).result.structuredContent
        .question,
    ).toMatchObject(question);
    const questions = (await call(token, 'list_questions')).result.structuredContent.questions as {
      id: string;
    }[];
    expect(questions.map((item) => item.id)).toContain(question.id);
    await seedPufu(question.id, JSON.stringify(score()), { id: 'old', createdAt: '2026-10-19' });
    const pufuId = await seedPufu(question.id, JSON.stringify(score()));
    await seedPufu(question.id, null, { status: 'queued', createdAt: '2026-10-21' });
    const saved = score();
    expect(
      (
        await app.request(`/api/v1/pufus/${pufuId}/phases`, {
          method: 'POST',
          body: { revision: 1, phase: 1, score: saved },
        })
      ).status,
    ).toBe(201);
    saved.purposes.reverse();
    saved.purposes[1].measures.reverse();
    expect(
      (
        await app.request(`/api/v1/pufus/${pufuId}`, {
          method: 'PATCH',
          body: { revision: 2, phase: 2, score: saved },
        })
      ).status,
    ).toBe(200);
    const snapshot = () =>
      app.env.DB.batch<Record<string, unknown>>([
        app.env.DB.prepare('SELECT * FROM pufu_scores ORDER BY id'),
        app.env.DB.prepare('SELECT * FROM pufu_phases ORDER BY pufu_id,number'),
        app.env.DB.prepare('SELECT * FROM processing_jobs ORDER BY id'),
        app.env.DB.prepare('SELECT * FROM ai_calls ORDER BY id'),
      ]).then((results) => results.map((item) => item.results));
    const before = await snapshot();
    const run = vi.fn();
    app.env.AI = { run };
    vi.mocked(app.env.ARTICLE_WORKFLOW.create).mockClear();
    const response = (await call(token, 'get_pufu', { question_id: question.id })).result;
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual({
      question_id: question.id,
      project_id: 'alice-project',
      updated_at: before[0].find((row) => row.id === pufuId)!.updated_at,
      projectScore: saved,
    });
    expect(JSON.parse(response.content![0].text)).toEqual(response.structuredContent);
    expect(JSON.stringify(response)).not.toContain('SECRET_');
    expect(await snapshot()).toEqual(before);
    expect(run).not.toHaveBeenCalled();
    expect(app.env.ARTICLE_WORKFLOW.create).not.toHaveBeenCalled();
  });

  it.each([undefined, 'queued', 'generating', 'failed'])(
    '完成したプ譜がない問いはnullを返す（状態: %s）',
    async (status) => {
      const question = await app.request('/api/v1/questions', {
        method: 'POST',
        body: { project_id: 'alice-project', text: '未作成' },
      });
      const questionId = ((await question.json()) as { question: { id: string } }).question.id;
      if (status) await seedPufu(questionId, null, { status });
      const token = await mcpToken(app, 'alice-project', ['questions:read']);
      expect((await call(token, 'get_pufu', { question_id: questionId })).result).toMatchObject({
        structuredContent: {
          question_id: questionId,
          project_id: 'alice-project',
          updated_at: null,
          projectScore: null,
        },
      });
      expect(
        (await app.env.DB.prepare('SELECT COUNT(*) AS count FROM pufu_phases').first())!.count,
      ).toBe(0);
    },
  );

  it('局面行が未作成の旧データも移行せず取得し、更新日時が不明ならnullを返す', async () => {
    const created = await app.request('/api/v1/questions', {
      method: 'POST',
      body: { project_id: 'alice-project', text: '旧データ' },
    });
    const { question } = (await created.json()) as { question: { id: string } };
    const saved = score();
    const pufuId = await seedPufu(question.id, JSON.stringify(saved));
    await app.env.DB.prepare('UPDATE pufu_scores SET updated_at=? WHERE id=?')
      .bind('unknown', pufuId)
      .run();
    const response = await app.request(`/api/v1/questions/${question.id}/pufu`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      question_id: question.id,
      project_id: 'alice-project',
      updated_at: null,
      projectScore: saved,
    });
    expect(await app.env.DB.prepare('SELECT COUNT(*) AS count FROM pufu_phases').first()).toEqual({
      count: 0,
    });
    const token = await mcpToken(app, null, ['questions:read']);
    expect(
      (await call(token, 'get_pufu', { question_id: question.id })).result.structuredContent,
    ).toMatchObject({ projectScore: saved, updated_at: null });
  });

  it('存在しない問い・許可外プロジェクト・他ユーザー・scope不足を既存方針で拒否する', async () => {
    for (const project_id of ['alice-second', 'bob-project']) {
      const owner = project_id === 'bob-project' ? 'bob' : 'alice';
      const response = await app.request('/api/v1/questions', {
        method: 'POST',
        user: owner,
        body: { project_id, text: '非公開' },
      });
      const { question } = (await response.json()) as { question: { id: string } };
      await seedPufu(question.id, '{broken');
      const token = await mcpToken(app, 'alice-project', ['questions:read']);
      expect((await call(token, 'get_pufu', { question_id: question.id })).result).toMatchObject({
        isError: true,
        structuredContent: { status: 404 },
      });
    }
    const token = await mcpToken(app, null, ['questions:read']);
    expect((await call(token, 'get_pufu', { question_id: 'missing' })).result).toMatchObject({
      isError: true,
      structuredContent: { status: 404 },
    });
    const noRead = await mcpToken(app, null, ['stocks:read']);
    expect((await call(noRead, 'get_pufu', { question_id: 'missing' })).result).toMatchObject({
      isError: true,
      structuredContent: { status: 403 },
    });
    for (const args of [{}, { question_id: '' }, { question_id: 1 }])
      expect((await call(token, 'get_pufu', args)).result.isError).toBe(true);
  });

  it.each([
    'broken-json',
    'null',
    'progress',
    'unknown-field',
    'missing-phase',
    'missing-score',
    'oversized',
  ])('破損・不整合・サイズ超過をnullや切り詰めで隠さない: %s', async (kind) => {
    const response = await app.request('/api/v1/questions', {
      method: 'POST',
      body: { project_id: 'alice-project', text: '形式検証' },
    });
    const { question } = (await response.json()) as { question: { id: string } };
    const document: Record<string, unknown> = { ...score() };
    if (kind === 'progress') (document as PufuScore).purposes[0].measures[0].progress = 101;
    if (kind === 'unknown-field') document.risks = [];
    if (kind === 'oversized') {
      const purposes = Array.from({ length: 12 }, () => ({
        ...score().purposes[0],
        uuid: crypto.randomUUID(),
        measures: Array.from({ length: 12 }, () => ({
          ...score().purposes[0].measures[0],
          uuid: crypto.randomUUID(),
          id: 'saved',
          text: 'あ'.repeat(1200),
          comment: { color: 'blue', text: 'あ'.repeat(600) },
        })),
      }));
      document.purposes = purposes;
    }
    const json =
      kind === 'broken-json'
        ? '{broken'
        : kind === 'null'
          ? 'null'
          : kind === 'missing-score'
            ? null
            : JSON.stringify(document);
    await seedPufu(question.id, json, { phase: kind === 'missing-phase' ? 2 : 1 });
    const token = await mcpToken(app, null, ['questions:read']);
    expect((await call(token, 'get_pufu', { question_id: question.id })).result).toMatchObject({
      isError: true,
      structuredContent: { status: kind === 'oversized' ? 413 : 500 },
    });
  });

  it('長い日本語のハイブリッド検索でもOAuthの読み取り権限と保存先の制限を維持する', async () => {
    const bindings = searchBindings(app.env);
    await seedStock('hybrid', '2026-10-20T00:00:00.000Z');
    await seedStock('outside', '2026-10-20T00:00:00.000Z', 'alice', 'alice-second');
    await syncSearchIndex(app.env);
    const token = await mcpToken(app, 'alice-project');
    const response = (
      await call(token, 'list_stocks', {
        q: 'AIエージェントの安全性と品質を保つ方法',
        mode: 'hybrid',
        limit: 1,
      })
    ).result;
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      stocks: [{ id: 'stock-hybrid' }],
      total: 1,
      search: { requested_mode: 'hybrid', mode: 'hybrid' },
      sort_by: 'relevance',
    });
    bindings.run.mockClear();
    const denied = (
      await call(token, 'list_stocks', { q: '関連', mode: 'semantic', project_id: 'alice-second' })
    ).result;
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent.status).toBe(403);
    expect(bindings.run).not.toHaveBeenCalled();
    const noRead = await mcpToken(app, 'alice-project', ['questions:read']);
    expect((await call(noRead, 'list_stocks', { q: '関連', mode: 'hybrid' })).result.isError).toBe(
      true,
    );
    expect(bindings.run).not.toHaveBeenCalled();
  });

  it('既定の一覧は短い抜粋だけを返し、必要な詳細と本文は明示して取得できる', async () => {
    await seedStock('only', '2026-10-17T00:00:00.000Z');
    const token = await mcpToken(app, 'alice-project');
    const response = (
      await call(token, 'list_stocks', { limit: 5, sort_by: 'created_at', order: 'desc' })
    ).result;
    const data = response.structuredContent as {
      stocks: Record<string, unknown>[];
      pageSize: number;
      detail: string;
    };
    expect(data).toMatchObject({
      pageSize: 5,
      detail: 'compact',
      sort_by: 'created_at',
      order: 'desc',
      has_more: false,
    });
    const stock = data.stocks[0];
    expect(stock).toEqual({
      id: 'stock-only',
      title: 'MCP資料 only',
      project_id: 'alice-project',
      project_name: 'Alice project',
      created_at: '2026-10-17T00:00:00.000Z',
      status: 'ready',
      summary_excerpt: '😀'.repeat(199) + '…',
      summary_truncated: true,
    });
    expect(response.content?.[0].type).toBe('text');
    expect(JSON.parse(response.content![0].text)).toEqual(data);
    const full = (await call(token, 'list_stocks', { detail: 'full' })).result
      .structuredContent as { stocks: Record<string, unknown>[] };
    expect(full.stocks[0]).toMatchObject({
      is_favorite: 1,
      note: 'メモだけの検索語',
      summary: { overview: '😀'.repeat(210), keyPoints: ['要点だけの検索語'] },
    });
    const detail = (await call(token, 'get_stock', { stock_id: 'stock-only' })).result
      .structuredContent;
    expect(detail.stock).toEqual(full.stocks[0]);
    expect(detail).not.toHaveProperty('content');
    expect(
      (await call(token, 'get_stock', { stock_id: 'stock-only', include_content: true })).result
        .structuredContent,
    ).toMatchObject({ content: '本文だけの検索語', content_truncated: false });
    const rest = (await (await app.request('/api/v1/stocks')).json()) as {
      stocks: unknown[];
      pageSize: number;
    };
    expect(rest.pageSize).toBe(24);
    expect(rest.stocks[0]).toEqual(full.stocks[0]);
  });

  it('件数・保存日時順・同時刻のID順でページを分割し、許可された保存先だけを返す', async () => {
    await seedStock('z', '2026-10-15T00:00:00.000Z');
    await seedStock('m', '2026-10-16T00:00:00.000Z');
    await seedStock('a', '2026-10-17T00:00:00.000Z');
    await seedStock('b', '2026-10-17T00:00:00.000Z');
    await seedStock('outside', '2026-10-19T00:00:00.000Z', 'alice', 'alice-second');
    await seedStock('bob', '2026-10-20T00:00:00.000Z', 'bob');
    const token = await mcpToken(app, 'alice-project');
    async function list(args = {}) {
      const data = (
        await call(token, 'list_stocks', {
          limit: 2,
          source: 'user',
          favorite: true,
          status: 'ready',
          ...args,
        })
      ).result.structuredContent as { stocks: { id: string }[] };
      return { ...data, ids: data.stocks.map((stock) => stock.id) };
    }
    expect(await list()).toMatchObject({
      ids: ['stock-b', 'stock-a'],
      total: 4,
      page: 1,
      pageSize: 2,
      has_more: true,
    });
    expect(await list({ page: 2 })).toMatchObject({
      ids: ['stock-m', 'stock-z'],
      total: 4,
      page: 2,
      pageSize: 2,
      has_more: false,
    });
    expect(await list({ limit: 1 })).toMatchObject({ ids: ['stock-b'], total: 4, pageSize: 1 });
    expect(await list({ order: 'asc' })).toMatchObject({ ids: ['stock-z', 'stock-m'], total: 4 });
    expect(await list({ order: 'asc', page: 2 })).toMatchObject({
      ids: ['stock-a', 'stock-b'],
      total: 4,
      has_more: false,
    });
  });

  it('軽量表示でも要点・メモを検索し、本文だけの語は検索対象にしない', async () => {
    await seedStock('search', '2026-10-17T00:00:00.000Z');
    const token = await mcpToken(app, 'alice-project');
    for (const q of ['MCP資料', '要点だけの検索語', 'トピックだけの検索語', 'メモだけの検索語'])
      expect(
        (await call(token, 'list_stocks', { q, limit: 1 })).result.structuredContent,
      ).toMatchObject({ total: 1, stocks: [{ id: 'stock-search' }] });
    expect(
      (await call(token, 'list_stocks', { q: '本文だけの検索語' })).result.structuredContent.total,
    ).toBe(0);
  });

  it.each([
    { limit: 0 },
    { limit: 25 },
    { limit: 1.5 },
    { sort_by: 'title' },
    { order: 'desc; DROP TABLE stocks' },
    { detail: 'unknown' },
  ])('不正な一覧オプションを拒否する: %j', async (args) => {
    const token = await mcpToken(app, 'alice-project');
    expect((await call(token, 'list_stocks', args)).result.isError).toBe(true);
  });

  it('軽量表示と詳細表示のどちらも読み取り権限を要求する', async () => {
    const token = await mcpToken(app, null, ['projects:read']);
    for (const detail of ['compact', 'full'])
      expect((await call(token, 'list_stocks', { detail, limit: 1 })).result).toMatchObject({
        isError: true,
        structuredContent: { status: 403 },
      });
  });

  it('初期化・ツール列挙・検索・URL/テキスト保存・独立した問いの追加と再送が動く', async () => {
    const token = await mcpToken(app, 'alice-project');
    const initialized = await rpc(token, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(initialized.result).toHaveProperty('serverInfo');
    const listed = await rpc(token, 'tools/list');
    expect(listed.result.tools?.map((tool) => tool.name).sort()).toEqual([
      'add_comment',
      'add_question',
      'add_stock',
      'get_pufu',
      'get_pufu_image',
      'get_question',
      'get_stock',
      'list_comments',
      'list_projects',
      'list_questions',
      'list_stocks',
      'show_pufu',
    ]);
    expect(listed.result.tools?.find((tool) => tool.name === 'get_pufu_image')).toMatchObject({
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    });
    expect(listed.result.tools?.find((tool) => tool.name === 'get_pufu')).toMatchObject({
      annotations: { readOnlyHint: true },
      securitySchemes: [{ type: 'oauth2', scopes: ['questions:read'] }],
      inputSchema: { required: ['question_id'] },
    });
    expect(
      listed.result.tools?.find((tool) => tool.name === 'get_stock')?.annotations.readOnlyHint,
    ).toBe(true);
    expect(listed.result.tools?.find((tool) => tool.name === 'add_question')).toHaveProperty(
      'securitySchemes',
      [{ type: 'oauth2', scopes: ['questions:write'] }],
    );
    expect(listed.result.tools?.find((tool) => tool.name === 'get_stock')).toHaveProperty(
      'inputSchema.required',
      ['stock_id'],
    );
    const projects = await call(token, 'list_projects');
    expect(projects.result.structuredContent.projects).toEqual([
      expect.objectContaining({ id: 'alice-project' }),
    ]);
    const input = {
      type: 'text',
      project_id: 'alice-project',
      title: 'MCPの検討',
      text: '会話から保存した本文',
      request_id: crypto.randomUUID(),
    };
    const saved = await call(token, 'add_stock', input);
    expect(saved.result.isError).not.toBe(true);
    const stockId = saved.result.structuredContent.id;
    expect((await call(token, 'add_stock', input)).result.structuredContent).toMatchObject({
      id: stockId,
      duplicate: true,
    });
    const detail = (await call(token, 'get_stock', { stock_id: stockId, include_content: true }))
      .result.structuredContent;
    expect(detail.content).toBe('会話から保存した本文');
    expect((await call(token, 'list_stocks', { q: 'MCP' })).result.structuredContent.total).toBe(1);
    expect(
      (
        await call(token, 'add_stock', {
          type: 'url',
          project_id: 'alice-project',
          url: 'https://example.com/mcp',
          request_id: crypto.randomUUID(),
        })
      ).result.isError,
    ).not.toBe(true);
    const questionInput = {
      project_id: 'alice-project',
      text: '会話から問いを保存できるか？',
      request_id: crypto.randomUUID(),
    };
    const question = (await call(token, 'add_question', questionInput)).result.structuredContent
      .question as { id: string };
    expect(
      (await call(token, 'add_question', questionInput)).result.structuredContent.question,
    ).toMatchObject({ id: question.id });
    expect(
      (await call(token, 'get_question', { question_id: question.id })).result.structuredContent
        .question,
    ).toMatchObject({ stock_id: null });
    expect(
      (await call(token, 'list_questions', { q: '会話' })).result.structuredContent.total,
    ).toBe(1);
  });
  it.each([false, true])(
    'メモ付きの問いを登録し、登録結果と詳細から取得できる（記事あり=%s）',
    async (withStock) => {
      const token = await mcpToken(app, 'alice-project');
      if (withStock) await seedStock('note-source', '2026-10-24T00:00:00Z');
      const note = '  気になった理由\n次に試すこと  ';
      const args = {
        project_id: 'alice-project',
        ...(withStock ? { stock_id: 'stock-note-source' } : {}),
        text: 'メモと一緒に考えたい問い',
        note,
        request_id: crypto.randomUUID(),
      };
      const result = (await call(token, 'add_question', args)).result;
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.question).toMatchObject({
        note,
        text: 'メモと一緒に考えたい問い',
        stock_id: withStock ? 'stock-note-source' : null,
      });
      const { id } = result.structuredContent.question as { id: string };
      expect(
        (await call(token, 'get_question', { question_id: id })).result.structuredContent.question,
      ).toMatchObject({ note });
      expect(
        (await call(token, 'add_question', args)).result.structuredContent.question,
      ).toMatchObject({ id, note });
      expect(
        await app.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM questions WHERE source='user'",
        ).first(),
      ).toEqual({ count: 1 });
      if (withStock)
        expect(
          await app.env.DB.prepare("SELECT note FROM stocks WHERE id='stock-note-source'").first(),
        ).toEqual({ note: 'メモだけの検索語' });
    },
  );

  it('問いの登録メモは2,000文字まで受け付け、超過・不正な型では問いも保存しない', async () => {
    const token = await mcpToken(app, 'alice-project');
    const args = { project_id: 'alice-project', text: '長さを確かめる問い' };
    const accepted = (
      await call(token, 'add_question', {
        ...args,
        note: 'あ'.repeat(2000),
        request_id: crypto.randomUUID(),
      })
    ).result;
    expect(accepted.isError).not.toBe(true);
    expect(accepted.structuredContent.question).toMatchObject({ note: 'あ'.repeat(2000) });
    for (const note of ['あ'.repeat(2001), null, 123])
      expect(
        (await call(token, 'add_question', { ...args, note, request_id: crypto.randomUUID() }))
          .result.isError,
      ).toBe(true);
    expect(await app.env.DB.prepare('SELECT COUNT(*) AS count FROM questions').first()).toEqual({
      count: 1,
    });
  });

  it('メモが異なる再送を拒否し、省略と空文字の再送では1件に保つ', async () => {
    const token = await mcpToken(app, 'alice-project');
    const args = {
      project_id: 'alice-project',
      text: '再送を確認する問い',
      request_id: crypto.randomUUID(),
    };
    const first = (await call(token, 'add_question', { ...args, note: '元のメモ' })).result;
    expect(first.isError).not.toBe(true);
    const { id } = first.structuredContent.question as { id: string };
    for (const extra of [{ note: '別のメモ' }, {}])
      expect((await call(token, 'add_question', { ...args, ...extra })).result).toMatchObject({
        isError: true,
        structuredContent: { status: 409 },
      });
    expect(
      (await call(token, 'get_question', { question_id: id })).result.structuredContent.question,
    ).toMatchObject({ note: '元のメモ' });
    const empty = { ...args, request_id: crypto.randomUUID() };
    for (const extra of [{ note: '' }, {}]) {
      const result = (await call(token, 'add_question', { ...empty, ...extra })).result;
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.question).toMatchObject({ note: '' });
    }
    expect(await app.env.DB.prepare('SELECT COUNT(*) AS count FROM questions').first()).toEqual({
      count: 2,
    });
  });

  it('全体一覧の非表示設定を反映し、プロジェクト指定・接続先限定では表示する', async () => {
    await seedStock('hidden', '2026-10-20');
    await seedStock('visible', '2026-10-19', 'alice', 'alice-second');
    await app.env.DB.batch([
      app.env.DB.prepare("UPDATE projects SET show_in_all_lists=0 WHERE id='alice-project'"),
      app.env.DB.prepare(
        "INSERT INTO questions(id,project_id,text,source,status) VALUES ('hidden-question','alice-project','隠す問い','user','ready'), ('visible-question','alice-second','表示する問い','user','ready')",
      ),
    ]);
    const token = await mcpToken(app);
    const scoped = await mcpToken(app, 'alice-project');
    expect((await call(token, 'list_projects')).result.structuredContent.projects).toContainEqual(
      expect.objectContaining({ id: 'alice-project', show_in_all_lists: false }),
    );
    for (const [tool, key, visibleId, hiddenId] of [
      ['list_stocks', 'stocks', 'stock-visible', 'stock-hidden'],
      ['list_questions', 'questions', 'visible-question', 'hidden-question'],
    ]) {
      expect((await call(token, tool)).result.structuredContent).toMatchObject({
        [key]: [{ id: visibleId }],
        total: 1,
      });
      for (const [selectedToken, args] of [
        [token, { project_id: 'alice-project' }],
        [scoped, {}],
      ] as const)
        expect((await call(selectedToken, tool, args)).result.structuredContent).toMatchObject({
          [key]: [{ id: hiddenId }],
          total: 1,
        });
    }
  });
  it('ID指定・検索・追加のどれも許可プロジェクト外と他ユーザーを拒否する', async () => {
    const otherStock = await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { project_id: 'alice-second', url: 'https://example.com/private' },
    });
    const stockId = ((await otherStock.json()) as { id: string }).id;
    const otherQuestion = await app.request('/api/v1/questions', {
      method: 'POST',
      body: { project_id: 'alice-second', text: '非公開の問い' },
    });
    const questionId = ((await otherQuestion.json()) as { question: { id: string } }).question.id;
    const token = await mcpToken(app, 'alice-project');
    for (const [name, args] of [
      ['list_stocks', { project_id: 'alice-second' }],
      ['list_questions', { project_id: 'bob-project' }],
      ['get_stock', { stock_id: stockId, include_content: true }],
      ['get_question', { question_id: questionId }],
      [
        'add_question',
        {
          project_id: 'alice-second',
          text: '禁止',
          note: '禁止されたメモ',
          request_id: crypto.randomUUID(),
        },
      ],
      [
        'add_question',
        {
          project_id: 'alice-project',
          stock_id: stockId,
          text: '不一致',
          note: '別の保存先へのメモ',
          request_id: crypto.randomUUID(),
        },
      ],
      [
        'add_stock',
        {
          type: 'url',
          project_id: 'bob-project',
          url: 'https://example.com/a',
          request_id: crypto.randomUUID(),
        },
      ],
    ] as const)
      expect((await call(token, name, args)).result.isError, name).toBe(true);
    expect((await call(token, 'list_stocks')).result.structuredContent.total).toBe(0);
    expect((await call(token, 'list_questions')).result.structuredContent.total).toBe(0);
  });
  it('読み取り専用の認可では追加できず、CookieやショートカットトークンもMCPでは使えない', async () => {
    const token = await mcpToken(app, null, ['projects:read', 'stocks:read', 'questions:read']);
    expect((await call(token, 'list_projects')).result.isError).not.toBe(true);
    const denied = await call(token, 'add_question', {
      project_id: 'alice-project',
      text: '許可なし',
      note: '読み取り専用では保存できないメモ',
      request_id: crypto.randomUUID(),
    });
    expect(denied.result.isError).toBe(true);
    expect(denied.result).toHaveProperty('_meta');
    expect(
      (
        await worker.fetch(
          new Request(`${app.env.APP_URL}/mcp`, {
            headers: { Cookie: 'stock_session=alice-session' },
          }),
          app.env,
          app.ctx,
        )
      ).status,
    ).toBe(401);
    const issued = await app.request('/api/v1/tokens', {
      method: 'POST',
      body: { name: 'shortcut' },
    });
    const shortcut = ((await issued.json()) as { token: string }).token;
    expect(
      (
        await worker.fetch(
          new Request(`${app.env.APP_URL}/mcp`, {
            headers: { Authorization: `Bearer ${shortcut}` },
          }),
          app.env,
          app.ctx,
        )
      ).status,
    ).toBe(401);
  });
});
