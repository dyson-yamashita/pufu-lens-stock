import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import PublicProjectPage from '../src/PublicProjects';
import { api } from '../src/api';
import { setLanguage } from '../src/i18n';

vi.mock('../src/PublicPufuScore', () => ({
  default: ({ phase }: { phase: number }) =>
    createElement('div', { 'data-testid': 'score' }, `第${phase}局面の本文と画像`),
}));
vi.mock('../src/api', () => ({ api: vi.fn(), send: vi.fn() }));
const stock = {
  id: 'stock',
  title: 'ストックのタイトル',
  source_url: 'https://example.com/a',
  domain: 'example.com',
  created_at: '2026-10-18',
  summary: { overview: '記事の要約', keyPoints: ['詳細で確認する記事の要点'], topics: ['テーマ'] },
};
const aiQuestion = {
  id: 'ai',
  text: 'AIが生成した問い',
  source: 'ai',
  stock_id: 'stock',
  article_title: stock.title,
  created_at: '2026-10-18',
  pufu_count: 1,
};
const userQuestion = {
  ...aiQuestion,
  id: 'user',
  text: '自分の問い',
  source: 'user',
  pufu_count: 0,
};
let pufuTitle: string | null;
let root: Root;
let document: Document;
beforeEach(() => {
  pufuTitle = null;
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'location', { configurable: true, value: { hash: '#stocks' } });
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
  vi.mocked(api).mockImplementation(async (path) => {
    const url = new URL(path, 'https://example.com');
    if (url.pathname === '/api/public/projects/project')
      return {
        project: {
          public_id: 'project',
          name: '公開プロジェクト',
          public_description: '',
          stock_count: 1,
          question_count: 2,
          pufu_count: 1,
        },
      };
    if (url.pathname.endsWith('/stocks/stock'))
      return { stock, questions: [aiQuestion, userQuestion], page: 1, total: 2, has_more: false };
    if (url.pathname.endsWith('/stocks'))
      return { items: [stock], total: 1, page: 1, has_more: false };
    if (url.pathname.endsWith('/pufus/pufu'))
      return {
        pufu: {
          id: 'pufu',
          title: pufuTitle,
          task: '問いから考える課題',
          current_phase: 1,
          updated_at: '2026-10-18',
          question_id: 'ai',
          question_text: aiQuestion.text,
          questions: [aiQuestion, userQuestion],
          stocks: [
            { id: stock.id, title: stock.title },
            { id: 'second', title: '二つ目の記事' },
          ],
          score: {},
        },
      };
    if (url.pathname.endsWith('/pufus'))
      return {
        items: [
          {
            id: 'pufu',
            title: pufuTitle,
            task: '問いから考える課題',
            current_phase: 1,
            updated_at: '2026-10-18',
          },
        ],
        total: 1,
        page: 1,
        has_more: false,
      };
    if (url.pathname.endsWith('/questions/ai'))
      return {
        question: aiQuestion,
        stock,
        pufus: [
          {
            id: 'pufu',
            title: pufuTitle,
            task: '問いから考える課題',
            current_phase: 1,
            updated_at: '2026-10-18',
          },
        ],
        has_more: false,
      };
    if (url.pathname.endsWith('/questions'))
      return { items: [aiQuestion, userQuestion], total: 2, page: 1, has_more: false };
    throw new Error('想定外の取得先: ' + path);
  });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function render(hash = '#stocks') {
  window.location.hash = hash;
  await act(async () => {
    root.render(createElement(PublicProjectPage, { publicId: 'project' }));
  });
}
async function navigate(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event('hashchange'));
  });
}
it('一覧のストックは詳細へのリンクで、要点は詳細で関連する問いとともに表示する', async () => {
  await render();
  const card = document.querySelector('.public-stock-card');
  expect(card?.tagName).toBe('A');
  expect(card?.getAttribute('href')).toBe('#stock/stock');
  expect(document.body.textContent).not.toContain('要点を見る');
  expect(document.body.textContent).not.toContain('詳細で確認する記事の要点');
  expect(card?.querySelector('a,details')).toBeNull();
  await navigate('#stock/stock');
  expect(document.body.textContent).toContain('詳細で確認する記事の要点');
  expect(document.body.textContent).toContain('関連する問い・気づき');
  expect(document.querySelector('a[href="#question/ai"]')?.textContent).toContain(
    'AIが生成した問い',
  );
  expect(document.querySelector('.question-labels')?.textContent).toContain('プ譜');
  expect(document.querySelector('a[href="https://example.com/a"]')?.getAttribute('target')).toBe(
    '_blank',
  );
  expect(document.querySelectorAll('input,textarea,[contenteditable]')).toHaveLength(0);
});
it('問い一覧にはAI・プ譜のラベルを表示し、要点は問いの詳細に表示する', async () => {
  await render('#questions');
  const cards = document.querySelectorAll('.public-question-card');
  expect(cards[0].querySelector('.question-labels')?.textContent).toBe('AIプ譜');
  expect(cards[1].querySelector('.question-labels')?.textContent).toBe('ユーザー');
  expect(document.body.textContent).not.toContain('詳細で確認する記事の要点');
  expect(document.body.textContent).not.toContain('要点を見る');
  await navigate('#question/ai');
  expect(document.body.textContent).toContain('詳細で確認する記事の要点');
  expect(document.body.textContent).toContain('問いから考える課題');
  expect(document.querySelector('.question-labels')?.textContent).toBe('AIプ譜');
});
it('公開した問いの複数のストックを表示し、プ譜カードの右矢印を出さない', async () => {
  const load = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (url, options) => {
    if (url.includes('/questions/ai?'))
      return {
        question: {
          ...aiQuestion,
          stocks: [
            { id: 'stock', title: stock.title },
            { id: 'second', title: '二つ目の記事' },
          ],
        },
        stock,
        stocks: [stock, { ...stock, id: 'second', title: '二つ目の記事' }],
        pufus: [
          {
            id: 'pufu',
            title: pufuTitle,
            task: '問いから考える課題',
            current_phase: 1,
            updated_at: '2026-10-18',
          },
        ],
        has_more: false,
      };
    return load(url, options);
  });
  await render('#question/ai');
  expect(document.querySelector('a[href="#stock/second"]')?.textContent).toContain('二つ目の記事');
  expect(document.querySelector('.pufu-list-item .lucide-arrow-right')).toBeNull();
});
it.each([
  ['#stocks', '#stock/stock', 'stocks'],
  ['#questions', '#question/ai', 'questions'],
  ['#pufus', '#pufu/pufu?from=pufus', 'pufus'],
])('一覧 %s の2ページ目から詳細を開いて戻ると同じページを表示する', async (list, detail, path) => {
  const load = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (url, options) => {
    const parsed = new URL(url, 'https://example.com');
    if (parsed.pathname === `/api/public/projects/project/${path}`) {
      const page = Number(parsed.searchParams.get('page'));
      return {
        items:
          path === 'stocks'
            ? [stock]
            : path === 'pufus'
              ? [
                  {
                    id: 'pufu',
                    title: pufuTitle,
                    task: '問いから考える課題',
                    current_phase: 1,
                    updated_at: '2026-10-18',
                  },
                ]
              : [aiQuestion],
        page,
        total: 13,
        has_more: page === 1,
      };
    }
    return load(url, options);
  });
  await render(list);
  const next = document.querySelectorAll<HTMLButtonElement>('.public-pagination button')[1];
  await act(async () => next.click());
  expect(document.querySelector('.public-pagination')?.textContent).toContain('2ページ');
  await navigate(detail);
  expect(document.querySelector('.public-pagination')).toBeNull();
  await navigate(list);
  expect(document.querySelector('.public-pagination')?.textContent).toContain('2ページ');
  expect(vi.mocked(api).mock.calls.at(-1)?.[0]).toBe(`/api/public/projects/project/${path}?page=2`);
});

it('プ譜タブから一覧・詳細を閲覧し、戻るとプ譜タブへ戻る', async () => {
  await render('#pufus');
  expect(document.querySelector('.public-tabs a[aria-current="page"]')?.getAttribute('href')).toBe(
    '#pufus',
  );
  const card = document.querySelector('.public-pufu-card');
  expect(card?.textContent).toContain('問いから考える課題');
  expect(card?.textContent).toContain('第1局面');
  expect(card?.getAttribute('href')).toBe('#pufu/pufu?from=pufus');
  await navigate('#pufu/pufu?from=pufus');
  const task = document.querySelector('section[aria-label="課題"]');
  const questions = document.querySelector('details.pufu-related-questions');
  expect(task?.querySelector('h3')?.textContent).toBe('課題');
  expect(task?.querySelector('li')?.textContent).toBe('問いから考える課題');
  expect(questions?.querySelector('summary')?.textContent).toBe('関連する問い・気づき');
  expect(questions?.hasAttribute('open')).toBe(false);
  expect(questions?.querySelector('li a')?.getAttribute('href')).toBe('#question/ai');
  expect(questions?.querySelector('li a')?.textContent).toBe('AIが生成した問い');
  expect([...questions!.querySelectorAll('li a')].map((link) => link.textContent)).toEqual([
    'AIが生成した問い',
    '自分の問い',
  ]);
  const stocks = document.querySelector('details.pufu-related-stocks');
  expect(stocks?.hasAttribute('open')).toBe(false);
  expect([...stocks!.querySelectorAll('li a')].map((link) => link.getAttribute('href'))).toEqual([
    '#stock/stock',
    '#stock/second',
  ]);
  expect(stocks?.textContent).toContain('二つ目の記事');
  const back = document.querySelector('section > a.text-link');
  expect(back?.textContent).toContain('プ譜の一覧に戻る');
  expect(back?.getAttribute('href')).toBe('#pufus');
  expect(document.querySelector('.public-tabs a[aria-current="page"]')?.getAttribute('href')).toBe(
    '#pufus',
  );
  expect(document.querySelectorAll('input,textarea,[contenteditable]')).toHaveLength(0);
  await navigate('#pufus');
  expect(document.querySelector('.public-pufu-card')?.textContent).toContain('問いから考える課題');
});
it('プ譜がない場合は空の状態を表示する', async () => {
  const load = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (url, options) =>
    url.includes('/pufus?')
      ? { items: [], total: 0, page: 1, has_more: false }
      : load(url, options),
  );
  await render('#pufus');
  expect(document.querySelector('.public-pufu-card')).toBeNull();
  expect(document.querySelector('.public-message')?.textContent).toContain(
    '公開できるプ譜はまだありません',
  );
});

it.each([
  ['ja', 1, '第1局面 · プ譜'],
  ['ja', 2, '第2局面 · 振り返り'],
  ['en', 1, 'Phase 1 · Pufu'],
  ['en', 2, 'Phase 2 · Reflection'],
] as const)('renders one complete phase label for %s phase %s', async (language, phase, label) => {
  const load = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (url, options) => {
    if (new URL(url, 'https://example.com').pathname.endsWith('/pufus'))
      return {
        items: [
          { id: 'pufu', task: '保存した課題', current_phase: phase, updated_at: '2026-10-18' },
        ],
        total: 1,
        page: 1,
        has_more: false,
      };
    return load(url, options);
  });
  setLanguage(language);
  await render('#pufus');
  const card = document.querySelector('.public-pufu-card')!;
  expect(card.querySelector('h3')?.textContent).toBe('保存した課題');
  expect(card.querySelector('.public-help')?.textContent).toBe(label);
  expect(card.getAttribute('href')).toBe('#pufu/pufu?from=pufus');
});

it('公開プ譜は一覧と詳細に設定したタイトルを表示し、課題本文も保持する', async () => {
  pufuTitle = '短い公開タイトル';
  await render('#pufus');
  expect(document.querySelector('.public-pufu-card')?.textContent).toContain(pufuTitle);
  await navigate('#pufu/pufu');
  expect(document.querySelector('h2.public-detail-title')?.textContent).toBe(pufuTitle);
  expect(document.querySelector('.public-pufu-context')?.textContent).toContain(
    '問いから考える課題',
  );
});

it('公開プ譜は最新から前後の局面へ移動し、先頭・末尾の矢印と表示内容を切り替える', async () => {
  const load = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (url, options) => {
    const parsed = new URL(url, 'https://example.com');
    if (parsed.pathname.endsWith('/pufus/pufu')) {
      const result = (await load(url, options)) as { pufu: Record<string, unknown> };
      return {
        pufu: {
          ...result.pufu,
          current_phase: 3,
          phase: Number(parsed.searchParams.get('phase') ?? 3),
        },
      };
    }
    return load(url, options);
  });
  await render('#pufu/pufu?from=pufus');
  const assertPhase = (phase: number) => {
    expect(document.querySelector('.pufu-phase-number')?.textContent).toBe(`第${phase}局面`);
    expect(document.querySelector('[data-testid="score"]')?.textContent).toBe(
      `第${phase}局面の本文と画像`,
    );
    expect(Boolean(document.querySelector('button[aria-label="前の局面へ"]'))).toBe(phase > 1);
    expect(Boolean(document.querySelector('button[aria-label="次の局面へ"]'))).toBe(phase < 3);
    expect(document.querySelectorAll('input,textarea,[contenteditable]')).toHaveLength(0);
  };
  const move = async (label: string) =>
    act(async () =>
      document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(),
    );
  assertPhase(3);
  await move('前の局面へ');
  assertPhase(2);
  expect(document.querySelector('.public-pufu-context + .public-badge')?.textContent).toContain(
    '振り返り',
  );
  await move('前の局面へ');
  assertPhase(1);
  await move('次の局面へ');
  assertPhase(2);
  await move('次の局面へ');
  assertPhase(3);
  await navigate('#pufus');
  await navigate('#pufu/pufu?from=pufus');
  assertPhase(3);
});

it('個別URLを直接開くと該当のプ譜を表示し、戻り先も通常URLになる', async () => {
  window.location.pathname = '/p/project/pufus/pufu';
  window.location.search = '?from=pufus';
  await render('');
  expect(document.querySelector('section[aria-label="課題"]')?.textContent).toContain(
    '問いから考える課題',
  );
  expect(
    document.querySelector('a.text-link[href="/p/project?view=pufus"]')?.textContent,
  ).toContain('プ譜の一覧に戻る');
  expect(document.querySelector('a[href="/p/project/questions/ai"]')?.textContent).toContain(
    'AIが生成した問い',
  );
});

it.each(['stocks/stock', 'questions/ai'])(
  '個別URLのページ番号をJS起動後も維持する: %s',
  async (detail) => {
    window.location.pathname = `/p/project/${detail}`;
    window.location.search = '?page=2';
    await render('');
    expect(api).toHaveBeenCalledWith(
      `/api/public/projects/project/${detail}?page=2`,
      expect.anything(),
    );
  },
);

it('詳細のページ送りでURLを更新し、共有・再読込で同じページを参照できる', async () => {
  window.location.pathname = '/p/project/questions/ai';
  window.location.search = '?page=2';
  window.location.href = 'https://example.com/p/project/questions/ai?page=2';
  const replaceState = vi.fn();
  Object.defineProperty(window, 'history', { configurable: true, value: { replaceState } });
  await render('');
  const previous = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === '前へ',
  )!;
  await act(async () => previous.click());
  expect(replaceState).toHaveBeenCalledWith(null, '', '/p/project/questions/ai');
  expect(api).toHaveBeenCalledWith(
    '/api/public/projects/project/questions/ai?page=1',
    expect.anything(),
  );
});
