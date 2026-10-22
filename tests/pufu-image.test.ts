import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createPufuSvg, initPufuWasm, renderPufuPng, PufuImageError } from '@pufu-lens/pufu-image';
import wasm from './resvg-wasm';
import sparse from './fixtures/pufu-sparse.json';
import many from './fixtures/pufu-many-measures.json';
import long from './fixtures/pufu-long-text.json';
import { parseHTML } from 'linkedom';
let font: Uint8Array;
beforeAll(async () => {
  await initPufuWasm(wasm);
  font = new Uint8Array(await readFile(new URL('../public/fonts/pufu-jp.otf', import.meta.url)));
});
describe('Pufu JSON -> SVG -> PNG (real WASM)', () => {
  it.each([
    ['sparse', sparse],
    ['many', many],
    ['long', long],
  ] as const)('%s: retains nodes/comments and generates both progress variants', (_name, score) => {
    const original = JSON.stringify(score);
    for (const options of [
      { showProgress: true, theme: 'light' },
      { showProgress: false, theme: 'light' },
      { showProgress: true, theme: 'dark' },
      { showProgress: false, theme: 'dark' },
    ] as const) {
      const result = renderPufuPng(score, { font, ...options });
      expect(Buffer.from(result.png.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
      expect(Buffer.from(result.png).readUInt32BE(16)).toBe(result.width);
      expect(Buffer.from(result.png).readUInt32BE(20)).toBe(result.height);
      const expected = options.showProgress
        ? score.purposes.flatMap((p) => p.measures).filter((m) => 'progress' in m).length
        : 0;
      expect(result.svg.match(/data-role="measure-progress"/g)?.length ?? 0).toBe(expected);
      const nodes = [
        score.gainingGoal,
        score.winCondition,
        ...Object.values(score.elements),
        ...score.purposes.flatMap((p) => [p, ...p.measures]),
      ];
      for (const node of nodes) {
        expect(result.svg).toContain(`data-uuid="${node.uuid}"`);
        if (node.comment.text)
          expect(result.svg).toContain(
            `data-comment-of="${node.uuid}" data-color="${node.comment.color}"`,
          );
      }
      expect(result.svg).not.toContain('登録商標');
      expect(result.svg).not.toContain('Pufu Lens');
    }
    expect(JSON.stringify(score)).toBe(original);
  });
  it('両テーマで内容と配置を保持し、ダークでは施策の色分けと文字のコントラストを保つ', () => {
    const score = structuredClone(sparse);
    const source = score.purposes[0].measures[0];
    const colors = ['white', 'blue', 'green', 'red', 'yellow'] as const;
    score.purposes[0].measures = colors.map((color, index) => ({
      ...source,
      uuid: `theme-${index}`,
      color,
      text: '色の説明 #ffffff fill="#4b5563"',
      comment: { color: 'blue', text: `メモ：${color}` },
    }));
    const light = createPufuSvg(score, { theme: 'light' });
    const dark = createPufuSvg(score, { theme: 'dark' });
    expect(createPufuSvg(score)).toBe(light);
    expect(dark).not.toBe(light);
    const lightSvg = parseHTML(`<html><body>${light}</body></html>`).document.querySelector('svg')!;
    const darkSvg = parseHTML(`<html><body>${dark}</body></html>`).document.querySelector('svg')!;
    expect(darkSvg.textContent).toBe(lightSvg.textContent);
    expect(darkSvg.getAttribute('viewBox')).toBe(lightSvg.getAttribute('viewBox'));
    expect([...darkSvg.querySelectorAll('path')].map((path) => path.getAttribute('d'))).toEqual(
      [...lightSvg.querySelectorAll('path')].map((path) => path.getAttribute('d')),
    );
    const luminance = (hex: string) => {
      const channels = hex
        .slice(1)
        .match(/../g)!
        .map((channel) => {
          const value = parseInt(channel, 16) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const measures = [...darkSvg.querySelectorAll('[data-role="measure"]')];
    const fills = measures.map((measure) => measure.querySelector('rect')!.getAttribute('fill')!);
    expect(new Set(fills).size).toBe(colors.length);
    for (const measure of measures) {
      const background = luminance(measure.querySelector('rect')!.getAttribute('fill')!);
      const foreground = luminance(measure.querySelector('text')!.getAttribute('fill')!);
      expect(
        (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(Buffer.from(renderPufuPng(score, { font, theme: 'dark' }).png)).not.toEqual(
      Buffer.from(renderPufuPng(score, { font, theme: 'light' }).png),
    );
  });
  it.each(['', 'sepia', null, true])('不正なテーマは画像化せずエラーにする：%s', (theme) => {
    expect(() => createPufuSvg(sparse, { theme } as never)).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTIONS' }),
    );
  });
  it('empty and no measures are valid, progress is not invented', () => {
    const score = structuredClone(sparse);
    score.purposes = [];
    score.gainingGoal.text = '';
    expect(renderPufuPng(score, { font }).png.length).toBeGreaterThan(0);
    expect(createPufuSvg(score)).not.toContain('measure-progress');
  });
  it.each([null, {}, 'invalid', { ...sparse, elements: null }])(
    'invalid input is a controlled error: %s',
    (input) => {
      expect(() => renderPufuPng(input, { font })).toThrow(PufuImageError);
    },
  );
  it('rejects excessive image size and invalid XML before rasterizing, then recovers', () => {
    const score = structuredClone(sparse);
    score.elements.people.text = '\n'.repeat(1000);
    expect(() => renderPufuPng(score, { font })).toThrow(
      expect.objectContaining({ code: 'IMAGE_TOO_LARGE' }),
    );
    score.elements.people.text = '\u0000';
    expect(() => createPufuSvg(score)).toThrow(expect.objectContaining({ code: 'INVALID_TEXT' }));
    expect(renderPufuPng(sparse, { font }).png.length).toBeGreaterThan(0);
  });
  it('escapes XML and rejects duplicate UUID, invalid progress, count overflow', () => {
    const score = structuredClone(sparse);
    score.gainingGoal.text = '<script>A & B</script>';
    expect(createPufuSvg(score)).toContain('&lt;script&gt;');
    score.purposes[0].measures[0].progress = 101;
    expect(() => createPufuSvg(score)).toThrow(PufuImageError);
    score.purposes[0].measures[0].progress = 0;
    score.winCondition.uuid = score.gainingGoal.uuid;
    expect(() => createPufuSvg(score)).toThrow(PufuImageError);
    expect(() => createPufuSvg({ ...sparse, purposes: Array(100000).fill(null) })).toThrow(
      PufuImageError,
    );
  });
  it('releases WASM allocations across repeated renders', () => {
    for (let i = 0; i < 30; i++)
      expect(renderPufuPng(sparse, { font, showProgress: !!(i % 2) }).png.length).toBeGreaterThan(
        0,
      );
  });
  it('preserves consecutive/leading spaces and CRLF line breaks in real PNG rendering', () => {
    const images = ['A B', 'A  B', ' A B '].map((text) => {
      const score = structuredClone(sparse);
      score.gainingGoal.text = text;
      return Buffer.from(renderPufuPng(score, { font }).png).toString('base64');
    });
    expect(new Set(images).size).toBe(3);
    const score = structuredClone(sparse);
    score.gainingGoal.text = 'line1\r\nline2';
    const svg = createPufuSvg(score);
    expect(svg).toContain('>line1</text>');
    expect(svg).toContain('>line2</text>');
    expect(svg).toContain('xml:space="preserve"');
  });
  it('can initialize after the host module is hot reloaded', async () => {
    const modulePath = '../packages/pufu-image/src/png.ts?hmr-test';
    const reloaded = (await import(modulePath)) as typeof import('../packages/pufu-image/src/png');
    await expect(reloaded.initPufuWasm(wasm)).resolves.toBeUndefined();
    expect(reloaded.renderPufuPng(sparse, { font }).png.length).toBeGreaterThan(0);
  });
});
