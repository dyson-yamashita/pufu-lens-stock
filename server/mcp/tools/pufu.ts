import { Buffer } from 'node:buffer';
import { z } from 'zod';
import {
  appendSavedPufuPhaseSchema,
  createSavedPufuSchema,
  pufuScoreSchema,
  savePufuSchema,
} from '../../../shared/pufu';
import { pufuViewerSchema, pufuViewerUri } from '../../../shared/pufu-viewer';
import { issuePufuImageLink } from '../../features/pufu/images/pufu-image-links';
import { generateQuestionPufuImage } from '../../features/pufu/images/pufu-images';
import { appendSavedPufuPhase } from '../../features/pufu/pufu-phases';
import { readQuestionPufu } from '../../features/pufu/pufu-read';
import { ToolError } from '../results';
import type { McpToolContext } from '../tool-context';
import { add, filters, id, pufuSelection, read } from '../tool-schemas';
export function registerPufuTools(context: McpToolContext) {
  const { language, t, errorMessage, register, project, invoke, run, security, env, principal } =
    context;
  const loadPufuImage = async (questionId: string | null | undefined, pufuId?: string) => {
    const image = await generateQuestionPufuImage(env, principal, questionId, pufuId);
    const links = await issuePufuImageLink(env, principal, image);
    return {
      image,
      data: {
        ...image.metadata,
        title: image.title,
        ...links,
        ...(links.image_url_error
          ? { image_url_error: errorMessage(links.image_url_error, 503) }
          : {}),
        language,
      },
    };
  };
  register(
    'list_pufus',
    {
      title: 'プ譜一覧',
      description:
        '本人のプ譜を24件ずつ取得します。問いへの紐付けがないプ譜も含みます。idをget_pufu/show_pufu/update_pufu/add_pufu_phaseのpufu_idに指定してください。全体一覧に非表示のプロジェクトは、project_idを指定すると取得できます。',
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
        '事前にget_pufu_guidelineで記述方針を確認してください。ProjectScoreModel形式のprojectScoreをプロジェクトへ保存し、完成済みの第1局面を作成します。AI生成は行いません。question_idsとstock_idsで同じプロジェクトの問い・ストックをそれぞれ100件まで関連付けできます。画面のAI自動生成の各1件制限とは別です。旧question_idも任意で利用できますがquestion_idsとの併用はできません。各要素のuuidは重複しないID、commentはcolorとtextを含めます。request_idは新規操作ごとのUUID、再送時は同じ内容とUUIDを使ってください。異なる内容の再使用は409、上限は256KiBです。作成・編集にはpufus:writeの追加許可が必要です。',
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
        '事前にget_pufu_guidelineで変更に関係する記述方針を確認してください。保存済みプ譜の指定局面をprojectScoreで置き換えます。事前にget_pufuで最新の内容とrevisionを取得し、変更しない要素も保持してください。revisionは必須で、競合時は409です。phase省略時は最新局面を編集します。question_idsとstock_idsでそれぞれ100件までの関連を変更し、空配列で解除、省略で維持します。同じプロジェクト内のみ指定できます。旧question_idも利用できますがquestion_idsとの併用はできません。更新対象の局面の内容を変更し、局面の追加は行いません。上限は256KiBです。',
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
    'add_pufu_phase',
    {
      title: 'プ譜の局面追加',
      description:
        '既存局面を書き換えず、最新局面を土台に次の局面を追加します。事前にget_pufu_guidelineとget_pufuで方針・最新内容・revisionを確認してください。projectScore省略時は最新局面をそのまま複製します。変更時は取得したJSONの必要箇所だけを差し替え、変更しないUUID・コメント・色・進捗・配列順を保持した完全なProjectScoreModelを渡します。reasonは任意のきっかけ（2,000文字以内）で、新局面の最初の時系列コメントに保存します。revisionと新規操作ごとのrequest_id（UUID）は必須です。同じ入力の再送は同じrequest_idで元の結果を返し、異なる入力での再使用と更新競合は409です。問い・ストックの紐付けは維持し、AI生成は行いません。上限256KiB、pufus:write権限が必要です。既存局面の編集にはupdate_pufuを使います。',
      inputSchema: appendSavedPufuPhaseSchema,
      annotations: { ...add, openWorldHint: false },
      _meta: security('pufus:write'),
    },
    (data) => run('pufus:write', () => appendSavedPufuPhase(env, principal, data)),
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
          text: t('mcp.imageLinks', {
            image_url: metadata.image_url,
            download_url: metadata.download_url,
            expires_at: metadata.expires_at ?? '',
          }),
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
                ? t('mcp.imageReady', {
                    image_url: data.image_url ?? '',
                    download_url: data.download_url ?? '',
                  })
                : t('この問い・気づきのプ譜はまだ作成されていません。'),
          },
        ];
      }
      return output;
    },
  );
}
