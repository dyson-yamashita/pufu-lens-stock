import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import ImageOcr from '../src/ImageOcr';

const createWorker = vi.hoisted(() => vi.fn());
vi.mock('tesseract.js', () => ({ createWorker }));
let root: Root;
let document: Document;
const onText = vi.fn();
const onBusy = vi.fn();
beforeEach(async () => {
  createWorker.mockReset();
  onText.mockReset();
  onBusy.mockReset();
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })),
  );
  root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(createElement(ImageOcr, { disabled: false, onText, onBusy })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
async function choose() {
  const input = document.querySelector('input')!;
  Object.defineProperty(input, 'files', {
    value: [new File(['image'], 'screen.png', { type: 'image/png' })],
    configurable: true,
  });
  await act(async () => {
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
it('同一サイトのOCR資材を指定し、抽出した本文を渡してWorkerを終了する', async () => {
  const terminate = vi.fn(async () => {});
  createWorker.mockResolvedValue({
    recognize: vi.fn(async () => ({ data: { text: ' 日本語の投稿本文\n' } })),
    terminate,
  });
  await choose();
  expect(createWorker).toHaveBeenCalledWith(
    'jpn+eng',
    1,
    expect.objectContaining({
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/core',
      langPath: '/ocr/lang',
      workerBlobURL: false,
    }),
  );
  expect(onText).toHaveBeenCalledWith('日本語の投稿本文');
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
  expect(terminate).toHaveBeenCalled();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('確認・修正');
});
it('ライブラリー初期化のエラー通知だけが届く場合もフォームを解除する', async () => {
  createWorker.mockImplementation((_langs, _oem, options) => {
    queueMicrotask(() => options.errorHandler('private library error'));
    return new Promise(() => {});
  });
  await choose();
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
  expect(onText).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('再試行');
  expect(document.body.textContent).not.toContain('private library error');
});
