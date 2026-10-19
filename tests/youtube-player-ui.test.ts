import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import App from '../src/App';
import PublicProjectPage from '../src/PublicProjects';
import { api } from '../src/api';
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
    title: 'YouTube（記録不可）',
    source_type: 'url',
    source_url: 'https://youtu.be/M7lc1UVf-VE',
    domain: 'youtu.be',
    note: '',
    status: 'failed',
    summary: null,
    error: 'YouTubeのコンテンツは記録できません。URLのみストックに残します。',
    model: null,
    is_favorite: 0,
    created_at: '2026-10-19T00:00:00Z',
  };
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
    if (url.pathname === '/api/public/projects/project')
      return {
        project: {
          public_id: 'project',
          name: '動画のプロジェクト',
          public_description: '',
          stock_count: 1,
          question_count: 0,
        },
      };
    if (url.pathname === '/api/public/projects/project/stocks')
      return { items: [stock], total: 1, page: 1, has_more: false };
    if (url.pathname === '/api/public/projects/project/stocks/youtube-stock')
      return { stock, questions: [], page: 1, total: 0, has_more: false };
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
it('一覧に自動再生しない公式プレーヤーを表示し、タイトルから詳細を開ける', async () => {
  await act(async () => root.render(createElement(App)));
  const card = document.querySelector('.article-card')!;
  expect(card.querySelector('iframe')?.getAttribute('src')).toBe(
    'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE',
  );
  expect(card.querySelector('iframe')?.getAttribute('loading')).toBe('lazy');
  expect(card.querySelector('iframe')?.closest('a,button')).toBeNull();
  await act(async () => card.querySelector<HTMLButtonElement>('.article-open')!.click());
  expect(document.querySelector('.stock-detail')).not.toBeNull();
  expect(document.querySelector('.stock-detail iframe')).not.toBeNull();
  expect(card.querySelector('iframe')).toBeNull();
});
it('保存済みYouTubeストックも記録不可表示から動画プレーヤーに置き換え、編集とリンクを残す', async () => {
  await openStock();
  const detail = document.querySelector('.stock-detail')!;
  expect(detail.querySelector('h3')?.textContent).toBe('YouTube');
  expect(detail.querySelector('iframe')?.getAttribute('src')).toBe(
    'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE',
  );
  expect(detail.querySelector('iframe')?.getAttribute('title')).toBe('YouTube動画プレーヤー');
  // LinkeDOMの属性名はブラウザと異なり大文字小文字を保持する。
  expect(
    detail.querySelector('iframe')?.getAttribute('referrerPolicy') ??
      detail.querySelector('iframe')?.getAttribute('referrerpolicy'),
  ).toBe('strict-origin-when-cross-origin');
  expect(
    detail.querySelector('iframe')?.hasAttribute('allowFullScreen') ||
      detail.querySelector('iframe')?.hasAttribute('allowfullscreen'),
  ).toBe(true);
  expect(detail.textContent).not.toContain('取得失敗');
  expect(detail.textContent).not.toContain('記録できません');
  expect(detail.querySelector('#retry-content')).toBeNull();
  expect(detail.querySelector('a')?.getAttribute('href')).toBe(stock.source_url);
  expect(
    [...detail.querySelectorAll('.detail-tabs button')].map((button) => button.textContent),
  ).toEqual(['動画', 'メモ・保存先']);
  await act(async () =>
    detail.querySelectorAll<HTMLButtonElement>('.detail-tabs button')[1].click(),
  );
  expect(detail.querySelector('iframe')).toBeNull();
  expect(detail.querySelector('#edit-note')).not.toBeNull();
});
it.each([
  ['https://www.youtube.com/watch?v=M7lc1UVf-VE', 'M7lc1UVf-VE'],
  ['https://www.youtube.com/shorts/M7lc1UVf-VE', 'M7lc1UVf-VE'],
  ['https://www.youtube.com/live/M7lc1UVf-VE', 'M7lc1UVf-VE'],
  ['https://www.youtube-nocookie.com/embed/M7lc1UVf-VE', 'M7lc1UVf-VE'],
  ['https://m.youtube.com/watch?v=M7lc1UVf-VE&autoplay=1', 'M7lc1UVf-VE'],
])(
  '動画URLから固定の埋め込み先を表示し、入力の追加パラメータを引き継がない: %s',
  async (url, id) => {
    stock.source_url = url;
    stock.title = '自分で付けたタイトル';
    await openStock();
    expect(document.querySelector('.stock-detail h3')?.textContent).toBe('自分で付けたタイトル');
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe(
      `https://www.youtube-nocookie.com/embed/${id}`,
    );
  },
);
it.each([
  'https://youtube.com/@channel',
  'https://youtube.com/playlist?list=example',
  'https://youtu.be/invalid',
  'https://youtu.be/M7lc1UVf-VE/extra',
])('動画を特定できないURLにはiframeを作らず元のリンクを残す: %s', async (url) => {
  stock.source_url = url;
  await openStock();
  expect(document.querySelector('iframe')).toBeNull();
  const detail = document.querySelector('.stock-detail')!;
  expect(detail.textContent).toContain('このURLは動画を埋め込めません');
  expect(detail.querySelector('a')?.getAttribute('href')).toBe(url);
});
it('YouTubeに似た別ドメインの記事は埋め込まず従来の要約・再試行を表示する', async () => {
  stock.title = '通常記事';
  stock.source_url = 'https://youtube.com.example.com/watch?v=M7lc1UVf-VE';
  await openStock();
  expect(document.querySelector('iframe')).toBeNull();
  expect(document.querySelector('#retry-content')).not.toBeNull();
  expect(document.querySelector('.stock-detail .detail-tabs')?.textContent).toContain('要約');
});
it('公開ストックの一覧にもプレーヤーを表示し、独立したリンクから詳細を開ける', async () => {
  window.location.hash = '#stocks';
  await act(async () => root.render(createElement(PublicProjectPage, { publicId: 'project' })));
  const card = document.querySelector('.public-stock-card')!;
  expect(card.querySelector('iframe')?.getAttribute('src')).toBe(
    'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE',
  );
  expect(card.querySelector('iframe')?.closest('a,button')).toBeNull();
  expect(card.querySelector('a')?.getAttribute('href')).toBe('#stock/youtube-stock');
  expect(document.querySelector('.public-stock-card h3')?.textContent).toBe('YouTube');
  await act(async () => {
    window.location.hash = '#stock/youtube-stock';
    window.dispatchEvent(new window.Event('hashchange'));
  });
  expect(document.querySelector('iframe')?.getAttribute('src')).toBe(
    'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE',
  );
  expect(document.querySelector('.public-stock-title')?.textContent).toBe('YouTube');
  expect(document.querySelector('.public-stock-detail')?.textContent).not.toContain(
    '要約はまだありません',
  );
});
