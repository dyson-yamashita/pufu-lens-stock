import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import App from '../src/App';
import Profile from '../src/Profile';
import PageLanguage from '../src/PageLanguage';
import UserManual from '../src/UserManual';
import { BootMessage } from '../src/BootMessage';
import { setLanguage } from '../src/i18n';
import { api, ApiError, send } from '../src/api';
import type { User } from '../shared/domain';

vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));
let root: Root;
let document: Document;
let user: User | null;
let preference: Map<string, string>;
let browser: { language: string };
beforeEach(() => {
  const dom = parseHTML('<html><head></head><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  browser = { language: 'en-US' };
  vi.stubGlobal(
    'window',
    new Proxy(dom.window, {
      get(target, property) {
        return property === 'navigator' ? browser : Reflect.get(target, property);
      },
    }),
  );
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  preference = new Map();
  Object.defineProperties(window, {
    localStorage: {
      configurable: true,
      value: {
        getItem: (key: string) => preference.get(key) ?? null,
        setItem: (key: string, value: string) => preference.set(key, value),
      },
    },
    location: { configurable: true, value: { hash: '', pathname: '/', search: '' } },
    matchMedia: {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
    scrollTo: { configurable: true, value() {} },
  });
  user = null;
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/api/config') return { demo: true, googleConfigured: false, aiEnabled: false };
    if (path === '/api/v1/me') {
      if (!user) throw new ApiError('Unauthorized', 401);
      return { user };
    }
    if (path === '/api/v1/projects') return { projects: [] };
    if (path.startsWith('/api/v1/stocks')) return { stocks: [], total: 0 };
    if (path.startsWith('/api/v1/memory')) return { memory: null, pending: false, error: null };
    if (path.startsWith('/api/public/projects')) return { items: [], total: 0, has_more: false };
    return {};
  });
  vi.mocked(send).mockImplementation(async (_path, body) => {
    user = { ...user!, ...(body as object), onboarding_completed_at: '2026-10-30T00:00:00Z' };
    return { user, redirect_to: null };
  });
  const theme = { preference: 'system' as const, theme: 'light' as const };
  window.pufuTheme = { getSnapshot: () => theme, subscribe: () => () => {}, setPreference() {} };
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const render = () => act(async () => root.render(createElement(App)));
async function select(id: string, value: string) {
  const element = document.querySelector(`#${id}`)! as unknown as HTMLSelectElement;
  // LinkeDOM implements value as a getter; selected options are its native source.
  for (const option of element.options) option.selected = option.value === value;
  await act(async () => element.dispatchEvent(new window.Event('change', { bubbles: true })));
}
const completed = (language: 'ja' | 'en'): User => ({
  id: 'u',
  name: 'ストック',
  bio: 'Saved 日本語',
  avatar_url: null,
  language,
  onboarding_completed_at: '2026-10-30',
});

it.each([
  ['en-US', 'Open local demo', 'en'],
  ['fr-FR', 'Open local demo', 'en'],
  ['ja-JP', 'ローカルデモを開く', 'ja'],
])(
  'uses primary browser language %s for real landing controls',
  async (primary, label, language) => {
    Object.defineProperty(window.navigator, 'language', { value: primary });
    await render();
    expect(document.querySelector('.demo-login')?.textContent).toContain(label);
    expect(document.documentElement.lang).toBe(language);
    expect(document.querySelector('#site-language')).not.toBeNull();
  },
);

it('keeps explicit anonymous English choice when a new account has its default Japanese language and saves onboarding', async () => {
  Object.defineProperty(window.navigator, 'language', { value: 'ja-JP' });
  await render();
  await select('site-language', 'en');
  expect(document.querySelector('.demo-login')?.textContent).toContain('Open local demo');
  user = { ...completed('ja'), name: '', onboarding_completed_at: null };
  await act(async () => root.unmount());
  root = createRoot(document.getElementById('root')!);
  await render();
  expect(
    (document.querySelector('#onboarding-language') as unknown as HTMLSelectElement)?.value,
  ).toBe('en');
  const name = document.querySelector<HTMLInputElement>('#onboarding-name')!;
  await act(async () => {
    name.value = 'ふくろう';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  for (const id of ['onboarding-terms', 'onboarding-privacy']) {
    const field = document.querySelector<HTMLInputElement>(`#${id}`)!;
    await act(async () => {
      field.checked = true;
      field.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
  }
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(send).toHaveBeenCalledWith(
    '/api/v1/onboarding',
    expect.objectContaining({ language: 'en', name: 'ふくろう' }),
  );
  expect(document.querySelector('h1')?.textContent).toBe('All stocks');
});

it('uses the completed account language ahead of browser preference and applies saved profile changes without translating user names', async () => {
  Object.defineProperty(window.navigator, 'language', { value: 'ja-JP' });
  window.location.hash = '#profile';
  user = completed('en');
  await render();
  expect(document.querySelector('h1')?.textContent).toBe('Profile');
  expect(document.querySelector('.profile-identity h2')?.textContent).toBe('ストック');
  expect(document.querySelector<HTMLTextAreaElement>('#profile-bio')?.value).toBe('Saved 日本語');
  await select('profile-language', 'ja');
  // A draft choice must not switch the app until the account save succeeds.
  expect(document.querySelector('h1')?.textContent).toBe('Profile');
  await act(async () =>
    document
      .querySelector('.profile-card form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(send).toHaveBeenCalledWith(
    '/api/v1/me',
    expect.objectContaining({ language: 'ja', name: 'ストック' }),
    'PATCH',
  );
  expect(document.querySelector('h1')?.textContent).toBe('プロフィール');
  expect(document.querySelector('.profile-identity h2')?.textContent).toBe('ストック');
});

it('keeps failed profile drafts and the active language when saving fails', async () => {
  user = completed('en');
  window.location.hash = '#profile';
  await render();
  await select('profile-language', 'ja');
  vi.mocked(send).mockRejectedValueOnce(new Error('Connection unavailable'));
  await act(async () =>
    document
      .querySelector('.profile-card form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  expect((document.querySelector('#profile-language') as unknown as HTMLSelectElement)?.value).toBe(
    'ja',
  );
  expect(document.querySelector('h1')?.textContent).toBe('Profile');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Connection unavailable');
});

it('can start and switch language when local storage is unavailable', async () => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked');
    },
  });
  await render();
  await select('site-language', 'ja');
  expect(document.querySelector('.demo-login')?.textContent).toContain('ローカルデモを開く');
});

it('individual legacy components remain Japanese before an application locale is initialized', async () => {
  await act(async () =>
    root.render(createElement(Profile, { user: completed('ja'), onSave() {} })),
  );
  expect(document.querySelector('.profile-card')?.getAttribute('aria-label')).toBe(
    'プロフィールの編集',
  );
});

it('resolves the saved account language before rendering a directly entered manual page', async () => {
  user = completed('en');
  Object.defineProperty(window.navigator, 'language', { value: 'ja-JP' });
  await act(async () => root.render(createElement(PageLanguage, {}, createElement(UserManual))));
  expect(document.querySelector('h1')?.textContent).toBe('User manual');
  expect(document.querySelector('a[href="/en/privacy"]')).not.toBeNull();
});

it.each([false, true])(
  'uses English typing without Japanese composition (reduced motion: %s)',
  async (reduced) => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
    });
    vi.useFakeTimers();
    try {
      setLanguage('en');
      await act(async () => root.render(createElement(BootMessage)));
      expect(document.querySelector('.boot-message-label')?.textContent).toBe(
        'Opening your knowledge shelf...',
      );
      await act(async () => vi.advanceTimersByTime(7000));
      if (reduced)
        expect(document.querySelector('.boot-message-typing')?.textContent).toContain(
          'Please wait.',
        );
      expect(document.querySelector('.boot-message-typing')?.textContent).not.toMatch(
        /[ぁ-んァ-ヶ一-龯]/,
      );
      expect(document.querySelector('.boot-composing')?.textContent).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  },
);

it('keeps the public manual readable when fetching the account language fails', async () => {
  vi.mocked(api).mockRejectedValue(new ApiError('Unavailable', 503));
  await act(async () => root.render(createElement(PageLanguage, {}, createElement(UserManual))));
  expect(document.querySelector('h1')?.textContent).toBe('User manual');
  expect(document.querySelector('.manual-toc')).not.toBeNull();
});

it('a completed Japanese account overrides an explicit local English preference', async () => {
  preference.set('pufu-language', 'en');
  user = completed('ja');
  await render();
  expect(document.querySelector('h1')?.textContent).toBe('すべてのストック');
  expect(document.documentElement.lang).toBe('ja');
});
