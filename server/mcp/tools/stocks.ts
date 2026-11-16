import { Buffer } from 'node:buffer';
import { z } from 'zod';
import {
  stockInputSchema,
  stockListOptionsSchema,
  stockSearchOptionsSchema,
} from '../../../shared/domain';
import {
  stockImageMaxBase64Length,
  stockImageMaxBytes,
  stockImageTypes,
} from '../../../shared/stock-images';
import { ToolError } from '../results';
import type { McpToolContext } from '../tool-context';
import { add, filters, id, read } from '../tool-schemas';
export function registerStocksTools(context: McpToolContext) {
  const { register, project, invoke, run, security, query, ownedDetail } = context;
  register(
    'list_stocks',
    {
      title: 'ストック検索',
      description:
        'タイトル・要約・メモで検索します（本文採用時は採用した本文も検索対象です）。modeはkeyword（既定）、semantic（意味）、hybrid（語句と意味を統合）。意味検索は関連度順で候補各100件の範囲を返します。hybridの未設定・障害・上限時はkeywordへ戻りsearch.fallback_reasonを返します。search.modeで実際の方式を確認してください。既定は抜粋だけの軽量一覧で、詳細はget_stockを使います。statusは記事の取得・要約状態、sourceのwebはURL、userはテキストです。',
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
          '最大200文字。タイトル・要約（要点・トピックを含む）・メモを検索。本文採用時は採用した本文も検索します。',
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
        'ストックの要約・要点・トピック・メモ・保存先を取得します。本文採用時はsummary.verbatim=trueでsummary.overviewに本文全体を返します。通常の本文取得や本文採用時の別取得はinclude_content=trueで指定し、contentは20,000文字までです。',
      inputSchema: z.object({ stock_id: id, include_content: z.boolean().default(false) }),
      annotations: read,
      _meta: security('stocks:read'),
    },
    ({ stock_id, include_content }) =>
      run('stocks:read', async () => {
        const data = await ownedDetail('stocks', stock_id);
        const { images } = await invoke(`stocks/${encodeURIComponent(stock_id)}/images`);
        data.images = images;
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
        '指定プロジェクトにURLまたはテキストを保存します。type=urlならurl、type=textならtextを指定します。skip_summary=trueで要約せず、入力または取得した本文をそのまま採用します。省略時は従来どおり要約します。要約ありと本文採用は別のストックとして保存します。request_idは保存操作ごとに新しいUUIDを使い、再送では同じ値を使います。本文処理・AIの問い・気づき・メモリ更新は非同期です。',
      inputSchema: z.object({
        project_id: id,
        type: z.enum(['url', 'text']),
        url: z.string().max(4096).optional(),
        text: z.string().max(20000).optional(),
        title: z.string().max(200).optional(),
        note: z.string().max(2000).optional(),
        skip_summary: z
          .boolean()
          .default(false)
          .describe(
            'trueで要約せず本文をそのまま採用します。既定はfalse。AIの問い・気づき・メモリ更新は通常どおり実行します。',
          ),
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
    'add_stock_image',
    {
      title: 'mcp.stock_images.title',
      description: 'mcp.stock_images.description',
      inputSchema: z.object({
        stock_id: id,
        filename: z.string().trim().min(1).max(255),
        content_type: z.enum(stockImageTypes),
        base64: z.string().min(4).max(stockImageMaxBase64Length),
        request_id: z.uuid(),
      }),
      annotations: add,
      _meta: security('stocks:write'),
    },
    (args) =>
      run('stocks:write', async () => {
        // Check ownership and selected-project scope before decoding a potentially large image.
        await ownedDetail('stocks', args.stock_id);
        if (args.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(args.base64))
          throw new ToolError('PNG・JPEG・GIF・WebPの画像を選んでください。', 400);
        const bytes = Buffer.from(args.base64, 'base64');
        if (bytes.length > stockImageMaxBytes) throw new ToolError('画像は1枚5MBまでです。', 413);
        return invoke(
          `stocks/${encodeURIComponent(args.stock_id)}/images`,
          'POST',
          undefined,
          args.request_id,
          { bytes, type: args.content_type, filename: args.filename },
        );
      }),
  );
}
