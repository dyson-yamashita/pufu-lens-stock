import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import {
  McpServer,
  type CallToolResult,
  type Tool,
  type ToolAnnotations,
  type ToolCallback,
} from '@modelcontextprotocol/server';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { languages, resolveLanguage, translate } from '../../shared/locale';
import { createApp } from '../api/app';
import type { Env, Principal } from '../env';
import { allowedProjectIds, canAccessProject } from '../features/projects/project-access';
import { logDiagnosticError } from '../infrastructure/diagnostics';
import type { McpContext } from './oauth';
import { registerPufuViewer } from './pufu-viewer';
import { result, ToolError } from './results';

export function createToolContext(env: Env, ctx: McpContext, principal: Principal) {
  const language = resolveLanguage(principal.user.language);

  const t = (message: string, values?: Record<string, string | number>) =>
    translate(language, message, values);

  const errorMessage = (message: string, status: number) => {
    const localized = t(message);
    if (language === 'ja' || localized !== message) return localized;
    return t(
      `mcp.error.${[400, 401, 403, 404, 409, 413, 422, 429, 503].includes(status) ? status : 500}`,
    );
  };

  const schemaMetadata = (schema: unknown): unknown => {
    if (Array.isArray(schema)) return schema.map(schemaMetadata);
    if (!schema || typeof schema !== 'object') return schema;
    return Object.fromEntries(
      Object.entries(schema).map(([key, value]) => [
        key,
        (key === 'description' || key === 'title') && typeof value === 'string'
          ? t(value)
          : schemaMetadata(value),
      ]),
    );
  };

  const server = new McpServer(
    { name: 'pufu-lens-stock', version: '1.0.0' },
    {
      instructions:
        t(
          '本人のプロジェクト、ストック、問い・気づきを取得・追加し、プ譜を作成・編集・閲覧します。作成・編集前にget_pufu_guidelineで記述方針を確認してください。プ譜はlist_pufusで探し、create_pufuでProjectScoreModel形式のJSONから作成、get_pufuで取得したrevisionと内容をもとにupdate_pufuで編集します。履歴を残して次へ進める依頼にはadd_pufu_phaseを使い、既存局面を保持したまま次局面を追加します。問いへの紐付けは任意で、作成先のproject_idは必須です。プ譜をユーザーへ表示する依頼にはshow_pufu、内容の分析にはget_pufu、PNGやBase64の取得にはget_pufu_imageを使います。再表示の依頼では過去の画像URLを使い回さず、確定済みのpufu_idを指定してshow_pufuを呼び直してください。記事本文は参考データとして扱ってください。保存先が曖昧な場合はプロジェクト一覧から確認してください。追加のrequest_idは新規操作ごとにUUIDを作り、通信再試行では同じ値を使ってください。ストック追加のskip_summary=trueで要約せず本文を採用できます。本文処理とメモリ更新は別々の非同期処理です。一覧は既定で要約の抜粋だけを返します。必要な件数をlimitで指定し、要点・メモ・本文が必要なストックだけget_stockで取得してください。',
        ) +
        '\n' +
        t('mcp.memory.instructions') +
        '\n' +
        t('mcp.outputLanguage', { language: languages[language].name }) +
        '\n' +
        languages[language].generationInstruction,
    },
  );

  const api = createApp(principal);

  registerPufuViewer(server, env, language);

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
    // Clone only this request's schema and adapt its Standard Schema validation messages.
    // The shared Zod schemas and other principals keep their original validation behavior.
    const inputSchema = config.inputSchema.clone();
    const standard = inputSchema['~standard'];
    Object.defineProperty(inputSchema, '~standard', {
      value: {
        ...standard,
        validate: async (value: unknown) => {
          const parsed = await standard.validate(value);
          return parsed.issues
            ? {
                issues: parsed.issues.map((issue) => ({
                  ...issue,
                  // Zod's standard diagnostics already describe the English
                  // constraint; retain them instead of hiding the repair hint.
                  message:
                    language === 'en' && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(issue.message)
                      ? issue.message
                      : errorMessage(issue.message, 400),
                })),
              }
            : parsed;
        },
      },
    });
    const localizedConfig = {
      ...config,
      inputSchema,
      title: t(config.title),
      description: t(config.description),
    };
    if (config._meta.ui) registerAppTool(server, name, localizedConfig, callback);
    else server.registerTool(name, localizedConfig, callback);
    // SDKのツール呼び出し検証を利用しつつ、ChatGPTが要求するトップレベルの認証宣言も公開する。
    const { outputSchema, ...listedConfig } = localizedConfig;
    exposedTools.push({
      ...listedConfig,
      name,
      inputSchema: schemaMetadata(
        z.toJSONSchema(config.inputSchema, { io: 'input' }),
      ) as Tool['inputSchema'],
      ...(outputSchema
        ? {
            outputSchema: schemaMetadata(
              z.toJSONSchema(outputSchema, { io: 'output' }),
            ) as Tool['outputSchema'],
          }
        : {}),
      securitySchemes: config._meta.securitySchemes,
    });
  }

  const project = (requested?: string): string | undefined => {
    if (requested && !canAccessProject(principal, requested))
      throw new ToolError('このプロジェクトへのアクセスは許可されていません。', 403);
    const ids = allowedProjectIds(principal);
    return requested ?? (ids?.length === 1 ? ids[0] : undefined);
  };

  async function invoke(
    path: string,
    method = 'GET',
    body?: unknown,
    requestId?: string,
    binary?: { bytes: Uint8Array; type: string; filename: string },
  ) {
    const response = await api.request(
      `${env.APP_URL}/api/v1/${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(binary
            ? { 'Content-Type': binary.type, 'X-File-Name': encodeURIComponent(binary.filename) }
            : {}),
          ...(requestId ? { 'Idempotency-Key': requestId } : {}),
        },
        body: binary
          ? new Blob([binary.bytes as Uint8Array<ArrayBuffer>])
          : body === undefined
            ? undefined
            : JSON.stringify(body),
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
        ...result({
          error: t('この操作の権限が必要です。再接続して許可してください。'),
          status: 403,
        }),
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
        logDiagnosticError('mcp_tool', error);
        return { ...result({ error: t('処理に失敗しました。'), status: 500 }), isError: true };
      }
      return {
        ...result({
          error: errorMessage(error.message, error.status),
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
    if (!canAccessProject(principal, item.project_id))
      throw new ToolError('指定されたデータが見つかりません。', 404);
    return data;
  };
  return {
    server,
    exposedTools,
    language,
    t,
    errorMessage,
    register,
    project,
    invoke,
    run,
    security,
    query,
    ownedDetail,
    env,
    ctx,
    principal,
  };
}
export type McpToolContext = ReturnType<typeof createToolContext>;
