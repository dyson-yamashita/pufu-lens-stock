import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import App from '../src/App';
import { api, send } from '../src/api';

vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));
let root: Root;
let document: Document;
let requests: URL[];
let listError: boolean;
let total: number;
let includeStock: boolean;
let independent: boolean;
const summary = {
  id: 'pufu',
  question_id: 'question',
  project_id: 'project',
  project_name: '実行のプロジェクト',
  question_text: '継続するには？',
  task: '毎日小さく実行する',
  status: 'generating',
  error: null,
  model: null,
  editor_version: '0.9.18',
  revision: 1,
  current_phase: 2,
  generation: 1,
  created_at: '2026-10-22T00:00:00Z',
  updated_at: '2026-10-22T00:00:00Z',
};
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperties(window, {
    location: { configurable: true, value: new URL('https://example.com/') },
    matchMedia: {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
    scrollTo: { configurable: true, value: vi.fn() },
    requestAnimationFrame: { configurable: true, value: () => 0 },
    cancelAnimationFrame: { configurable: true, value: vi.fn() },
  });
  requests = [];
  listError = false;
  total = 1;
  includeStock = false;
  independent = false;
  Object.defineProperties(window.HTMLElement.prototype, {
    showModal: { configurable: true, value() {} },
    close: { configurable: true, value() {} },
  });
  vi.mocked(api).mockImplementation(async (path) => {
    const url = new URL(path, 'https://example.com');
    requests.push(url);
    switch (url.pathname) {
      case '/api/config':
        return { demo: false, googleConfigured: true, aiEnabled: false, aiModel: null };
      case '/api/v1/me':
        return {
          user: {
            id: 'user',
            name: '利用者',
            email: 'user@example.com',
            bio: '',
            avatar_url: null,
          },
        };
      case '/api/v1/projects':
        return {
          projects: [
            {
              id: 'project',
              name: '実行のプロジェクト',
              description: '',
              show_in_all_lists: true,
              include_in_user_memory: true,
              count: 0,
              ready_count: 0,
              question_count: 1,
              created_at: summary.created_at,
            },
          ],
        };
      case '/api/v1/stocks':
        return {
          stocks: includeStock
            ? [
                {
                  id: 'stock',
                  article_id: 'article',
                  project_id: 'project',
                  project_name: summary.project_name,
                  title: '検証する記事',
                  source_type: 'text',
                  source_url: '',
                  domain: '',
                  note: '',
                  status: 'ready',
                  summary: { overview: '本文の要約', keyPoints: [], topics: [] },
                  error: null,
                  model: null,
                  is_favorite: 0,
                  created_at: summary.created_at,
                },
              ]
            : [],
          total: includeStock ? 1 : 0,
        };
      case '/api/v1/stocks/stock/question':
        return {
          questions: [
            {
              id: 'question',
              stock_id: 'stock',
              project_id: 'project',
              project_name: summary.project_name,
              source: 'user',
              text: summary.question_text,
              status: 'ready',
              error: null,
              model: null,
              is_favorite: 0,
              has_pufu: 0,
              created_at: summary.created_at,
              updated_at: summary.updated_at,
              article_title: '検証する記事',
              article_status: 'ready',
              domain: '',
            },
          ],
        };
      case '/api/v1/questions':
        return { questions: [], total: 0 };
      case '/api/v1/questions/question':
        return {
          question: {
            id: 'question',
            stock_id: null,
            project_id: 'project',
            project_name: summary.project_name,
            source: 'user',
            text: summary.question_text,
            status: 'ready',
            error: null,
            model: null,
            is_favorite: 0,
            has_pufu: 0,
            created_at: summary.created_at,
            updated_at: summary.updated_at,
            article_title: null,
            article_status: null,
            domain: null,
          },
          pufus: [summary],
        };
      case '/api/v1/memory':
        return { memory: null, pending: false, error: null };
      case '/api/v1/pufus':
        if (listError) throw new Error('一覧を取得できませんでした');
        return { pufus: total ? [summary] : [], total };
      case '/api/v1/pufus/pufu':
        return {
          pufu: {
            ...summary,
            question_id: independent ? null : summary.question_id,
            score: null,
            phases: [],
            context: {
              question: independent
                ? null
                : { id: 'question', text: summary.question_text, source: 'user' },
              task: summary.task,
              project: { id: 'project', name: summary.project_name, description: '' },
              stock: null,
              userMemory: null,
              projectMemory: null,
            },
          },
        };
      default:
        throw new Error('想定外の取得先: ' + path);
    }
  });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function render(hash = '') {
  window.location.hash = hash;
  await act(async () => root.render(createElement(App)));
}
async function hashChange() {
  await act(async () => window.dispatchEvent(new window.Event('hashchange')));
}
async function tab(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.library-tabs button')].find(
    (button) => button.textContent === label,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
  await hashChange();
}
it('サイドメニューからすべてのプ譜へ移動でき、カードに右矢印を出さない', async () => {
  await render();
  const menu = [...document.querySelectorAll<HTMLButtonElement>('.sidebar .nav-item')].find(
    (button) => button.textContent === 'すべてのプ譜',
  )!;
  expect(menu).toBeDefined();
  await act(async () => menu.click());
  await hashChange();
  expect(window.location.hash).toBe('#pufus');
  expect(menu.getAttribute('aria-current')).toBe('page');
  expect(document.querySelector('.pufu-list-item .lucide-arrow-right')).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('.pufu-list-item')!.click());
  await hashChange();
  expect(menu.getAttribute('aria-current')).toBe('page');
});
it.each(['', '#project/project'])(
  '問いの隣からプ譜一覧を開き、範囲と詳細への戻り先を保つ: %s',
  async (hash) => {
    await render(hash);
    expect(
      [...document.querySelectorAll('.library-tabs button')].map((button) => button.textContent),
    ).toEqual(
      hash
        ? ['ストック', '問い・気づき', 'プ譜', 'メモリ', '設定']
        : ['ストック', '問い・気づき', 'プ譜', 'メモリ'],
    );
    await tab('プ譜');
    expect(window.location.hash).toBe(hash ? '#pufus/project' : '#pufus');
    const request = requests.filter((url) => url.pathname === '/api/v1/pufus').at(-1)!;
    expect(request.searchParams.get('project_id')).toBe(hash ? 'project' : null);
    expect(document.querySelector('.library-tabs [aria-pressed="true"]')?.textContent).toBe('プ譜');
    const list = document.querySelector('[aria-label="保存したプ譜"]')!;
    expect(list.textContent).toContain(summary.task);
    expect(list.textContent).toContain(summary.question_text);
    expect(list.textContent).toContain('生成中');
    const item = list.querySelector<HTMLButtonElement>('.pufu-list-item')!;
    await act(async () => item.click());
    await hashChange();
    expect(window.location.hash).toBe('#pufu/pufu');
    expect(document.querySelector('.breadcrumb [aria-current="page"]')?.textContent).toBe('詳細');
    expect(document.querySelector('.pufu-page')?.textContent).toContain(summary.task);
    expect(
      document.querySelector(`.breadcrumb a[href="#pufus${hash ? '/project' : ''}"]`),
    ).not.toBeNull();
    await act(async () =>
      document.querySelector<HTMLButtonElement>('.pufu-page .back-link')!.click(),
    );
    await hashChange();
    const back = document.querySelector<HTMLButtonElement>('.question-detail-page .back-link')!;
    expect(back.textContent).toBe('プ譜の一覧に戻る');
    await act(async () => back.click());
    await hashChange();
    expect(window.location.hash).toBe(hash ? '#pufus/project' : '#pufus');
    expect(document.querySelector('[aria-label="保存したプ譜"]')?.textContent).toContain(
      summary.task,
    );
  },
);

it.each([0, 1, 3])('カードの関連は各1件だけ表示し、残り%s件の件数を正しく示す', async (count) => {
  const questions = Array.from({ length: count }, (_, index) => ({
    id: `question-${index}`,
    text: `問い${index + 1}`,
  }));
  const stocks = Array.from({ length: count }, (_, index) => ({
    id: `stock-${index}`,
    title: `記事${index + 1}`,
  }));
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, options) =>
    new URL(path, 'https://example.com').pathname === '/api/v1/pufus'
      ? { pufus: [{ ...summary, questions, stocks }], total: 1 }
      : original(path, options),
  );
  await render('#pufus');
  const card = document.querySelector('.pufu-list-item')!;
  const lines = [...card.querySelectorAll('small')].map((line) => line.textContent);
  expect(lines.filter((line) => line?.startsWith('問い・気づき：'))).toEqual(
    count ? [`問い・気づき：問い1${count > 1 ? ` (他${count - 1}件)` : ''}`] : [],
  );
  expect(lines.filter((line) => line?.startsWith('ストック：'))).toEqual(
    count ? [`ストック：記事1${count > 1 ? ` (他${count - 1}件)` : ''}`] : [],
  );
});

it('問い一覧からプ譜を開いてもヘッダーはプ譜一覧と詳細を示す', async () => {
  await render('#question/question');
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('.detail-tabs button')]
      .find((button) => button.textContent?.startsWith('プ譜'))!
      .click(),
  );
  await act(async () => document.querySelector<HTMLButtonElement>('.pufu-list-item')!.click());
  await hashChange();
  expect(document.querySelector('.breadcrumb a[href="#pufus"]')?.textContent).toBe('すべてのプ譜');
  expect(document.querySelector('.breadcrumb [aria-current="page"]')?.textContent).toBe('詳細');
});

it('問いなしのプ譜から元のプロジェクトのプ譜一覧へ戻る', async () => {
  independent = true;
  await render('#pufus/project');
  await act(async () => document.querySelector<HTMLButtonElement>('.pufu-list-item')!.click());
  await hashChange();
  const back = document.querySelector<HTMLButtonElement>('.pufu-page .back-link')!;
  expect(back.textContent).toBe('プ譜の一覧に戻る');
  await act(async () => back.click());
  await hashChange();
  expect(window.location.hash).toBe('#pufus/project');
});

it('全体のプロジェクト絞り込みをプ譜・メモリ・問いのタブ間で引き継ぐ', async () => {
  await render('#pufus');
  const select = document.querySelector<HTMLElement>('#project-scope')!;
  Object.defineProperty(select, 'value', { configurable: true, value: 'project' });
  await act(async () => select.dispatchEvent(new window.Event('change', { bubbles: true })));
  expect(
    requests
      .filter((url) => url.pathname === '/api/v1/pufus')
      .at(-1)
      ?.searchParams.get('project_id'),
  ).toBe('project');
  await tab('メモリ');
  await tab('問い・気づき');
  expect(
    requests
      .filter((url) => url.pathname === '/api/v1/questions')
      .at(-1)
      ?.searchParams.get('project_id'),
  ).toBe('project');
  await tab('プ譜');
  expect(
    requests
      .filter((url) => url.pathname === '/api/v1/pufus')
      .at(-1)
      ?.searchParams.get('project_id'),
  ).toBe('project');
});

it('取得失敗から再読み込みでき、空の一覧には作成手順を案内する', async () => {
  listError = true;
  await render('#pufus/project');
  const list = document.querySelector('[aria-label="保存したプ譜"]')!;
  expect(list.querySelector('[role="alert"]')?.textContent).toContain('一覧を取得できませんでした');
  listError = false;
  total = 0;
  await act(async () =>
    [...list.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '再読み込み')!
      .click(),
  );
  expect(list.querySelector('[role="alert"]')).toBeNull();
  expect(list.textContent).toContain('問い・気づき');
  expect(list.querySelector('.pufu-list-item')).toBeNull();
});

it('次のページを開き、プロジェクト変更時は先頭ページに戻る', async () => {
  total = 25;
  await render('#pufus');
  const next = [...document.querySelectorAll<HTMLButtonElement>('.pagination button')].find(
    (button) => button.textContent?.includes('次へ'),
  )!;
  await act(async () => next.click());
  expect(
    requests
      .filter((url) => url.pathname === '/api/v1/pufus')
      .at(-1)
      ?.searchParams.get('page'),
  ).toBe('2');
  const select = document.querySelector<HTMLElement>('#project-scope')!;
  Object.defineProperty(select, 'value', { configurable: true, value: 'project' });
  await act(async () => select.dispatchEvent(new window.Event('change', { bubbles: true })));
  expect(
    requests
      .filter((url) => url.pathname === '/api/v1/pufus')
      .at(-1)
      ?.searchParams.get('page'),
  ).toBe('1');
});

it('プ譜を見た後にストックから問いを開くと、問い一覧を戻り先にする', async () => {
  await render('#pufus');
  await act(async () => document.querySelector<HTMLButtonElement>('.pufu-list-item')!.click());
  await hashChange();
  includeStock = true;
  window.location.hash = '';
  await hashChange();
  await act(async () => document.querySelector<HTMLButtonElement>('.article-open')!.click());
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('.stock-detail .detail-tabs button')]
      .find((button) => button.textContent === '問い・気づき')!
      .click(),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.stock-detail .question-open')!.click(),
  );
  await hashChange();
  expect(document.querySelector('.breadcrumb a[href="#questions"]')).not.toBeNull();
  const back = document.querySelector<HTMLButtonElement>('.question-detail-page .back-link')!;
  expect(back.textContent).toBe('問い・気づきの一覧に戻る');
  await act(async () => back.click());
  await hashChange();
  expect(window.location.hash).toBe('#questions');
});

it.each(['#pufus', '#pufus/project'])(
  '一覧から保存先・獲得目標・補足を送信してプ譜を開く: %s',
  async (hash) => {
    independent = true;
    vi.mocked(send).mockResolvedValue({ id: 'pufu' });
    await render(hash);
    const add = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'プ譜を追加',
    );
    expect(add).toBeDefined();
    await act(async () => add!.click());
    const dialog = document.querySelector('dialog')!;
    expect(dialog.querySelector('#pufu-project')).not.toBeNull();
    for (const [selector, value] of [
      ['#pufu-task', '継続できる仕組みを作る'],
      ['#pufu-details', '人員2名。毎朝10分の振り返りを予定。'],
    ]) {
      await act(async () => {
        const field = dialog.querySelector<HTMLTextAreaElement>(selector)!;
        field.value = value;
        field.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    }
    await act(async () =>
      dialog
        .querySelector('form')!
        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(send).toHaveBeenCalledWith(
      '/api/v1/projects/project/pufus/generate',
      expect.objectContaining({
        task: '継続できる仕組みを作る',
        details: '人員2名。毎朝10分の振り返りを予定。',
        request_id: expect.any(String),
      }),
    );
    await hashChange();
    expect(window.location.hash).toBe('#pufu/pufu');
    expect(document.querySelector('dialog')).toBeNull();
  },
);

it('送信中は追加ダイアログの閉じる操作とEscapeを無効にする', async () => {
  let complete!: (value: { id: string }) => void;
  vi.mocked(send).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await render('#pufus/project');
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'プ譜を追加')!
      .click(),
  );
  const dialog = document.querySelector('dialog')!;
  await act(async () => {
    const task = dialog.querySelector<HTMLTextAreaElement>('#pufu-task')!;
    task.value = '送信中の課題';
    task.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () =>
    dialog
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(dialog.querySelector<HTMLButtonElement>('[aria-label="閉じる"]')!.disabled).toBe(true);
  await act(async () =>
    dialog.dispatchEvent(new window.Event('cancel', { bubbles: true, cancelable: true })),
  );
  expect(document.querySelector('dialog')).toBe(dialog);
  await act(async () => complete({ id: 'pufu' }));
  await hashChange();
  expect(document.querySelector('dialog')).toBeNull();
  expect(window.location.hash).toBe('#pufu/pufu');
});
