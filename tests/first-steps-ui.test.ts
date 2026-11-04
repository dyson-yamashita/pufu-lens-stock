import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import App from '../src/App';
import { api } from '../src/api';
import { setLanguage } from '../src/i18n';
import type { Project } from '../shared/domain';

vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));
let root: Root;
let document: Document;
let projects: Project[];
let accountLanguage: 'ja' | 'en';
const project = (id = 'first'): Project => ({
  id,
  name: id,
  description: '',
  show_in_all_lists: true,
  include_in_user_memory: true,
  auto_generate_questions: true,
  count: 0,
  ready_count: 0,
  question_count: 0,
  user_question_count: 0,
  pufu_count: 0,
  created_at: '2026-11-04',
});
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperties(window.HTMLElement.prototype, {
    showModal: { configurable: true, value() {} },
    close: { configurable: true, value() {} },
  });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hash: '', pathname: '/', search: '' },
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: () => 0 });
  const theme = { preference: 'dark' as const, theme: 'dark' as const };
  window.pufuTheme = { getSnapshot: () => theme, subscribe: () => () => {}, setPreference() {} };
  projects = [];
  accountLanguage = 'ja';
  setLanguage('ja');
  vi.mocked(api).mockImplementation(async (path) => {
    const url = new URL(path, 'https://example.com');
    if (url.pathname === '/api/config') return { demo: false, googleConfigured: true };
    if (url.pathname === '/api/v1/me')
      return {
        user: {
          language: accountLanguage,
          id: 'user',
          name: '利用者',
          bio: '',
          avatar_url: null,
          onboarding_completed_at: '2026-11-04',
        },
      };
    if (url.pathname === '/api/v1/projects') return { projects };
    if (url.pathname === '/api/v1/memory') return { memory: null, pending: false, error: null };
    if (url.pathname === '/api/v1/stocks') return { stocks: [], total: 0 };
    if (url.pathname === '/api/v1/questions') return { questions: [], total: 0 };
    throw new Error('想定外の取得先: ' + path);
  });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
async function render() {
  await act(async () => root.render(createElement(App)));
}
async function click(selector: string) {
  await act(async () => document.querySelector<HTMLButtonElement>(selector)!.click());
}
it.each(['ja', 'en'] as const)(
  'プロジェクト0件は説明と次の操作が一致する（%s）',
  async (language) => {
    accountLanguage = language;
    setLanguage(language);
    await render();
    const guide = document.querySelector('.first-steps')!;
    expect(guide.querySelector('h2')!.textContent).toBe(
      language === 'ja' ? '最初のプロジェクトをつくりましょう' : 'Create your first project',
    );
    expect(guide.querySelectorAll('button')).toHaveLength(1);
    await click('.first-steps button');
    expect(document.querySelector('.form-intro')!.textContent).toContain(
      language === 'ja' ? '読書メモ' : 'reading notes',
    );
  },
);

it.each([
  [0, 1, '最初の記事をストック'],
  [1, 0, '問い・気づきを追加'],
] as const)(
  '問いを先に書いても件数どおりに済み表示と次の操作を出す（stock=%s, user=%s）',
  async (count, questions, label) => {
    projects = [{ ...project(), count, user_question_count: questions }];
    await render();
    expect(document.querySelectorAll('.first-step-done')).toHaveLength(2);
    expect(document.querySelector('.first-steps button')!.textContent).toBe(label);
  },
);

it('全体一覧に非表示のプロジェクトも進捗に含め、3つ揃えば消える', async () => {
  projects = [{ ...project(), show_in_all_lists: false, count: 1, user_question_count: 1 }];
  await render();
  expect(document.querySelector('.first-steps')).toBeNull();
});

it('お気に入り0件を初回の空状態と混同しない', async () => {
  projects = [project()];
  await render();
  const favorite = [...document.querySelectorAll<HTMLButtonElement>('.filters button')].find(
    (item) => item.textContent === 'お気に入り',
  )!;
  await act(async () => favorite.click());
  expect(document.querySelector('.first-steps')).toBeNull();
  expect(document.querySelector('.empty-state')!.textContent).toContain('該当する記事はありません');
});

it.each([true, false])(
  '問いの空状態は追加ボタンを持ち、設定に応じてAIの説明を出す（%s）',
  async (auto) => {
    projects = [{ ...project(), auto_generate_questions: auto }];
    window.location.hash = '#questions';
    await render();
    expect(document.querySelector('.questions-page .empty-state button')!.textContent).toBe(
      '問い・気づきを追加',
    );
    expect(
      document.querySelector('.questions-page .empty-state')!.textContent!.includes('AIの問い'),
    ).toBe(auto);
    await click('.questions-page .empty-state button');
    expect(document.querySelector('#question-text')).not.toBeNull();
  },
);
