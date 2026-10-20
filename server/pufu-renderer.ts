import wasm from '@resvg/resvg-wasm/index_bg.wasm?module';
import { initPufuWasm, renderPufuPng, PufuImageError } from '@pufu-lens/pufu-image';
import type { Env } from './env';
export const pufuImageVersion = '1';
let font: Promise<Uint8Array> | undefined;
export async function renderSavedPufu(env: Env, score: unknown) {
  if (!env.ASSETS)
    throw new PufuImageError('FONT_UNAVAILABLE', '画像生成用の静的アセットが設定されていません。');
  const assets = env.ASSETS;
  font ??= assets
    .fetch(new Request(new URL('/fonts/pufu-jp.otf', env.APP_URL)))
    .then(async (response) => {
      if (!response.ok)
        throw new PufuImageError(
          'FONT_UNAVAILABLE',
          `画像用フォントを取得できません（${response.status}）。`,
        );
      return new Uint8Array(await response.arrayBuffer());
    })
    .catch((error) => {
      font = undefined;
      throw error;
    });
  const [, bytes] = await Promise.all([
    initPufuWasm(wasm).catch((cause) => {
      throw new PufuImageError('WASM_UNAVAILABLE', '画像生成モジュールを起動できません。', {
        cause,
      });
    }),
    font,
  ]);
  return renderPufuPng(score, { font: bytes, showProgress: false });
}
