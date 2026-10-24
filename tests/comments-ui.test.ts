import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import Comments from '../src/Comments';
import { api, send } from '../src/api';
import type { EntityComment } from '../shared/comments';

vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));
let root: Root;
let document: Document;
const saved: EntityComment = {
  id: 'comment',
  target_type: 'pufu',
  target_id: 'pufu',
  phase: 1,
  body: '保存した判断\n次の行',
  author_id: 'alice',
  author_name: 'Alice',
  author_kind: 'user',
  created_at: '2026-10-24T00:00:00Z',
};
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(api).mockResolvedValue({ comments: [saved], has_more: false });
  vi.mocked(send).mockResolvedValue({ comment: { ...saved, id: 'new', body: '新しい判断' } });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
async function render(phase = 1) {
  await act(async () =>
    root.render(createElement(Comments, { targetType: 'pufu', targetId: 'pufu', phase })),
  );
}
async function input(text: string) {
  await act(async () => {
    const textarea = document.querySelector('textarea')!;
    textarea.value = text;
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
}
it('作成者・日時・本文を表示し、現在の局面に投稿して入力欄を空にする', async () => {
  await render();
  expect(document.body.textContent).toContain('第1局面のコメント');
  expect(document.body.textContent).toContain('保存した判断\n次の行');
  expect(document.body.textContent).toContain('Alice');
  expect(document.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-24T00:00:00Z');
  await input('新しい判断');
  await submit();
  expect(send).toHaveBeenCalledWith(
    '/api/v1/comments',
    expect.objectContaining({
      target_type: 'pufu',
      target_id: 'pufu',
      phase: 1,
      body: '新しい判断',
      request_id: expect.any(String),
    }),
  );
  expect(document.body.textContent).toContain('新しい判断');
  expect(document.querySelector('textarea')!.value).toBe('');
});
it('投稿失敗時は本文を残し、同じIDで再送して重複を防ぐ', async () => {
  await render();
  vi.mocked(send).mockRejectedValueOnce(new Error('通信に失敗しました。'));
  await input('新しい判断');
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('通信に失敗しました。');
  expect(document.querySelector('textarea')!.value).toBe('新しい判断');
  await submit();
  expect(vi.mocked(send).mock.calls[0][1]).toEqual(vi.mocked(send).mock.calls[1][1]);
});
it('局面切り替え後に届いた以前の一覧を表示しない', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(api).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await render(1);
  vi.mocked(api).mockResolvedValueOnce({
    comments: [{ ...saved, phase: 2, body: '第2局面の判断' }],
    has_more: false,
  });
  await render(2);
  await act(async () => resolve({ comments: [saved], has_more: false }));
  expect(document.body.textContent).toContain('第2局面の判断');
  expect(document.body.textContent).not.toContain('保存した判断');
});

it('一覧の読み込みに失敗しても更新で再試行できる', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('一覧を取得できませんでした。'));
  await render();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('更新');
  await act(async () =>
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent === '更新')!
      .click(),
  );
  expect(document.body.textContent).toContain('保存した判断');
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it('投稿失敗後に局面を切り替えても各下書きを復元し、同じIDで再送する', async () => {
  await render(1);
  vi.mocked(send).mockRejectedValueOnce(new Error('通信に失敗しました。'));
  await input('第1局面の下書き');
  await submit();
  const failedInput = vi.mocked(send).mock.calls[0][1];
  await render(2);
  expect(document.querySelector('textarea')!.value).toBe('');
  await input('第2局面の下書き');
  await render(1);
  expect(document.querySelector('textarea')!.value).toBe('第1局面の下書き');
  await submit();
  expect(vi.mocked(send).mock.calls[1][1]).toEqual(failedInput);
  await render(2);
  expect(document.querySelector('textarea')!.value).toBe('第2局面の下書き');
  await render(1);
  expect(document.querySelector('textarea')!.value).toBe('');
});

it('続きを取得しても投稿済みのコメントが重複せず時系列を保つ', async () => {
  vi.mocked(api).mockResolvedValueOnce({ comments: [saved], has_more: true });
  await render();
  await input('新しい判断');
  await submit();
  vi.mocked(api).mockResolvedValueOnce({
    comments: [
      { ...saved, id: 'middle', body: '途中の履歴', created_at: '2026-10-24T00:00:00.500Z' },
      { ...saved, id: 'new', body: '新しい判断', created_at: '2026-10-24T00:00:01Z' },
    ],
    has_more: false,
  });
  await act(async () =>
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent === '続きを読み込む')!
      .click(),
  );
  expect(
    [...document.querySelectorAll('.comment-list li p')].map((item) => item.textContent),
  ).toEqual(['保存した判断\n次の行', '途中の履歴', '新しい判断']);
  expect(document.body.textContent).not.toContain('続きを読み込む');
});

it('送信中に局面を往復しても二重送信を防ぎ、成功時は該当局面の下書きだけを消す', async () => {
  let resolve!: (value: unknown) => void;
  let resolveList!: (value: unknown) => void;
  vi.mocked(send).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await render(1);
  await input('送信中の下書き');
  await submit();
  await render(2);
  await input('別局面の下書き');
  vi.mocked(api).mockReturnValueOnce(
    new Promise((done) => {
      resolveList = done;
    }),
  );
  await render(1);
  await act(async () => resolveList({ comments: [saved], has_more: false }));
  expect(document.querySelector('textarea')!.value).toBe('送信中の下書き');
  expect(document.querySelector('textarea')!.disabled).toBe(true);
  await submit();
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolve({ comment: { ...saved, id: 'posted-while-away', body: '送信中の下書き' } }),
  );
  expect(document.body.textContent).toContain('送信中の下書き');
  expect(document.body.textContent).toContain('コメントを追加しました。');
  expect(document.querySelector('textarea')!.value).toBe('');
  expect(document.querySelector('textarea')!.disabled).toBe(false);
  await render(2);
  expect(document.querySelector('textarea')!.value).toBe('別局面の下書き');
});
