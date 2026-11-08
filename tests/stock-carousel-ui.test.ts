import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import StockImageCarousel from '../src/StockImageCarousel';
import StockImages from '../src/StockImages';
import { api } from '../src/api';
import { setLanguage } from '../src/i18n';

vi.mock('../src/api', () => ({ api: vi.fn(), createRequestId: vi.fn() }));
const images = ['first', 'second', 'third'].map((id) => ({
  id,
  filename: `${id}.png`,
  url: `/api/v1/stocks/stock/images/${id}`,
}));
let root: Root;
let document: Document;
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setLanguage('ja');
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
const render = async (value = images) =>
  act(async () => root.render(createElement(StockImageCarousel, { images: value })));
const shown = () => document.querySelector('img')?.getAttribute('alt');
const click = async (label: string) =>
  act(async () =>
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(),
  );

it('0枚は表示せず、1枚は画像リンクだけを表示し切替ボタンを出さない', async () => {
  await render([]);
  expect(document.querySelector('section')).toBeNull();
  await render(images.slice(0, 1));
  expect(shown()).toBe('first.png');
  expect(document.querySelector('a')?.getAttribute('href')).toBe(images[0].url);
  expect(document.querySelectorAll('button')).toHaveLength(0);
});

it('複数画像を前後ボタンと左右キーで循環し、枚数とリンクを更新する', async () => {
  await render();
  await click('次の画像');
  expect(shown()).toBe('second.png');
  expect(document.querySelector('[role="status"]')?.textContent).toBe('2 / 3');
  expect(document.querySelector('a')?.getAttribute('href')).toBe(images[1].url);
  await act(async () => {
    const event = new window.Event('keydown', { bubbles: true, cancelable: true });
    Object.assign(event, { key: 'ArrowRight' });
    document.querySelector('a')!.dispatchEvent(event);
  });
  expect(shown()).toBe('third.png');
  await click('次の画像');
  expect(shown()).toBe('first.png');
  await click('前の画像');
  expect(shown()).toBe('third.png');
  await render(images.slice(0, 1));
  expect(shown()).toBe('first.png');
  expect(document.querySelector('[role="status"]')).toBeNull();
});

it('横スワイプで切り替え、縦スクロールとピンチ操作では切り替えない', async () => {
  await render();
  const touch = async (
    name: string,
    touches: { clientX: number; clientY: number }[],
    changedTouches = touches,
  ) =>
    act(async () => {
      const event = new window.Event(name, { bubbles: true, cancelable: true });
      Object.assign(event, { touches, changedTouches });
      document.querySelector('.stock-image-slide')!.dispatchEvent(event);
    });
  await touch('touchstart', [{ clientX: 200, clientY: 40 }]);
  await touch('touchend', [], [{ clientX: 70, clientY: 45 }]);
  expect(shown()).toBe('second.png');
  await touch('touchstart', [{ clientX: 100, clientY: 40 }]);
  await touch('touchend', [], [{ clientX: 20, clientY: 200 }]);
  expect(shown()).toBe('second.png');
  await touch('touchstart', [
    { clientX: 200, clientY: 40 },
    { clientX: 150, clientY: 45 },
  ]);
  await touch('touchend', [], [{ clientX: 30, clientY: 45 }]);
  expect(shown()).toBe('second.png');
});

it('要約用の読み込み失敗を再試行でき、管理操作を表示せず既存の認証URLを使う', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({ images });
  await act(async () =>
    root.render(createElement(StockImages, { stockId: 'stock', view: 'summary' })),
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    '添付画像を読み込めませんでした。',
  );
  await act(async () => document.querySelector<HTMLButtonElement>('button')!.click());
  expect(api).toHaveBeenLastCalledWith('/api/v1/stocks/stock/images');
  expect(shown()).toBe('first.png');
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(document.querySelector('[aria-label="画像を削除：first.png"]')).toBeNull();
});
