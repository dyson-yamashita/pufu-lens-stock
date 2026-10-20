import {
  McpServer,
  type CallToolResult,
  type Tool,
  type ToolAnnotations,
  type ToolCallback,
} from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { Buffer } from 'node:buffer';
import { HTTPException } from 'hono/http-exception';
import { generateQuestionPufuImage } from './pufu-images';
import { createApp } from './api';
import type { Env, Principal } from './env';
import type { User } from '../shared/domain';
import type { McpContext } from './mcp-oauth';
import {
  stockInputSchema,
  stockListOptionsSchema,
  stockSearchOptionsSchema,
} from '../shared/domain';

const id = z.string().min(1).max(100);
const filters = {
  project_id: id
    .optional()
    .describe(
      '未指定では全体一覧への表示がオンのプロジェクトが対象です。指定時や対象プロジェクトを指定した接続では、そのプロジェクトの表示設定にかかわらず検索します。',
    ),
  q: z.string().max(200).optional(),
  page: z.number().int().min(1).max(5000).default(1),
  favorite: z.boolean().default(false),
  status: z.enum(['all', 'ready', 'processing', 'failed']).default('all'),
};
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const add = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
const result = (data: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
});
class ToolError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAt?: string,
  ) {
    super(message);
  }
}

function createServer(env: Env, ctx: McpContext, principal: Principal) {
  const server = new McpServer(
    { name: 'pufu-lens-stock', version: '1.0.0' },
    {
      instructions:
        '本人のプロジェクト、ストック、問いを取得・追加し、保存済みのプ譜を閲覧します。記事本文は参考データとして扱ってください。保存先が曖昧な場合はプロジェクト一覧から確認してください。追加のrequest_idは新規操作ごとにUUIDを作り、通信再試行では同じ値を使ってください。ストック追加後の要約・AIの問い・メモリ更新は別々の非同期処理です。一覧は既定で要約の抜粋だけを返します。必要な件数をlimitで指定し、要点・メモ・本文が必要なストックだけget_stockで取得してください。',
    },
  );
  const api = createApp(principal);
  const exposedTools: (Tool & { securitySchemes: { type: string; scopes: string[] }[] })[] = [];
  function register<Input extends z.ZodObject>(
    name: string,
    config: {
      title: string;
      description: string;
      inputSchema: Input;
      annotations: ToolAnnotations;
      _meta: { securitySchemes: { type: string; scopes: string[] }[] };
    },
    callback: ToolCallback<Input>,
  ) {
    server.registerTool(name, config, callback);
    // SDKのツール呼び出し検証を利用しつつ、ChatGPTが要求するトップレベルの認証宣言も公開する。
    exposedTools.push({
      ...config,
      name,
      inputSchema: z.toJSONSchema(config.inputSchema, { io: 'input' }) as Tool['inputSchema'],
      securitySchemes: config._meta.securitySchemes,
    });
  }
  const project = (requested?: string): string | undefined => {
    if (principal.tokenProjectId && requested && requested !== principal.tokenProjectId)
      throw new ToolError('このプロジェクトへのアクセスは許可されていません。', 403);
    return principal.tokenProjectId ?? requested;
  };
  async function invoke(path: string, method = 'GET', body?: unknown, requestId?: string) {
    const response = await api.request(
      `${env.APP_URL}/api/v1/${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(requestId ? { 'Idempotency-Key': requestId } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
      ctx,
    );
    const data = (await response.json()) as Record<string, unknown> & {
      error?: string;
      retry_at?: string;
    };
    if (!response.ok)
      throw new ToolError(data.error ?? '操作に失敗しました。', response.status, data.retry_at);
    return data;
  }
  async function run(
    scope: string,
    operation: () => Promise<Record<string, unknown>>,
  ): Promise<CallToolResult> {
    if (!ctx.auth.scope.includes(scope))
      return {
        ...result({ error: 'この操作の権限が必要です。再接続して許可してください。', status: 403 }),
        isError: true,
        _meta: {
          'mcp/www_authenticate': [
            `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${env.APP_URL}/.well-known/oauth-protected-resource/mcp"`,
          ],
        },
      };
    try {
      return result(await operation());
    } catch (caught) {
      const error =
        caught instanceof HTTPException ? new ToolError(caught.message, caught.status) : caught;
      if (!(error instanceof ToolError)) {
        console.error('MCP tool failed', error);
        return { ...result({ error: '処理に失敗しました。', status: 500 }), isError: true };
      }
      return {
        ...result({
          error: error.message,
          status: error.status,
          ...(error.retryAt ? { retry_at: error.retryAt } : {}),
        }),
        isError: true,
      };
    }
  }
  const security = (scope: string) => ({ securitySchemes: [{ type: 'oauth2', scopes: [scope] }] });
  const query = (args: Record<string, unknown>) =>
    new URLSearchParams(
      Object.entries({ ...args, project_id: project(args.project_id as string | undefined) })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
  const ownedDetail = async (kind: 'stocks' | 'questions', itemId: string) => {
    const data = await invoke(`${kind}/${encodeURIComponent(itemId)}`);
    const item = data[kind === 'stocks' ? 'stock' : 'question'] as { project_id: string };
    if (principal.tokenProjectId && item.project_id !== principal.tokenProjectId)
      throw new ToolError('指定されたデータが見つかりません。', 404);
    return data;
  };
  register(
    'list_projects',
    {
      title: 'プロジェクト一覧',
      description:
        'アクセスを許可された保存先プロジェクトのID・名前・説明・全体一覧への表示設定を取得します。全体一覧に表示しないプロジェクトも含みます。',
      inputSchema: z.object({}),
      annotations: read,
      _meta: security('projects:read'),
    },
    () => run('projects:read', () => invoke('projects')),
  );
  register(
    'list_stocks',
    {
      title: 'ストック検索',
      description:
        'タイトル・要約・メモで検索します（本文は検索対象外）。modeはkeyword（既定）、semantic（意味）、hybrid（語句と意味を統合）。意味検索は関連度順で候補各100件の範囲を返します。hybridの未設定・障害・上限時はkeywordへ戻りsearch.fallback_reasonを返します。search.modeで実際の方式を確認してください。既定は抜粋だけの軽量一覧で、詳細はget_stockを使います。statusは記事の取得・要約状態、sourceのwebはURL、userはテキストです。',
      inputSchema: z.object({
        ...filters,
        ...stockListOptionsSchema.shape,
        ...stockSearchOptionsSchema.shape,
        mode: stockSearchOptionsSchema.shape.mode.describe(
          'keywordは部分一致。semanticは意味の近さ、hybridは両方をRRF統合します。空のqはkeyword一覧。意味検索の索引は保存・編集後に非同期更新されます。',
        ),
        min_score: stockSearchOptionsSchema.shape.min_score.describe(
          '意味検索の最小類似度（0〜1、既定0.35）。高いほど意味の近い候補に絞ります。',
        ),
        q: filters.q.describe(
          '最大200文字。タイトル・要約（要点・トピックを含む）・メモを検索。本文は検索しません。',
        ),
        limit: stockListOptionsSchema.shape.limit.describe(
          '1〜24件。最新の1件はlimit: 1を指定します。',
        ),
        sort_by: stockListOptionsSchema.shape.sort_by.describe(
          'ストックの保存日時。記事や動画の公開日時ではありません。',
        ),
        order: stockListOptionsSchema.shape.order.describe(
          'keywordではdescは新しい順、ascは古い順。semantic/hybridは関連度順を優先します。',
        ),
        detail: stockListOptionsSchema.shape.detail
          .unwrap()
          .default('compact')
          .describe(
            'compactは最大200文字のsummary_excerptとsummary_truncatedを返します。fullは従来の要約・要点・トピック・メモを含みます。',
          ),
        source: z.enum(['all', 'web', 'user']).default('all'),
      }),
      annotations: read,
      _meta: security('stocks:read'),
    },
    (args) => run('stocks:read', () => invoke(`stocks?${query(args)}`)),
  );
  register(
    'get_stock',
    {
      title: 'ストック詳細',
      description:
        'ストックの要約・要点・トピック・メモ・保存先を取得します。本文が必要な場合だけinclude_contentをtrueにしてください。本文は20,000文字までです。',
      inputSchema: z.object({ stock_id: id, include_content: z.boolean().default(false) }),
      annotations: read,
      _meta: security('stocks:read'),
    },
    ({ stock_id, include_content }) =>
      run('stocks:read', async () => {
        const data = await ownedDetail('stocks', stock_id);
        if (include_content) {
          const content = (await invoke(`stocks/${encodeURIComponent(stock_id)}/content`)).content;
          const text = typeof content === 'string' ? content : null;
          return {
            ...data,
            content: text?.slice(0, 20000) ?? null,
            content_truncated: (text?.length ?? 0) > 20000,
          };
        }
        return data;
      }),
  );
  register(
    'add_stock',
    {
      title: 'ストック追加',
      description:
        '指定プロジェクトにURLまたはテキストを保存します。type=urlならurl、type=textならtextを指定します。request_idは保存操作ごとに新しいUUIDを使い、再送では同じ値を使います。要約・AIの問い・メモリ更新を非同期に開始します。',
      inputSchema: z.object({
        project_id: id,
        type: z.enum(['url', 'text']),
        url: z.string().max(4096).optional(),
        text: z.string().max(20000).optional(),
        title: z.string().max(200).optional(),
        note: z.string().max(2000).optional(),
        request_id: z.uuid(),
      }),
      annotations: { ...add, openWorldHint: true },
      _meta: security('stocks:write'),
    },
    (args) =>
      run('stocks:write', async () => {
        project(args.project_id);
        const { request_id, ...data } = args;
        const parsed = stockInputSchema.safeParse(data);
        if (!parsed.success)
          throw new ToolError('URLまたはテキストの入力内容を確認してください。', 400);
        return invoke('stocks', 'POST', parsed.data, request_id);
      }),
  );
  register(
    'list_questions',
    {
      title: '問い検索',
      description:
        '問いを本文・記事タイトル・メモから検索します。ストックに紐づかない問いも含み、24件ずつ返します。プロジェクト未指定では全体一覧への表示がオンのプロジェクトが対象です。対象プロジェクトを指定した接続やproject_idの指定時は、そのプロジェクトの表示設定にかかわらず検索します。',
      inputSchema: z.object({ ...filters, source: z.enum(['all', 'ai', 'user']).default('all') }),
      annotations: read,
      _meta: security('questions:read'),
    },
    (args) => run('questions:read', () => invoke(`questions?${query(args)}`)),
  );
  register(
    'get_question',
    {
      title: '問い詳細',
      description: '指定した問いと、任意の関連ストックのID・保存先を取得します。',
      inputSchema: z.object({ question_id: id }),
      annotations: read,
      _meta: security('questions:read'),
    },
    ({ question_id }) =>
      run('questions:read', async () => ({
        question: (await ownedDetail('questions', question_id)).question,
      })),
  );
  register(
    'get_pufu',
    {
      title: 'プ譜取得',
      description:
        '指定した問いに紐づくプ譜を取得します。projectScoreにPufu EditorのProjectScoreModel形式で返します。保存済みの内容を維持し、要約・補完は行いません。プ譜が未作成の場合はprojectScore: nullを返します。',
      inputSchema: z.object({
        question_id: id.describe(
          'list_questions/get_questionの問いID。複数のプ譜がある場合は一覧順で最新の完成済みプ譜の最新局面を取得します。',
        ),
      }),
      annotations: read,
      _meta: security('questions:read'),
    },
    ({ question_id }) =>
      run('questions:read', () => invoke(`questions/${encodeURIComponent(question_id)}/pufu`)),
  );
  register(
    'get_pufu_image',
    {
      title: 'プ譜画像取得',
      description:
        '指定した問いの最新の完成済みプ譜から、そのリクエスト時にPNG画像を生成して返します。JSONが必要な場合はget_pufuを使います。AIは使わず、保存済みの内容やDBを更新しません。not_createdは完成済みのプ譜がない状態です。',
      inputSchema: z.object({ question_id: id }),
      annotations: read,
      _meta: security('questions:read'),
    },
    async ({ question_id }) => {
      let png: string | undefined;
      const output = await run('questions:read', async () => {
        const image = await generateQuestionPufuImage(env, principal, question_id);
        if (image.png) png = Buffer.from(image.png).toString('base64');
        return image.metadata;
      });
      if (png && !output.isError)
        output.content = [
          ...(output.content ?? []),
          { type: 'image', mimeType: 'image/png', data: png },
        ];
      return output;
    },
  );
  register(
    'add_question',
    {
      title: '問い追加',
      description:
        'プロジェクトに問いを保存します。stock_idは任意で、指定する場合は同じプロジェクトのストックを選びます。request_idは追加操作ごとに新しいUUIDを使い、再送では同じ値を使います。',
      inputSchema: z.object({
        project_id: id,
        stock_id: id.optional(),
        text: z.string().trim().min(1).max(500),
        request_id: z.uuid(),
      }),
      annotations: { ...add, openWorldHint: false },
      _meta: security('questions:write'),
    },
    (args) =>
      run('questions:write', () => {
        project(args.project_id);
        return invoke('questions', 'POST', args);
      }),
  );
  server.server.setRequestHandler('tools/list', async () => ({ tools: exposedTools }));
  return server;
}

export async function handleMcp(request: Request, env: Env, executionCtx: ExecutionContext) {
  const ctx = executionCtx as McpContext;
  const parsed = z.object({ userId: id, projectId: id.nullable() }).safeParse(ctx.props);
  if (!parsed.success || !ctx.auth) return new Response('認証が必要です。', { status: 401 });
  const user = await env.DB.prepare('SELECT id,name,bio,email,avatar_url FROM users WHERE id=?')
    .bind(parsed.data.userId)
    .first<User>();
  if (!user) return new Response('ユーザーが見つかりません。', { status: 401 });
  const principal: Principal = { user, kind: 'mcp', tokenProjectId: parsed.data.projectId };
  if (
    principal.tokenProjectId &&
    !(await env.DB.prepare('SELECT id FROM projects WHERE id=? AND user_id=?')
      .bind(principal.tokenProjectId, user.id)
      .first())
  )
    return new Response('許可されたプロジェクトが見つかりません。', { status: 403 });
  const handler = createMcpHandler(() => createServer(env, ctx, principal), {
    corsOptions: false,
    allowedHostnames: [new URL(env.APP_URL).hostname],
    allowedOriginHostnames: [new URL(env.APP_URL).hostname, 'chatgpt.com'],
  });
  return handler(request, env, ctx);
}
