import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import PufiFeedback from '../src/PufiFeedback';
import { FeedbackDetector } from '../src/feedback-detector';
import { manualTree, selectManualBranch } from '../src/manual-search';
import { api, ApiError, send } from '../src/api';

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
  vi.stubGlobal('location', new URL('https://example.com/p/test?private=value#fragment'));
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
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
it.each([
  { language: 'ja' as const, category: 'その他', message: '1日の送信上限', status: 429 },
  {
    language: 'en' as const,
    category: 'Something else',
    message: 'daily sending limit',
    status: 429,
  },
  { language: 'ja' as const, category: 'その他', message: '送信できませんでした', status: 503 },
])(
  'explains $status in $language and retries the same conversation',
  async ({ language, category, message, status }) => {
    vi.mocked(send).mockRejectedValueOnce(new ApiError('server error', status));
    await act(async () => {
      root.render(
        createElement(PufiFeedback, {
          detector,
          host: null,
          blocked: false,
          screen: 'manual',
          alwaysVisible: true,
          language,
        }),
      );
    });
    await act(async () => document.querySelector<HTMLButtonElement>('.pufi-invitation')!.click());
    await act(async () =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === category)!.click(),
    );
    const submit = () =>
      act(async () => {
        document
          .querySelector('form')!
          .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      });
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(document.querySelector<HTMLButtonElement>('.pufi-send')?.disabled).toBe(false);
    const first = vi.mocked(send).mock.calls[0][1];
    await submit();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('.pufi-thread')?.textContent).toContain(
      language === 'ja' ? '改善' : 'improve',
    );
    expect(vi.mocked(send).mock.calls[1][1]).toEqual(first);
  },
);
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

it('reveals the manual section without navigation and resumes the same conversation', async () => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: 'https://pufu.test/manual', pathname: '/manual' },
  });
  const page = document.createElement('div');
  page.className = 'manual-page';
  page.innerHTML =
    '<main class="manual-main"><details><summary>案内</summary><p id="manual-pufu-1">画像を選び保存します。</p></details></main>';
  document.body.appendChild(page);
  const target = document.getElementById('manual-pufu-1')!;
  target.scrollIntoView = vi.fn();
  target.focus = vi.fn();
  const leaf = {
    id: 'manual-pufu-1',
    title: '画像の保存',
    text: '画像を選び保存します。',
    href: '/manual#manual-pufu-1',
    children: [],
  };
  vi.mocked(manualTree).mockResolvedValue([leaf, { ...leaf, id: 'other' }]);
  vi.mocked(selectManualBranch).mockResolvedValue(leaf);
  const press = async (label: string) =>
    act(async () => {
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent === label)!
        .click();
    });
  await render(false, true);
  await press('何かお困りですか？');
  await press('操作に迷いました');
  await act(async () => {
    const field = document.querySelector('textarea')!;
    field.value = '画像を保存したい';
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => {
    document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  const thread = document.querySelector('.pufi-thread');
  const event = new window.Event('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'button', { value: 0 });
  await act(async () => document.querySelector('.pufi-manual-link')!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(target.scrollIntoView).toHaveBeenCalled();
  expect(page.querySelector('details')!.hasAttribute('open')).toBe(true);
  expect(target.classList.contains('manual-target-highlight')).toBe(true);
  expect(document.querySelector<HTMLElement>('.pufi-panel')?.hidden).toBe(true);
  await act(async () => vi.advanceTimersByTime(4000));
  expect(target.classList.contains('manual-target-highlight')).toBe(false);
  expect(target.hasAttribute('tabindex')).toBe(false);
  await press('会話に戻る');
  expect(document.querySelector('.pufi-thread')).toBe(thread);
  expect(thread?.textContent).toContain('画像を保存したい');
  expect(document.querySelector<HTMLElement>('.pufi-panel')?.hidden).toBe(false);
  expect(selectManualBranch).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});
