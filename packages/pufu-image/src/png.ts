import { initWasm, Resvg, type InitInput } from '@resvg/resvg-wasm';
import { createPufuSvg, type SvgOptions } from './svg.js';
import { PufuImageError, imageLimits } from './errors.js';
let initialization: Promise<void> | undefined;
export function initPufuWasm(module: InitInput) {
  initialization ??= initWasm(module).catch((error) => {
    // 開発時のHMR等でホストだけ再評価されても、resvgの初期化済み状態は維持される。
    if (
      error instanceof Error &&
      error.message === 'Already initialized. The `initWasm()` function can be used only once.'
    )
      return;
    initialization = undefined;
    throw error;
  });
  return initialization;
}
// ホストがWASMとフォントを供給する。ファイル/ネットワーク/DOM/AIには触れない。
export function renderPufuPng(score: unknown, options: SvgOptions & { font: Uint8Array }) {
  const svg = createPufuSvg(score, options);
  if (!(options.font instanceof Uint8Array) || options.font.byteLength === 0)
    throw new PufuImageError('FONT_UNAVAILABLE', '日本語フォントが必要です。');
  const magic = String.fromCharCode(...options.font.subarray(0, 4));
  if (!['OTTO', '\u0000\u0001\u0000\u0000', 'ttcf', 'true'].includes(magic))
    throw new PufuImageError('FONT_UNAVAILABLE', 'フォントの形式が正しくありません。');
  let renderer: InstanceType<typeof Resvg> | undefined;
  let image: ReturnType<InstanceType<typeof Resvg>['render']> | undefined;
  try {
    renderer = new Resvg(svg, {
      font: { fontBuffers: [options.font], defaultFontFamily: 'Noto Sans CJK JP' },
    });
    image = renderer.render();
    const png = image.asPng();
    if (png.byteLength > imageLimits.maxPngBytes)
      throw new PufuImageError('IMAGE_TOO_LARGE', 'PNGが2MiBを超えています。');
    return { svg, png, width: image.width, height: image.height };
  } catch (cause) {
    if (cause instanceof PufuImageError) throw cause;
    throw new PufuImageError('RENDER_FAILED', 'PNGを生成できません。', { cause });
  } finally {
    image?.free();
    renderer?.free();
  }
}
