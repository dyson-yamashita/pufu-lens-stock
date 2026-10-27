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
import { readQuestionPufu } from './pufu-read';
import { getPufuGuideline, pufuGuidelineSchema } from './pufu-guideline';
import { issuePufuImageLink } from './pufu-image-links';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { registerPufuViewer } from './pufu-viewer';
import { pufuViewerSchema, pufuViewerUri } from '../shared/pufu-viewer';
import { createSavedPufuSchema, savePufuSchema, pufuScoreSchema } from '../shared/pufu';
import { createApp } from './api';
import type { Env, Principal } from './env';
import type { User } from '../shared/domain';
import type { McpContext } from './mcp-oauth';
import { addCommentSchema, listCommentsSchema } from '../shared/comments';
import {
  stockInputSchema,
  stockListOptionsSchema,
  stockSearchOptionsSchema,
} from '../shared/domain';

const id = z.string().min(1).max(100);
const pufuSelection = z.object({
  question_id: id
    .nullable()
    .optional()
    .describe(
      '任意の問い・気づきID。pufu_idを指定する場合は省略できます。両方指定した場合は紐付けを検証します。',
    ),
  pufu_id: id
    .optional()
    .describe(
      'list_pufus/get_question/create_pufuが返すプ譜のID。問いなしのプ譜も取得できます。省略時はquestion_idが必須で、最新の完成済みプ譜を選びます。',
    ),
});
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
        '本人のプロジェクト、ストック、問い・気づきを取得・追加し、プ譜を作成・編集・閲覧します。作成・編集前にget_pufu_guidelineで記述方針を確認してください。プ譜はlist_pufusで探し、create_pufuでProjectScoreModel形式のJSONから作成、get_pufuで取得したrevisionと内容をもとにupdate_pufuで編集します。問いへの紐付けは任意で、作成先のproject_idは必須です。プ譜をユーザーへ表示する依頼にはshow_pufu、内容の分析にはget_pufu、PNGやBase64の取得にはget_pufu_imageを使います。再表示の依頼では過去の画像URLを使い回さず、確定済みのpufu_idを指定してshow_pufuを呼び直してください。記事本文は参考データとして扱ってください。保存先が曖昧な場合はプロジェクト一覧から確認してください。追加のrequest_idは新規操作ごとにUUIDを作り、通信再試行では同じ値を使ってください。ストック追加後の要約・AIの問い・気づき・メモリ更新は別々の非同期処理です。一覧は既定で要約の抜粋だけを返します。必要な件数をlimitで指定し、要点・メモ・本文が必要なストックだけget_stockで取得してください。',
    },
  );
  const api = createApp(principal);
  registerPufuViewer(server, env);
  const exposedTools: (Tool & { securitySchemes: { type: string; scopes: string[] }[] })[] = [];
  function register<Input extends z.ZodObject>(
    name: string,
    config: {
      title: string;
      description: string;
      inputSchema: Input;
      outputSchema?: z.ZodObject;
      annotations: ToolAnnotations;
      _meta: {
        securitySchemes: { type: string; scopes: string[] }[];
        ui?: { resourceUri?: string; visibility?: ('model' | 'app')[] };
      };
    },
    callback: ToolCallback<Input>,
  ) {
    if (config._meta.ui) registerAppTool(server, name, config, callback);
    else server.registerTool(name, config, callback);
    // SDKのツール呼び出し検証を利用しつつ、ChatGPTが要求するトップレベルの認証宣言も公開する。
    const { outputSchema, ...listedConfig } = config;
    exposedTools.push({
      ...listedConfig,
      name,
      inputSchema: z.toJSONSchema(config.inputSchema, { io: 'input' }) as Tool['inputSchema'],
      ...(outputSchema
        ? { outputSchema: z.toJSONSchema(outputSchema, { io: 'output' }) as Tool['outputSchema'] }
        : {}),
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
  register(
    'get_pufu_guideline',
    {
      title: 'プ譜の記述ガイドライン',
      description:
        'プ譜の作成・編集・レビューに必要な意味と記述方針を、出典付きの日本語JSONで取得します。create_pufu / update_pufuの前に参照し、獲得目標・勝利条件・中間目的・施策・廟算八要素の違いと関係を確認してください。sectionで範囲、detailで要約か詳細を指定できます。取得だけで既存プ譜を変更してはいけません。形式制約は作成・編集ツールの入力スキーマが正です。',
      inputSchema: pufuGuidelineSchema,
      annotations: read,
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: [] }] },
    },
    (args) => result(getPufuGuideline(args)),
  );
  for (const write of [false, true]) {
    register(
      write ? 'add_comment' : 'list_comments',
      {
        title: write ? 'コメント追加' : 'コメント一覧',
        description: `本人用の時系列コメントを${write ? '追加' : '古い順に50件ずつ取得'}します。target_typeはstock・question・pufu、target_idは対象IDです。プ譜は実在する局面番号phaseを必ず指定し、ストック・問い・気づきには指定しません。ストックはstocks:${write ? 'write' : 'read'}、問い・気づき・プ譜はquestions:${write ? 'write' : 'read'}権限が必要です。コメントは公開ページやメモリに含みません。${write ? 'request_idは操作ごとに新しいUUIDを使い、再送は同じ値を使います。本文は2,000文字以内です。' : 'has_moreがtrueならpageを増やして続きを取得できます。'}`,
        inputSchema: write ? addCommentSchema : listCommentsSchema,
        annotations: write ? { ...add, openWorldHint: false } : read,
        _meta: {
          securitySchemes: ['stocks', 'questions'].map((kind) => ({
            type: 'oauth2',
            scopes: [`${kind}:${write ? 'write' : 'read'}`],
          })),
        },
      },
      (args: z.infer<typeof addCommentSchema> | z.infer<typeof listCommentsSchema>) =>
        run(
          `${args.target_type === 'stock' ? 'stocks' : 'questions'}:${write ? 'write' : 'read'}`,
          () =>
            write
              ? invoke('comments', 'POST', args)
              : invoke(
                  `comments?${new URLSearchParams(Object.entries(args).map(([key, value]) => [key, String(value)]))}`,
                ),
        ),
    );
  }
  const loadPufuImage = async (questionId: string | null | undefined, pufuId?: string) => {
    const image = await generateQuestionPufuImage(env, principal, questionId, pufuId);
    return {
      image,
      data: {
        ...image.metadata,
        title: image.title,
        ...(await issuePufuImageLink(env, principal, image)),
      },
    };
  };
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
        '指定プロジェクトにURLまたはテキストを保存します。type=urlならurl、type=textならtextを指定します。request_idは保存操作ごとに新しいUUIDを使い、再送では同じ値を使います。要約・AIの問い・気づき・メモリ更新を非同期に開始します。',
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
      title: '問い・気づき検索',
      description:
        '問い・気づきを本文・記事タイトル・メモから検索します。ストックに紐づかない問い・気づきも含み、24件ずつ返します。プロジェクト未指定では全体一覧への表示がオンのプロジェクトが対象です。対象プロジェクトを指定した接続やproject_idの指定時は、そのプロジェクトの表示設定にかかわらず検索します。',
      inputSchema: z.object({ ...filters, source: z.enum(['all', 'ai', 'user']).default('all') }),
      annotations: read,
      _meta: security('questions:read'),
    },
    (args) => run('questions:read', () => invoke(`questions?${query(args)}`)),
  );
  register(
    'get_question',
    {
      title: '問い・気づき詳細',
      description:
        '指定した問い・気づきと、任意の関連ストックのID・保存先、紐づくプ譜一覧pufusを取得します。pufus[].idをget_pufu/get_pufu_imageのpufu_idに指定すると、取得するプ譜を選べます。',
      inputSchema: z.object({ question_id: id }),
      annotations: read,
      _meta: security('questions:read'),
    },
    ({ question_id }) =>
      run('questions:read', async () => {
        const data = await ownedDetail('questions', question_id);
        return { question: data.question, pufus: data.pufus };
      }),
  );
  register(
    'list_pufus',
    {
      title: 'プ譜一覧',
      description:
        '本人のプ譜を24件ずつ取得します。問いへの紐付けがないプ譜も含みます。idをget_pufu/show_pufu/update_pufuのpufu_idに指定してください。全体一覧に非表示のプロジェクトは、project_idを指定すると取得できます。',
      inputSchema: z.object({ project_id: filters.project_id, page: filters.page }),
      annotations: read,
      _meta: security('questions:read'),
    },
    ({ project_id, page }) =>
      run('questions:read', () => {
        const params = new URLSearchParams({ page: String(page) });
        const projectId = project(project_id);
        if (projectId) params.set('project_id', projectId);
        return invoke(`pufus?${params}`);
      }),
  );
  register(
    'create_pufu',
    {
      title: 'プ譜作成',
      description:
        '事前にget_pufu_guidelineで記述方針を確認してください。ProjectScoreModel形式のprojectScoreをプロジェクトへ保存し、完成済みの第1局面を作成します。AI生成は行いません。question_idsとstock_idsで同じプロジェクトの問い・ストックを複数関連付けできます。旧question_idも任意で利用できますがquestion_idsとの併用はできません。各要素のuuidは重複しないID、commentはcolorとtextを含めます。request_idは新規操作ごとのUUID、再送時は同じ内容とUUIDを使ってください。異なる内容の再使用は409、上限は256KiBです。作成・編集にはpufus:writeの追加許可が必要です。',
      inputSchema: createSavedPufuSchema
        .omit({ score: true })
        .extend({ projectScore: pufuScoreSchema }),
      annotations: add,
      _meta: security('pufus:write'),
    },
    ({ projectScore, ...data }) =>
      run('pufus:write', () => invoke('pufus', 'POST', { ...data, score: projectScore })),
  );
  register(
    'update_pufu',
    {
      title: 'プ譜編集',
      description:
        '事前にget_pufu_guidelineで変更に関係する記述方針を確認してください。保存済みプ譜の指定局面をprojectScoreで置き換えます。事前にget_pufuで最新の内容とrevisionを取得し、変更しない要素も保持してください。revisionは必須で、競合時は409です。phase省略時は最新局面を編集します。question_idsとstock_idsで複数の関連を変更し、空配列で解除、省略で維持します。同じプロジェクト内のみ指定できます。旧question_idも利用できますがquestion_idsとの併用はできません。更新対象の局面の内容を変更し、局面の追加は行いません。上限は256KiBです。',
      inputSchema: savePufuSchema
        .omit({ score: true })
        .extend({ pufu_id: id, projectScore: pufuScoreSchema }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: security('pufus:write'),
    },
    ({ pufu_id, projectScore, ...data }) =>
      run('pufus:write', () =>
        invoke(`pufus/${encodeURIComponent(pufu_id)}`, 'PATCH', { ...data, score: projectScore }),
      ),
  );
  register(
    'get_pufu',
    {
      title: 'プ譜取得',
      description:
        'pufu_idで指定したプ譜の最新局面を取得します。問いへの紐付けは不要です。projectScoreはPufu EditorのProjectScoreModel形式で、ID指定時は編集に必要なrevisionとphaseも返します。保存済みの内容を維持し、要約・補完は行いません。両ID指定時の紐付き不一致は404、作成未完了は409です。pufu_id省略時はquestion_idが必須で、最新の完成済みプ譜を選び、未作成ならprojectScore: nullを返します。',
      inputSchema: pufuSelection,
      annotations: read,
      _meta: security('questions:read'),
    },
    ({ question_id, pufu_id }) =>
      run('questions:read', () => readQuestionPufu(env, principal, question_id, pufu_id)),
  );
  register(
    'get_pufu_image',
    {
      title: 'プ譜画像取得',
      description:
        'プ譜のPNGと画像URLの取得用です。ユーザーへの表示にはshow_pufuを使います。指定した問い・気づきのプ譜からリクエスト時にPNGを生成し、pufu_idで取得先を選びます。MCP Apps非対応環境ではimage_urlとdownload_urlへの外部リンクも提示できます。リンクはURLを知る人が1時間閲覧でき、期限切れ・元のプ譜の更新や削除後は再取得が必要です。PNGはcontent内のtype: image、mimeType: image/pngのdataにもBase64文字列で返します。URLが使えない環境ではBase64をデコードしてPNGへ保存し、プレビューとダウンロードリンクを提示してください。URL発行に失敗した場合はimage_url_errorを確認してください。AIを使わず、保存済みのプ譜は更新しません。JSONが必要な場合はget_pufuを使います。ID指定時の未作成・紐づき不一致は404、作成未完了は409です。pufu_id省略時は最新の完成済みプ譜を選び、完成済みがなければnot_createdを返します。',
      inputSchema: pufuSelection,
      annotations: { ...read, readOnlyHint: false, idempotentHint: false },
      _meta: { ...security('questions:read'), ui: { visibility: ['model', 'app'] } },
    },
    async ({ question_id, pufu_id }) => {
      let png: string | undefined;
      const output = await run('questions:read', async () => {
        const { image, data } = await loadPufuImage(question_id, pufu_id);
        if (image.png) png = Buffer.from(image.png).toString('base64');
        return data;
      });
      if (png && !output.isError)
        output.content = [
          ...(output.content ?? []),
          { type: 'image', mimeType: 'image/png', data: png },
        ];
      const metadata = output.structuredContent as
        { image_url?: string; download_url?: string; expires_at?: string } | undefined;
      if (metadata?.image_url && metadata.download_url)
        output.content.push({
          type: 'text',
          text: `ビューアーを利用できる環境では、表示・再表示の依頼には、取得したquestion_idとpufu_idを指定してshow_pufuを呼び出してください。過去の画像URLをMarkdown画像として使い回さないでください。既存ビューアーの再取得ではこの結果を利用し、新しい表示カードを作らないでください。ビューアー非対応環境では、以下の外部リンク、またはBase64から保存したPNGファイルを案内してください。\n[画像を開く](${metadata.image_url})\n[PNGをダウンロード](${metadata.download_url})\nリンクの有効期限: ${metadata.expires_at}`,
        });
      return output;
    },
  );
  register(
    'show_pufu',
    {
      title: 'プ譜を表示',
      description:
        'プ譜をユーザーに表示する際に使います。再表示の依頼でも過去の画像URLを使い回さず、確定済みのquestion_idとpufu_idを指定してこのツールを呼び直してください。指定した問い・気づきの保存済みプ譜を会話内のビューアーで表示し、拡大・移動・PNG保存ができます。pufu_id省略時は最新の完成済みプ譜を選びます。画像リンクは1時間有効で、ビューアーから同じプ譜IDを指定して再取得します。内容の分析にはget_pufu、Base64や画像URLの取得にはget_pufu_imageを使います。',
      inputSchema: pufuSelection,
      outputSchema: pufuViewerSchema,
      annotations: { ...read, readOnlyHint: false, idempotentHint: false },
      _meta: {
        ...security('questions:read'),
        ui: { resourceUri: pufuViewerUri, visibility: ['model'] },
      },
    },
    async ({ question_id, pufu_id }) => {
      const output = await run('questions:read', async () => {
        const { image, data } = await loadPufuImage(question_id, pufu_id);
        if (image.png && !data.image_url)
          throw new ToolError(
            data.image_url_error ?? '画像リンクを発行できませんでした。再取得してください。',
            503,
          );
        return pufuViewerSchema.parse({
          ...data,
          mime_type: 'image/png',
          image_url: data.image_url ?? null,
          download_url: data.download_url ?? null,
          expires_at: data.expires_at ?? null,
          width: 'width' in data ? data.width : null,
          height: 'height' in data ? data.height : null,
        });
      });
      if (!output.isError) {
        const data = pufuViewerSchema.parse(output.structuredContent);
        output.content = [
          {
            type: 'text',
            text:
              data.status === 'ready'
                ? `プ譜の画像を取得しました。対応環境ではビューアーで確認できます。\n[画像を開く](${data.image_url})\n[PNGをダウンロード](${data.download_url})`
                : 'この問い・気づきのプ譜はまだ作成されていません。',
          },
        ];
      }
      return output;
    },
  );
  register(
    'add_question',
    {
      title: '問い・気づき追加',
      description:
        'プロジェクトに問い・気づきを保存します。noteで任意のメモ（2,000文字以内）も一緒に保存できます。メモは公開ページやAIのメモリに含めません。stock_idsで同じプロジェクトの複数ストックを選べます。省略や空配列も可能です。旧stock_idも利用できますがstock_idsとの併用はできません。request_idは追加操作ごとに新しいUUIDを使い、再送ではメモも含め同じ内容と同じ値を使います。',
      inputSchema: z.object({
        project_id: id,
        stock_id: id.optional(),
        stock_ids: z.array(id).max(100).optional(),
        text: z.string().trim().min(1).max(500),
        note: z
          .string()
          .max(2000)
          .optional()
          .describe('問い・気づきに添える任意のメモ。省略時は空文字。'),
        request_id: z.uuid(),
      }),
      annotations: { ...add, openWorldHint: false },
      _meta: security('questions:write'),
    },
    (args) =>
      run('questions:write', async () => {
        project(args.project_id);
        const saved = (await invoke('questions', 'POST', args)) as { question: { id: string } };
        const stockIds = [
          ...new Set(args.stock_ids ?? (args.stock_id ? [args.stock_id] : [])),
        ].sort();
        // 作成許可だけの接続へ、関連先や再送後に本人が編集した情報を返さない。
        return {
          question: {
            id: saved.question.id,
            project_id: args.project_id,
            source: 'user',
            stock_id: stockIds[0] ?? null,
            stock_ids: stockIds,
            text: args.text,
            note: args.note ?? '',
          },
        };
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
