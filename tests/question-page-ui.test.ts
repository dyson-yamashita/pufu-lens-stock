import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import QuestionPage from '../src/QuestionPage';
import { api, send } from '../src/api';
import type { QuestionDetail } from '../shared/domain';

vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));
const question: QuestionDetail = {
  id: 'question',
  stock_id: null,
  source: 'user',
  is_favorite: 0,
  has_pufu: 1,
  text: '問いの本文',
  note: '保存済みのメモ',
  status: 'ready',
  error: null,
  model: null,
  created_at: '2026-10-24T00:00:00Z',
  updated_at: '2026-10-24T00:00:00Z',
  project_id: 'project',
  project_name: '調べもの',
  article_title: null,
  article_status: null,
  domain: null,
};
const props = {
  id: 'question',
  resolve: false,
  projects: [
    { id: 'project', name: '調べもの' },
    { id: 'other', name: '別の保存先' },
  ],
  onBack: vi.fn(),
  onResolve: vi.fn(),
  onPufu: vi.fn(),
  onStock: vi.fn(),
  onDeleted: vi.fn(),
  onUpdated: vi.fn(),
};
let root: Root;
let document: Document;
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith('/api/v1/comments')
      ? { comments: [], has_more: false }
      : { question, pufus: [{ id: 'pufu', task: '試してみる課題', status: 'ready' }] },
  );
  vi.mocked(send).mockResolvedValue({
    question: {
      ...question,
      note: '書きかけのメモ',
      project_id: 'other',
      project_name: '別の保存先',
    },
  });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
async function render(extra = {}) {
  await act(async () => root.render(createElement(QuestionPage, { ...props, ...extra })));
}
async function tab(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (item) => item.textContent === label,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
  return button;
}
function panel() {
  return document.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
}
async function input(text: string, selector = '#question-note') {
  await act(async () => {
    const textarea = document.querySelector<HTMLTextAreaElement>(selector)!;
    textarea.value = text;
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    document
      .querySelector('#question-note')!
      .closest('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
}

it('本文を初期表示し、プ譜とコメントをそれぞれのタブで操作できる', async () => {
  await render();
  expect([...document.querySelectorAll('[role="tab"]')].map((item) => item.textContent)).toEqual([
    '本文',
    'プ譜',
    'コメント',
    'メモ・保存先',
  ]);
  expect(panel().textContent).toContain('問いの本文');
  await tab('プ譜');
  expect(panel().textContent).toContain('試してみる課題');
  await act(async () => panel().querySelector<HTMLButtonElement>('.pufu-list-item')!.click());
  expect(props.onPufu).toHaveBeenCalledWith('pufu');
  await act(async () =>
    panel().querySelector<HTMLButtonElement>('.question-resolve-action button')!.click(),
  );
  expect(props.onResolve).toHaveBeenCalledOnce();
  await tab('コメント');
  await input('コメントの下書き', '.comments textarea');
  await tab('本文');
  await tab('コメント');
  expect(panel().querySelector('textarea')!.value).toBe('コメントの下書き');
});

it('タブ切り替えと定期取得で下書きを保持し、メモと保存先を保存する', async () => {
  await render();
  await tab('メモ・保存先');
  expect(document.querySelector<HTMLTextAreaElement>('#question-note')!.value).toBe(
    '保存済みのメモ',
  );
  await input('書きかけのメモ');
  const select = document.querySelector('select')!;
  Object.defineProperty(select, 'value', { configurable: true, value: 'other' });
  await act(async () => select.dispatchEvent(new window.Event('change', { bubbles: true })));
  await tab('本文');
  await act(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await vi.advanceTimersByTimeAsync(5000);
  });
  await tab('メモ・保存先');
  expect(document.querySelector<HTMLTextAreaElement>('#question-note')!.value).toBe(
    '書きかけのメモ',
  );
  await submit();
  expect(send).toHaveBeenCalledWith(
    '/api/v1/questions/question',
    { note: '書きかけのメモ', project_id: 'other', stock_ids: [] },
    'PATCH',
  );
  expect(panel().querySelector('[role="status"]')?.textContent).toContain('保存しました');
  expect(props.onUpdated).toHaveBeenCalledOnce();
});

it('保存失敗では入力を残して再試行でき、空のメモも保存できる', async () => {
  await render();
  await tab('メモ・保存先');
  vi.mocked(send).mockRejectedValueOnce(new Error('通信に失敗しました。'));
  await input('消えないメモ');
  await submit();
  expect(panel().querySelector('[role="alert"]')?.textContent).toContain('通信に失敗しました。');
  expect(document.querySelector<HTMLTextAreaElement>('#question-note')!.value).toBe('消えないメモ');
  await input('');
  await submit();
  expect(send).toHaveBeenLastCalledWith(
    '/api/v1/questions/question',
    { note: '', project_id: 'project', stock_ids: [] },
    'PATCH',
  );
});

it('別の画面で保存先が変わった場合、編集中のメモを保ちつつ新しい保存先を使う', async () => {
  await render();
  await tab('メモ・保存先');
  await input('編集中のメモ');
  vi.mocked(api).mockResolvedValueOnce({
    question: { ...question, project_id: 'other', project_name: '別の保存先' },
    pufus: [],
  });
  await act(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(document.querySelector<HTMLTextAreaElement>('#question-note')!.value).toBe('編集中のメモ');
  await submit();
  expect(send).toHaveBeenLastCalledWith(
    '/api/v1/questions/question',
    { note: '編集中のメモ', project_id: 'other', stock_ids: [] },
    'PATCH',
  );
});

it('保存前に始まった定期取得が遅れて届いても保存結果を巻き戻さない', async () => {
  await render();
  let finish!: (value: unknown) => void;
  vi.mocked(api).mockReturnValueOnce(
    new Promise((done) => {
      finish = done;
    }),
  );
  await act(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await vi.advanceTimersByTimeAsync(5000);
  });
  await tab('メモ・保存先');
  await input('書きかけのメモ');
  await submit();
  await act(async () => finish({ question, pufus: [] }));
  await tab('本文');
  expect(panel().textContent).toContain('別の保存先');
});

it('記事に紐づく問いは保存先を固定し、元の記事から変更できると案内する', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith('/api/v1/comments')
      ? { comments: [], has_more: false }
      : { question: { ...question, stock_id: 'stock', article_title: '元の記事' }, pufus: [] },
  );
  await render();
  await tab('メモ・保存先');
  expect(document.querySelector('select')!.disabled).toBe(true);
  expect(panel().textContent).toContain('元の記事');
});

it('左右キーとHome・Endで選択・フォーカスを移し、タブとパネルを関連付ける', async () => {
  await render();
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const focus = vi.spyOn(tabs[1], 'focus');
  const event = new window.Event('keydown', { bubbles: true, cancelable: true });
  Object.assign(event, { key: 'ArrowRight' });
  await act(async () => tabs[0].dispatchEvent(event));
  expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  expect(tabs[1].getAttribute('tabindex')).toBe('0');
  expect(focus).toHaveBeenCalled();
  expect(panel().id).toBe(tabs[1].getAttribute('aria-controls'));
  expect(panel().getAttribute('aria-labelledby')).toBe(tabs[1].id);
  for (const [key, index] of [
    ['End', 3],
    ['Home', 0],
  ] as const) {
    const next = new window.Event('keydown', { bubbles: true, cancelable: true });
    Object.assign(next, { key });
    await act(async () => tabs[1].dispatchEvent(next));
    expect(tabs[index].getAttribute('aria-selected')).toBe('true');
  }
});

it('課題の作成画面ではタブを出さずに既存フォームを表示する', async () => {
  await render({ resolve: true });
  expect(document.querySelector('[role="tablist"]')).toBeNull();
  expect(document.querySelector('#pufu-task')).not.toBeNull();
  expect(document.body.textContent).toContain('問いの本文');
});
