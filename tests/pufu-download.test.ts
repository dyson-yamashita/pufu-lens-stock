import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createPufuPng } from '../src/pufu-download';
import { pufuScoreSchema } from '../shared/pufu';
import fixture from './fixtures/pufu-sparse.json';

vi.mock('@resvg/resvg-wasm/index_bg.wasm?url', async () => ({
  default: (await import('./resvg-wasm')).default,
}));
afterEach(() => vi.unstubAllGlobals());

it('日本語フォントと実際のWASMで両テーマのPNGを生成し、取得失敗後も再試行できる', async () => {
  const font = await readFile(new URL('../public/fonts/pufu-jp.otf', import.meta.url));
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const score = pufuScoreSchema.parse(fixture);
  const original = structuredClone(score);
  await expect(createPufuPng(score, 'light')).rejects.toThrow(
    '画像用フォントを取得できませんでした',
  );
  const images: Buffer[] = [];
  for (const theme of ['light', 'dark'] as const) {
    fetch.mockResolvedValueOnce(new Response(font));
    const blob = await createPufuPng(score, theme);
    expect(blob.type).toBe('image/png');
    const png = Buffer.from(await blob.arrayBuffer());
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBeGreaterThan(0);
    expect(png.readUInt32BE(20)).toBeGreaterThan(0);
    images.push(png);
  }
  expect(images[0]).not.toEqual(images[1]);
  expect(score).toEqual(original);
  expect(fetch).toHaveBeenLastCalledWith('/fonts/pufu-jp.otf');
});
