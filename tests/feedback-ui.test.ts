import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import PufiFeedback from '../src/PufiFeedback';
import { FeedbackDetector } from '../src/feedback-detector';
import { manualTree, selectManualBranch } from '../src/manual-search';
import { api, send } from '../src/api';

vi.mock('../src/manual-search', () => ({ manualTree: vi.fn(), selectManualBranch: vi.fn() }));
vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
  send: vi.fn(),
  createRequestId: () => crypto.randomUUID(),
}));
let root: Root;
let document: Document;
let detector: FeedbackDetector;
let local: Map<string, string>;
const storage = (values: Map<string, string>) => ({
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api).mockResolvedValue({ user: { id: 'alice' } });
  vi.mocked(send).mockResolvedValue({ received: true, round: 0, follow_up: null, pending: false });
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  local = new Map([['pufi-detection-consent', 'true']]);
  vi.stubGlobal('localStorage', storage(local));
  vi.stubGlobal('sessionStorage', storage(new Map()));
  detector = new FeedbackDetector();
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const render = async (blocked = false, alwaysVisible = false, host: HTMLElement | null = null) =>
  act(async () => {
    root.render(createElement(PufiFeedback, { detector, host, blocked, alwaysVisible }));
  });
const advance = async () =>
  act(async () => {
    vi.advanceTimersByTime(4000);
  });
const clicks = () => {
  for (let i = 0; i < 4; i++) detector.click('control', 'same');
};

it('keeps normal pages hidden until repeated trouble; declining hides the whole entry for seven days', async () => {
  detector.enable(true);
  await render();
  expect(document.querySelector('.pufi-feedback')).toBeNull();
  clicks();
  await advance();
  expect(document.querySelector('.pufi-prompt')?.textContent).toContain('操作でお困りですか？');
  expect(send).not.toHaveBeenCalled();
  await act(async () =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === '大丈夫です')!.click(),
  );
  expect(document.querySelector('.pufi-feedback')).toBeNull();
  expect(Number(local.get('pufi-until')) - Date.now()).toBe(7 * 86400000);
});
it('shows the manual entry during cooldown, without any settings or detection consent', async () => {
  local.set('pufi-detection-consent', 'false');
  local.set('pufi-until', String(Date.now() + 7 * 86400000));
  await render(false, true);
  expect(document.querySelector('.pufi-invitation')?.textContent).toBe('何かお困りですか？');
  await act(async () => document.querySelector<HTMLButtonElement>('.pufi-invitation')!.click());
  expect(document.querySelector('.pufi-thread')?.textContent).toContain(
    'お困りのことを教えてください',
  );
  expect(document.querySelector('[aria-label="プフィの設定"]')).toBeNull();
  expect(document.body.textContent).not.toContain('声かけを受け取る');
  expect(send).not.toHaveBeenCalled();
});
it('suppresses new automatic prompts while busy or focused in an input', async () => {
  detector.enable(true);
  await render(true);
  clicks();
  await advance();
  expect(document.querySelector('.pufi-feedback')).toBeNull();
  const input = document.createElement('textarea');
  document.body.appendChild(input);
  Object.defineProperty(document, 'activeElement', { configurable: true, value: input });
  await render();
  await advance();
  expect(document.querySelector('.pufi-feedback')).toBeNull();
  Object.defineProperty(document, 'activeElement', { configurable: true, value: null });
  await advance();
  expect(document.querySelector('.pufi-prompt')).not.toBeNull();
});

it('preserves manual search and unresolved drafts when dialog hosts and busy state change', async () => {
  const leaf = {
    id: 'manual-pufu-1',
    title: '画像の保存',
    text: '画像を選び保存します。',
    href: '/manual#manual-pufu-1',
    children: [],
  };
  vi.mocked(manualTree).mockResolvedValue([leaf, { ...leaf, id: 'manual-pufu-2' }]);
  let resolve!: (node: typeof leaf) => void;
  vi.mocked(selectManualBranch).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const press = async (label: string) =>
    act(async () => {
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!
        .click();
    });
  const enter = async (text: string) =>
    act(async () => {
      const field = document.querySelector('textarea')!;
      field.value = text;
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  await render(false, true);
  await press('何かお困りですか？');
  await press('操作に迷いました');
  await enter('画像を保存したい');
  await act(async () => {
    document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  const thread = document.querySelector('.pufi-thread');
  const dialog = document.createElement('dialog');
  document.body.appendChild(dialog);
  await render(true, true, dialog);
  expect(dialog.querySelector('.pufi-thread')).toBe(thread);
  await act(async () => resolve(leaf));
  await render(false, true);
  expect(document.querySelector('.pufi-thread')).toBe(thread);
  expect(thread?.textContent).toContain('お役に立ちましたか？');
  await press('解決しませんでした');
  await enter('保存先が分かりません');
  await render(true, true, dialog);
  await render(false, true);
  expect(document.querySelector('textarea')?.value).toBe('保存先が分かりません');
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="プフィとの会話を閉じる"]')?.disabled,
  ).toBe(false);
  expect(selectManualBranch).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});
