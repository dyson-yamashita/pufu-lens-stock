import wasmUrl from '@resvg/resvg-wasm/index_bg.wasm?url';
import { initPufuWasm, renderPufuPng } from '@pufu-lens/pufu-image';
import type { PufuScore } from '../shared/pufu';

// 保存済みの局面を、プレビューと同じ描画処理と日本語フォントでPNGにする。
export async function createPufuPng(score: PufuScore, theme: 'light' | 'dark') {
  const [response] = await Promise.all([fetch('/fonts/pufu-jp.otf'), initPufuWasm(wasmUrl)]);
  if (!response.ok) throw new Error('画像用フォントを取得できませんでした。再度お試しください。');
  const font = new Uint8Array(await response.arrayBuffer());
  const { png } = renderPufuPng(score, { font, showProgress: false, theme });
  return new Blob([new Uint8Array(png)], { type: 'image/png' });
}
