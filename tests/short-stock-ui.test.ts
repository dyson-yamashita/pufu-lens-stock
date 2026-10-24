import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import App from '../src/App';
import { api, send } from '../src/api';
import type { Stock } from '../shared/domain';

vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));
let root: Root;
let document: Document;
let stock: Stock;
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // LinkeDOMにはdialogのネイティブ表示APIがないため、描画の入口だけを補う。
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
  Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: vi.fn() });
  const theme = { preference: 'dark' as const, theme: 'dark' as const };
  window.pufuTheme = { getSnapshot: () => theme, subscribe: () => () => {}, setPreference() {} };
  stock = {
    id: 'youtube-stock',
    article_id: 'youtube-article',
    project_id: 'project',
    project_name: '動画のプロジェクト',
    title: 'dot用プロジェクト',
    source_type: 'text',
    source_url: '',
    domain: 'youtu.be',
    note: '',
    status: 'ready',
    summary: {
      overview: 'dot用のプロジェクトを割り当ててみる',
      keyPoints: ['dot用のプロジェクトを割り当ててみる'],
      topics: [],
      shortSource: true,
    },
    error: null,
    model: 'source-extract',
    is_favorite: 0,
    created_at: '2026-10-19T00:00:00Z',
  };
  vi.mocked(send).mockResolvedValue({ ok: true });
  vi.mocked(api).mockImplementation(async (path) => {
    const url = new URL(path, 'https://example.com');
    if (url.pathname === '/api/config')
      return { demo: false, googleConfigured: true, aiEnabled: false, aiModel: null };
    if (url.pathname === '/api/v1/me')
      return {
        user: { id: 'user', name: '利用者', email: 'user@example.com', bio: '', avatar_url: null },
      };
    if (url.pathname === '/api/v1/projects')
      return {
        projects: [
          {
            id: 'project',
            name: '動画のプロジェクト',
            description: '',
            include_in_user_memory: true,
            count: 1,
            ready_count: 0,
            question_count: 0,
            created_at: '2026-10-19',
          },
        ],
      };
    if (url.pathname === '/api/v1/memory') return { memory: null, pending: false, error: null };
    if (url.pathname === '/api/v1/stocks') return { stocks: [stock], total: 1 };
    if (url.pathname === '/api/v1/questions') return { questions: [], total: 0 };
    if (url.pathname === '/api/v1/stocks/youtube-stock') return { stock };
    throw new Error('想定外の取得先: ' + path);
  });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function openStock() {
  await act(async () => root.render(createElement(App)));
  const button = document.querySelector<HTMLButtonElement>('.article-open')!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
}
it('短い本文の案内から公開範囲の説明つきメモフォームを開き、保存エラー後も再入力できる', async () => {
  await openStock();
  const detail = document.querySelector('.stock-detail')!;
  const button = [...detail.querySelectorAll('button')].find(
    (item) => item.textContent === 'ひとことメモを残す',
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  const textarea = detail.querySelector<HTMLTextAreaElement>('#edit-note')!;
  expect(textarea).not.toBeNull();
  expect(detail.querySelector('label[for="edit-note"]')?.textContent).toContain('なぜ気になった');
  expect(
    document.getElementById(textarea.getAttribute('aria-describedby')!)?.textContent,
  ).toContain('問いとメモリ');
  expect(
    document.getElementById(textarea.getAttribute('aria-describedby')!)?.textContent,
  ).toContain('問いも公開');
  vi.mocked(send).mockRejectedValueOnce(new Error('保存できませんでした'));
  await act(async () =>
    textarea
      .closest('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(detail.querySelector('#edit-note')).not.toBeNull();
  expect(detail.textContent).toContain('保存できませんでした');
  expect(detail.querySelector<HTMLButtonElement>('.form-actions button')!.disabled).toBe(false);
});
it.each(['メモあり', '長文'])('%sでは初回のメモ案内を表示しない', async (kind) => {
  if (kind === 'メモあり') stock.note = '考えを残している';
  else delete stock.summary!.shortSource;
  await openStock();
  expect(
    [...document.querySelectorAll('button')].some(
      (item) => item.textContent === 'ひとことメモを残す',
    ),
  ).toBe(false);
});
