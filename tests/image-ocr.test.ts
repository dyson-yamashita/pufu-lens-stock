import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import ImageOcr from '../src/ImageOcr';

let root: Root;
let document: Document;
const fetchOcr = vi.fn();
const onText = vi.fn();
const onBusy = vi.fn();
beforeEach(async () => {
  fetchOcr
    .mockReset()
    .mockResolvedValue(Response.json({ text: 'プロジェクト\nX API', model: 'qwen' }));
  onText.mockReset();
  onBusy.mockReset();
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('fetch', fetchOcr);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(createElement(ImageOcr, { disabled: false, onText, onBusy })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
async function choose(file = new File(['image'], 'screen.png', { type: 'image/png' })) {
  const input = document.querySelector('input')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  return file;
}
it('画像をサーバーへ送信し、抽出本文を確認用フォームへ渡す', async () => {
  const file = await choose();
  expect(fetchOcr).toHaveBeenCalledWith(
    '/api/v1/ocr',
    expect.objectContaining({
      method: 'POST',
      body: file,
      credentials: 'same-origin',
      headers: expect.objectContaining({
        'Content-Type': 'image/png',
        'Idempotency-Key': expect.any(String),
      }),
    }),
  );
  expect(onText).toHaveBeenCalledWith('プロジェクト\nX API');
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
  expect(document.querySelector('[role="status"]')?.textContent).toContain('確認・修正');
  expect(document.body.textContent).toContain('Cloudflare');
});
it('上限時は再試行目安を表示し、本文を上書きせず、フォームを解除する', async () => {
  fetchOcr.mockResolvedValue(
    Response.json(
      { error: '利用上限に達しました。', retry_at: '2026-10-17T00:00:00Z' },
      { status: 429 },
    ),
  );
  await choose();
  expect(onText).not.toHaveBeenCalled();
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('再試行目安');
  expect(fetchOcr).toHaveBeenCalledOnce();
});
it('通信失敗時に生のエラーを表示せず、自動再送せず、フォームを解除する', async () => {
  fetchOcr.mockRejectedValue(new Error('private network details'));
  await choose();
  expect(onText).not.toHaveBeenCalled();
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('再試行');
  expect(document.body.textContent).not.toContain('private network details');
  expect(fetchOcr).toHaveBeenCalledOnce();
});
it('未対応の画像形式をアップロード前に拒否する', async () => {
  await choose(new File(['image'], 'screen.svg', { type: 'image/svg+xml' }));
  expect(fetchOcr).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('PNG');
});
it('画面を離れた後の認識結果をフォームへ反映しない', async () => {
  let finish!: (response: Response) => void;
  fetchOcr.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  await choose();
  const signal = fetchOcr.mock.calls[0][1].signal as AbortSignal;
  await act(async () => root.unmount());
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish(Response.json({ text: '古い結果', model: 'qwen' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(onText).not.toHaveBeenCalled();
});

it.each([true, false])(
  '通信失敗後は同じ画像だけ読み取りIDを再利用する（同じ画像: %s）',
  async (same) => {
    fetchOcr.mockRejectedValue(new Error('network failure'));
    await choose(new File(['image A'], 'screen.png', { type: 'image/png' }));
    await choose(new File([same ? 'image A' : 'image B'], 'screen.png', { type: 'image/png' }));
    const first = fetchOcr.mock.calls[0][1].headers['Idempotency-Key'];
    const second = fetchOcr.mock.calls[1][1].headers['Idempotency-Key'];
    expect(first === second).toBe(same);
  },
);
