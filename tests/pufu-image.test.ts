import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createPufuSvg, initPufuWasm, renderPufuPng, PufuImageError } from '@pufu-lens/pufu-image';
import wasm from './resvg-wasm';
import sparse from './fixtures/pufu-sparse.json';
import many from './fixtures/pufu-many-measures.json';
import long from './fixtures/pufu-long-text.json';
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
    for (const showProgress of [true, false]) {
      const result = renderPufuPng(score, { font, showProgress });
      expect(Buffer.from(result.png.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
      expect(Buffer.from(result.png).readUInt32BE(16)).toBe(result.width);
      expect(Buffer.from(result.png).readUInt32BE(20)).toBe(result.height);
      const expected = showProgress
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
