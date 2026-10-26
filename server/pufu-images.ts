import { HTTPException } from 'hono/http-exception';
import { PufuImageError } from '@pufu-lens/pufu-image';
import type { Env, Principal } from './env';
import { renderSavedPufu } from './pufu-renderer';
import { readQuestionPufuSnapshot } from './pufu-read';

// 権限確認後、そのリクエストの保存済みスナップショットだけを描画する。
// 画像や処理状態をDB/R2へ保存せず、AI・Workflowも起動しない。
export async function generateQuestionPufuImage(
  env: Env,
  principal: Principal,
  questionId: string | null | undefined,
  pufuId?: string,
) {
  const snapshot = await readQuestionPufuSnapshot(env, principal, questionId, pufuId);
  const metadata = {
    question_id: snapshot.pufu.question_id,
    pufu_id: snapshot.pufuId,
    project_id: snapshot.pufu.project_id,
    updated_at: snapshot.pufu.updated_at,
    phase: snapshot.phase,
    revision: snapshot.revision,
  };
  const title = snapshot.pufu.projectScore?.gainingGoal.text || 'プ譜';
  if (!snapshot.pufu.projectScore)
    return { metadata: { ...metadata, status: 'not_created' }, png: null, title };
  let image: Awaited<ReturnType<typeof renderSavedPufu>>;
  try {
    image = await renderSavedPufu(env, snapshot.pufu.projectScore);
  } catch (error) {
    if (!(error instanceof PufuImageError)) throw error;
    const status = ['IMAGE_TOO_LARGE', 'INPUT_TOO_LARGE'].includes(error.code)
      ? 413
      : ['FONT_UNAVAILABLE', 'WASM_UNAVAILABLE'].includes(error.code)
        ? 503
        : ['INVALID_TEXT', 'TEXT_TOO_WIDE', 'INVALID_INPUT'].includes(error.code)
          ? 422
          : 500;
    throw new HTTPException(status, { message: error.message, cause: error });
  }
  // フォント待ちや描画中に削除・移動・更新された画像を返さない。
  const latest = await readQuestionPufuSnapshot(env, principal, questionId, pufuId);
  if (
    latest.pufuId !== snapshot.pufuId ||
    latest.phase !== snapshot.phase ||
    latest.revision !== snapshot.revision ||
    latest.pufu.project_id !== snapshot.pufu.project_id
  )
    throw new HTTPException(409, { message: 'プ譜が更新されています。再取得してください。' });
  return {
    metadata: {
      ...metadata,
      status: 'ready',
      mime_type: 'image/png',
      width: image.width,
      height: image.height,
      byte_length: image.png.byteLength,
    },
    png: image.png,
    title,
  };
}
