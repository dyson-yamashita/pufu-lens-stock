import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import App from '../src/App';
import { api, send } from '../src/api';
import type { Stock } from '../shared/domain';
import type { EntityComment } from '../shared/comments';

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
    value: new URL('https://example.com/'),
  });
  let historyState: unknown = null;
  Object.defineProperty(window, 'history', {
    configurable: true,
    value: {
      get state() {
        return historyState;
      },
      replaceState(state: unknown) {
        historyState = state;
      },
      pushState(state: unknown, _title: string, url: string) {
        historyState = state;
        window.location.hash = url;
      },
    },
  });
  Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
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
        user: {
          id: 'user',
          name: '利用者',
          onboarding_completed_at: '2026-10-30T00:00:00Z',
          bio: '',
          avatar_url: null,
        },
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
            pufu_count: 0,
            created_at: '2026-10-19',
          },
        ],
      };
    if (url.pathname === '/api/v1/memory') return { memory: null, pending: false, error: null };
    if (url.pathname === '/api/v1/stocks') return { stocks: [stock], total: 1 };
    if (url.pathname === '/api/v1/questions') return { questions: [], total: 0 };
    if (url.pathname === '/api/v1/stocks/youtube-stock') return { stock };
    if (url.pathname === '/api/v1/stocks/youtube-stock/images') return { images: [] };
    if (url.pathname === '/api/v1/comments') return { comments: [], has_more: false };
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
  await act(async () => window.dispatchEvent(new window.Event('hashchange')));
}
it('要約本文の直後に添付画像を表示し、画像タブから戻ると追加分も表示する', async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  let count = 1;
  vi.mocked(api).mockImplementation((path, options) =>
    path === '/api/v1/stocks/youtube-stock/images'
      ? Promise.resolve({
          images: Array.from({ length: count }, (_, i) => ({
            id: String(i),
            filename: `${i}.png`,
          })),
        })
      : original(path, options),
  );
  await openStock();
  const summary = document.querySelector('.detail-summary')!;
  expect(summary.querySelector('p')?.nextElementSibling?.className).toBe('stock-image-carousel');
  expect(summary.querySelector('img')?.getAttribute('alt')).toBe('0.png');
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.detail-tabs button')];
  await act(async () => tabs.find((button) => button.textContent === '画像')!.click());
  count = 2;
  await act(async () => tabs.find((button) => button.textContent === '要約')!.click());
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="次の画像"]')!.click(),
  );
  expect(document.querySelector('.detail-summary img')?.getAttribute('alt')).toBe('1.png');
});
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
  ).toContain('問い・気づきとメモリ');
  expect(
    document.getElementById(textarea.getAttribute('aria-describedby')!)?.textContent,
  ).toContain('問い・気づきも公開');
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
it.each(['text', 'url'] as const)(
  '%sのコメントは専用タブで読み書きでき、タブを往復しても下書きを保持する',
  async (sourceType) => {
    stock.source_type = sourceType;
    stock.source_url = sourceType === 'url' ? 'https://example.com/article' : '';
    const saved: EntityComment = {
      id: 'saved-comment',
      target_type: 'stock',
      target_id: stock.id,
      body: 'これまでの気づき',
      author_id: 'user',
      author_name: '利用者',
      author_kind: 'user',
      created_at: '2026-10-24T00:00:00Z',
    };
    const originalApi = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, options) =>
      path.startsWith('/api/v1/comments?')
        ? { comments: [saved], has_more: false }
        : originalApi(path, options),
    );
    vi.mocked(send).mockResolvedValue({
      comment: { ...saved, id: 'new-comment', body: '書きかけの気づき' },
    });
    await openStock();
    const detail = document.querySelector('.stock-detail')!;
    const tabs = [...detail.querySelectorAll<HTMLButtonElement>('.detail-tabs button')];
    const commentTab = tabs.find((button) => button.textContent === 'コメント');
    expect(commentTab).toBeDefined();
    expect(detail.querySelector('.comments')?.closest('[hidden]')).not.toBeNull();
    await act(async () => commentTab!.click());
    expect(commentTab!.getAttribute('aria-pressed')).toBe('true');
    expect(detail.querySelector('.comments')?.closest('[hidden]')).toBeNull();
    expect(detail.querySelector('.detail-summary')).toBeNull();
    expect(detail.querySelector('#edit-note')).toBeNull();
    expect(detail.querySelector('.comment-list')?.textContent).toContain('これまでの気づき');
    await act(async () => {
      const input = detail.querySelector<HTMLTextAreaElement>('.comments textarea')!;
      input.value = '書きかけの気づき';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await act(async () => tabs[0].click());
    expect(detail.querySelector('.detail-summary')).not.toBeNull();
    expect(detail.querySelector('.comments')?.closest('[hidden]')).not.toBeNull();
    await act(async () => commentTab!.click());
    expect(detail.querySelector<HTMLTextAreaElement>('.comments textarea')?.value).toBe(
      '書きかけの気づき',
    );
    await act(async () =>
      detail
        .querySelector('.comments form')!
        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(send).toHaveBeenCalledWith(
      '/api/v1/comments',
      expect.objectContaining({
        target_type: 'stock',
        target_id: stock.id,
        body: '書きかけの気づき',
      }),
    );
    expect(detail.querySelector('.comment-list')?.textContent).toContain('書きかけの気づき');
    expect(detail.querySelector<HTMLTextAreaElement>('.comments textarea')?.value).toBe('');
  },
);

it('本文採用モードは原文を保ちURLをリンク化し、短文用の案内や空の要点を表示しない', async () => {
  const text =
    '\n  原文の空白と改行を保ちます。https://example.com/a?x=1&y=2\n\n' +
    '<img src=x onerror=alert(1)> javascript:alert(1) ' +
    '内容を省略しない。'.repeat(200) +
    '\n  ';
  stock.summary = { overview: text, keyPoints: [], topics: [], verbatim: true };
  stock.model = 'source-verbatim';
  await openStock();
  const detail = document.querySelector('.detail-summary')!;
  expect(detail.querySelector('.verbatim-content')?.textContent).toBe(text);
  const link = detail.querySelector('.verbatim-content a')!;
  expect(link.getAttribute('href')).toBe('https://example.com/a?x=1&y=2');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(detail.querySelectorAll('.verbatim-content a')).toHaveLength(1);
  expect(detail.querySelector('img[onerror]')).toBeNull();
  expect(detail.textContent).not.toContain('本文が短いため');
  expect(detail.querySelector('h4')).toBeNull();
  const load = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, options) =>
    path === `/api/v1/stocks/${stock.id}/content` ? { content: text } : load(path, options),
  );
  const contentTab = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === '入力した本文',
  )!;
  await act(async () => contentTab.click());
  const body = document.querySelector('.article-body')!;
  expect(body.textContent).toBe(text);
  expect(body.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a?x=1&y=2');
  expect(body.querySelector('img[onerror]')).toBeNull();
});

it('ストックの詳細をモーダルではなく専用URLの画面で開き、再読み込みでも復元する', async () => {
  await openStock();
  expect(window.location.hash).toBe('#stock/youtube-stock');
  expect(
    [...document.querySelectorAll('.breadcrumb a')].map((link) => link.textContent?.trim()),
  ).toEqual(['トップ', 'すべてのストック', '詳細']);
  expect(document.querySelector('.breadcrumb [aria-current="page"]')?.getAttribute('href')).toBe(
    '#stock/youtube-stock',
  );
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.querySelector('.stock-detail-page h1')?.textContent).toBe('ストックの詳細');
  await act(async () => root.render(createElement(App, { key: 'reload' })));
  expect(document.querySelector('.stock-detail h3')?.textContent).toBe(stock.title);
  expect(document.querySelector('dialog')).toBeNull();
});
it('一覧に表示されていないストックのURLを直接開いて取得する', async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation((path, options) =>
    new URL(path, 'https://example.com').pathname === '/api/v1/stocks'
      ? Promise.resolve({ stocks: [], total: 0 })
      : original(path, options),
  );
  window.location.hash = '#stock/youtube-stock';
  await act(async () => root.render(createElement(App)));
  expect(document.querySelector('.stock-detail h3')?.textContent).toBe(stock.title);
});
it('詳細の戻るボタンで保存先の一覧に戻る', async () => {
  window.location.hash = '#project/project';
  await openStock();
  expect(
    [...document.querySelectorAll('.breadcrumb a')].map((link) => link.textContent?.trim()),
  ).toEqual(['トップ', stock.project_name, 'ストック', '詳細']);
  expect(
    [...document.querySelectorAll('.breadcrumb a')]
      .find((link) => link.textContent?.trim() === 'ストック')
      ?.getAttribute('href'),
  ).toBe('#project/project');
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.stock-detail-page .back-link')!.click(),
  );
  await act(async () => window.dispatchEvent(new window.Event('hashchange')));
  expect(window.location.hash).toBe('#project/project');
  expect(document.querySelector('.stock-detail-page')).toBeNull();
  expect(document.querySelector('.article-open')).not.toBeNull();
});
it('存在しないストックのURLでは取得エラーを表示する', async () => {
  window.location.hash = '#stock/missing';
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation((path, options) =>
    path === '/api/v1/stocks/missing'
      ? Promise.reject(new Error('ストックが見つかりません'))
      : original(path, options),
  );
  await act(async () => root.render(createElement(App)));
  expect(document.querySelector('.stock-detail-page [role="alert"]')?.textContent).toContain(
    'ストックが見つかりません',
  );
  expect(document.querySelector('.stock-detail')).toBeNull();
});
it('メモを保存しても詳細画面にとどまり、続けて保存できる', async () => {
  await openStock();
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('.detail-tabs button')]
      .find((button) => button.textContent === 'メモ・保存先')!
      .click(),
  );
  const form = document.querySelector('#edit-note')!.closest('form')!;
  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () =>
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(
      document.querySelector<HTMLButtonElement>('.stock-detail .form-actions button')!.disabled,
    ).toBe(false);
    expect(window.location.hash).toBe('#stock/youtube-stock');
    expect(document.querySelector('.stock-detail')).not.toBeNull();
  }
  expect(
    vi.mocked(send).mock.calls.filter(([path]) => path === '/api/v1/stocks/youtube-stock'),
  ).toHaveLength(2);
});

it.each([null, '再試行前の古い本文'])(
  '再試行後はキャッシュした本文（%s）を取り直す',
  async (oldContent) => {
    stock.source_type = 'url';
    stock.source_url = 'https://example.com/article';
    stock.status = 'failed';
    stock.summary = null;
    let content = oldContent;
    const original = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation((path, options) =>
      path === '/api/v1/stocks/youtube-stock/content'
        ? Promise.resolve({ content })
        : original(path, options),
    );
    vi.mocked(send).mockImplementation(async () => {
      content = '再試行で取得した新しい本文';
      stock = {
        ...stock,
        status: 'ready',
        summary: { overview: content, keyPoints: [], topics: [] },
      };
      return { ok: true };
    });
    await openStock();
    const tab = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('.stock-detail .detail-tabs button')].find(
        (button) => button.textContent === label,
      )!;
    await act(async () => tab('取得した本文').click());
    if (oldContent) expect(document.querySelector('.article-body')?.textContent).toBe(oldContent);
    else expect(document.querySelector('.article-body')?.textContent).toContain('サンプル記事');
    await act(async () => tab('要約').click());
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('.stock-detail button')]
        .find((button) => button.textContent === '取得を再試行')!
        .click(),
    );
    expect(document.querySelector('.stock-detail-page')).not.toBeNull();
    await act(async () => tab('取得した本文').click());
    expect(document.querySelector('.article-body')?.textContent).toBe('再試行で取得した新しい本文');
  },
);

it('問いからストックへ移動して再読み込みしても、元の保存先の問い一覧に戻る', async () => {
  const question = {
    id: 'question',
    stock_id: stock.id,
    project_id: 'project',
    project_name: stock.project_name,
    source: 'user',
    text: '戻り先を保てるか',
    status: 'ready',
    error: null,
    model: null,
    is_favorite: 0,
    has_pufu: 0,
    created_at: stock.created_at,
    updated_at: stock.created_at,
    article_title: stock.title,
    article_status: stock.status,
    domain: stock.domain,
    note: '',
    stocks: [{ id: stock.id, title: stock.title }],
  };
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation((path, options) => {
    const pathname = new URL(path, 'https://example.com').pathname;
    if (pathname === '/api/v1/questions')
      return Promise.resolve({ questions: [question], total: 1 });
    if (pathname === '/api/v1/questions/question') return Promise.resolve({ question, pufus: [] });
    return original(path, options);
  });
  async function hashChange() {
    await act(async () => window.dispatchEvent(new window.Event('hashchange')));
  }
  window.location.hash = '#questions/project';
  await act(async () => root.render(createElement(App)));
  await act(async () => document.querySelector<HTMLButtonElement>('.question-open')!.click());
  await hashChange();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.question-detail-source button')!.click(),
  );
  await hashChange();
  await act(async () => root.render(createElement(App, { key: 'reload-question-origin' })));
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.stock-detail-page .back-link')!.click(),
  );
  await hashChange();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.question-detail-page .back-link')!.click(),
  );
  await hashChange();
  expect(window.location.hash).toBe('#questions/project');
});

it('再試行に一度失敗しても成功後はエラーを消して詳細画面にとどまる', async () => {
  stock.source_type = 'url';
  stock.source_url = 'https://example.com/source';
  stock.status = 'failed';
  stock.summary = null;
  vi.mocked(send)
    .mockRejectedValueOnce(new Error('一時的な再試行エラー'))
    .mockResolvedValueOnce({ ok: true });
  await openStock();
  const retry = () =>
    [...document.querySelectorAll<HTMLButtonElement>('.detail-summary button')].find((button) =>
      button.textContent?.includes('再試行'),
    )!;
  await act(async () => retry().click());
  expect(document.querySelector('.stock-detail .form-error')?.textContent).toContain(
    '一時的な再試行エラー',
  );
  await act(async () => retry().click());
  expect(document.querySelector('.stock-detail .form-error')).toBeNull();
});

it.each([
  { mobile: true, view: 'stocks', pageSize: 6 },
  { mobile: false, view: 'stocks', pageSize: 24 },
  { mobile: true, view: 'questions', pageSize: 6 },
  { mobile: false, view: 'questions', pageSize: 24 },
])(
  '$view: スマホ=$mobile で表示件数とページ移動時のスクロールを切り替える',
  async ({ mobile, view, pageSize }) => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }),
    });
    window.location.hash = view === 'questions' ? '#questions' : '#';
    const original = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation((path, options) => {
      const url = new URL(path, 'https://example.com');
      if (url.pathname === `/api/v1/${view}`) {
        const limit = Number(url.searchParams.get('limit') ?? 24);
        const page = Number(url.searchParams.get('page') ?? 1);
        const items = Array.from(
          { length: Math.min(limit, 49 - (page - 1) * limit) },
          (_, index) => ({
            ...stock,
            id: `item-${(page - 1) * limit + index}`,
            text: `問い${(page - 1) * limit + index}`,
            source: 'user',
          }),
        );
        return Promise.resolve({ [view]: items, total: 49 });
      }
      return original(path, options);
    });
    await act(async () => root.render(createElement(App)));
    const selector = view === 'stocks' ? '.article-card' : '.question-card';
    expect(document.querySelectorAll(selector)).toHaveLength(pageSize);
    const pagination = () => document.querySelector('.pagination')!;
    expect(pagination().textContent).toContain(`1 / ${Math.ceil(49 / pageSize)}`);
    const scroll = vi.mocked(window.scrollTo);
    scroll.mockClear();
    await act(async () => pagination().querySelectorAll<HTMLButtonElement>('button')[1].click());
    expect(pagination().textContent).toContain(`2 / ${Math.ceil(49 / pageSize)}`);
    expect(document.querySelectorAll(selector)).toHaveLength(pageSize);
    expect(document.querySelector(selector)?.textContent).toContain(
      view === 'stocks' ? stock.title : `問い${pageSize}`,
    );
    if (mobile) expect(scroll).toHaveBeenCalledWith(0, 0);
    else expect(scroll).not.toHaveBeenCalled();
    scroll.mockClear();
    await act(async () => pagination().querySelectorAll<HTMLButtonElement>('button')[0].click());
    expect(pagination().textContent).toContain(`1 / ${Math.ceil(49 / pageSize)}`);
    if (mobile) expect(scroll).toHaveBeenCalledWith(0, 0);
    else expect(scroll).not.toHaveBeenCalled();
  },
);
