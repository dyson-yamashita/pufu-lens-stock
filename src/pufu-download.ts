import { t, getLanguage } from './i18n';
import type { Language } from '../shared/locale';
import { pufuImageLabels } from '../shared/pufu-image-labels';
import wasmUrl from '@resvg/resvg-wasm/index_bg.wasm?url';
import { initPufuWasm, renderPufuPng } from '@pufu-lens/pufu-image';
import type { PufuScore } from '../shared/pufu';
// 保存済みの局面を、プレビューと同じ描画処理と日本語フォントでPNGにする。
export async function createPufuPng(
  score: PufuScore,
  theme: 'light' | 'dark',
  language: Language = getLanguage(),
) {
  const [response] = await Promise.all([fetch('/fonts/pufu-jp.otf'), initPufuWasm(wasmUrl)]);
  if (!response.ok)
    throw new Error(t('ui.pufu-download.could_not_load_the_image_font_please_try_again'));
  const font = new Uint8Array(await response.arrayBuffer());
  const { png } = renderPufuPng(score, {
    font,
    showProgress: false,
    theme,
    labels: pufuImageLabels(language),
    language,
  });
  return new Blob([new Uint8Array(png)], { type: 'image/png' });
}
