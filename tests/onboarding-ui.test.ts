import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import App from '../src/App';
import { api, send } from '../src/api';
import type { User } from '../shared/domain';

vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));
let root: Root;
let document: Document;
let user: User;
let requested: string[];
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperties(window, {
    location: { configurable: true, value: { hash: '', pathname: '/', search: '' } },
    matchMedia: {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
    scrollTo: { configurable: true, value() {} },
  });
  user = { id: 'user', name: '', bio: '', avatar_url: null, onboarding_completed_at: null };
  requested = [];
  vi.mocked(send).mockReset();
  vi.mocked(api).mockImplementation(async (path) => {
    requested.push(path);
    if (path === '/api/config') return { demo: false, googleConfigured: true, aiEnabled: false };
    if (path === '/api/v1/me') return { user };
    if (path === '/api/v1/projects') return { projects: [] };
    if (path.startsWith('/api/v1/stocks')) return { stocks: [], total: 0 };
    if (path.startsWith('/api/v1/memory')) return { memory: null, pending: false, error: null };
    throw new Error('想定外の取得先');
  });
  vi.mocked(send).mockImplementation(async (path, body) => {
    if (path === '/api/v1/logout') {
      user = null as unknown as User;
      return { ok: true };
    }
    user = {
      ...user,
      name: (body as { name: string }).name,
      onboarding_completed_at: '2026-10-30T00:00:00Z',
    };
    return { user, redirect_to: null };
  });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const render = () => act(async () => root.render(createElement(App)));
const ok = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'OK',
  )!;
async function nickname(value: string) {
  const field = document.querySelector<HTMLInputElement>('#onboarding-name')!;
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function check(id: string) {
  const field = document.querySelector<HTMLInputElement>(`#${id}`)!;
  await act(async () => {
    field.checked = true;
    // LinkeDOMにないネイティブのチェック切替だけを補い、Reactには実際のクリックを渡す。
    field.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}
const submit = () =>
  act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );

it('未登録なら同意画面のみ表示し、名前と両方の同意が揃ってから利用を開始する', async () => {
  await render();
  expect(document.querySelector('#onboarding-name')).not.toBeNull();
  expect(document.querySelector('.workspace')).toBeNull();
  expect(requested.some((path) => path.startsWith('/api/v1/stocks'))).toBe(false);
  expect(ok().disabled).toBe(true);
  for (const path of ['/terms?lang=ja', '/privacy?lang=ja'])
    expect(document.querySelector(`a[href="${path}"]`)?.getAttribute('target')).toBe('_blank');
  await nickname('ふくろう');
  await check('onboarding-terms');
  expect(ok().disabled).toBe(true);
  await submit();
  expect(document.querySelector('.workspace')).toBeNull();
  await check('onboarding-privacy');
  expect(ok().disabled).toBe(false);
  await submit();
  expect(document.querySelector('#onboarding-name')).toBeNull();
  expect(document.querySelector('.workspace')).not.toBeNull();
  expect(document.querySelector('.user-info')?.textContent).toContain('ふくろう');
});

it('登録が失敗しても入力を保持して再試行でき、未完了で開き直すと同意を求める', async () => {
  await render();
  await nickname('ふくろう');
  await check('onboarding-terms');
  await check('onboarding-privacy');
  vi.mocked(send).mockRejectedValueOnce(new Error('登録できませんでした'));
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('登録できませんでした');
  expect(document.querySelector<HTMLInputElement>('#onboarding-name')!.value).toBe('ふくろう');
  expect(ok().disabled).toBe(false);
  await act(async () => root.unmount());
  root = createRoot(document.getElementById('root')!);
  await render();
  expect(ok().disabled).toBe(true);
  expect(document.querySelector('.workspace')).toBeNull();
});

it('未同意の画面からログアウトできる', async () => {
  await render();
  const logout = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'ログアウト',
  );
  expect(logout).toBeDefined();
  await act(async () => logout!.click());
  expect(document.querySelector('.login-page')).not.toBeNull();
});
