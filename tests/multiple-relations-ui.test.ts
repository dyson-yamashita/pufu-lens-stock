import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import QuestionForm from '../src/QuestionForm';
import QuestionSettings from '../src/QuestionSettings';
import PufuPage from '../src/PufuPage';
import { api, send } from '../src/api';
import type { Project, QuestionDetail } from '../shared/domain';

vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));
vi.mock('../src/PufuEditor', () => ({
  default: ({
    pufu,
    onEditingStateChange,
    onSaved,
  }: {
    pufu: { revision: number };
    onEditingStateChange?: (blocked: boolean) => void;
    onSaved?: (revision: number) => void;
  }) => {
    useEffect(() => {
      onEditingStateChange?.(false);
    }, [onEditingStateChange]);
    return createElement(
      'div',
      { className: 'test-editor' },
      `editor revision ${pufu.revision}`,
      createElement('button', { onClick: () => onEditingStateChange?.(true) }, '編集を開始'),
      createElement(
        'button',
        {
          onClick: () => {
            onSaved?.(2);
            onEditingStateChange?.(false);
          },
        },
        '編集を保存して閉じる',
      ),
    );
  },
}));
const project = { id: 'project', name: '調べもの' } as Project;
const question = {
  id: 'question',
  project_id: 'project',
  project_name: '調べもの',
  stock_id: null,
  text: '問い',
  note: '',
  source: 'user',
  status: 'ready',
} as QuestionDetail;
const pufu = {
  id: 'pufu',
  question_id: 'question',
  project_id: 'project',
  task: '課題',
  status: 'ready',
  revision: 1,
  score: {},
  phases: [],
  question_ids: ['question'],
  stock_ids: ['stock-a'],
  questions: [{ id: 'question', text: '問い', source: 'user' }],
  stocks: [{ id: 'stock-a', title: '記事A' }],
  context: { question: { id: 'question', text: '問い', source: 'user' }, project, stock: null },
};
let root: Root;
let document: Document;
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.mocked(api).mockImplementation(async (path) => {
    const url = new URL(path, 'https://example.com');
    if (url.pathname === '/api/v1/stocks')
      return {
        stocks: url.searchParams.get('q')
          ? [{ id: 'stock-c', title: '記事C' }]
          : url.searchParams.get('page') === '2'
            ? [{ id: 'stock-b', title: '記事B' }]
            : [{ id: 'stock-a', title: '記事A' }],
        total: url.searchParams.get('q') ? 1 : 25,
      };
    if (url.pathname === '/api/v1/questions')
      return {
        questions: [
          { id: 'question', text: '問い' },
          { id: 'question-b', text: '別の問い' },
        ],
        total: 2,
      };
    return { pufu };
  });
  vi.mocked(send).mockResolvedValue({ question, revision: 3 });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
async function choose(id: string) {
  const checkbox = document.querySelector<HTMLInputElement>(
    `input[type="checkbox"][value="${id}"]`,
  )!;
  expect(checkbox).not.toBeNull();
  await act(async () => {
    checkbox.checked = !checkbox.checked;
    checkbox.click();
  });
}
async function submit() {
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
}

it('問い追加で検索・ページを変えても選択を保ち、複数ストックを保存する', async () => {
  await act(async () =>
    root.render(
      createElement(QuestionForm, { projects: [project], projectId: project.id, onDone: vi.fn() }),
    ),
  );
  await choose('stock-a');
  await click('次へ');
  await choose('stock-b');
  const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    search.value = 'C';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(250);
  });
  await choose('stock-c');
  expect(
    [...document.querySelectorAll<HTMLInputElement>('.relation-selected input')].filter(
      (item) => item.checked,
    ),
  ).toHaveLength(3);
  await act(async () => {
    const textarea = document.querySelector<HTMLTextAreaElement>('#question-text')!;
    textarea.value = '関連をつなぐには？';
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await submit();
  expect(send).toHaveBeenCalledWith(
    '/api/v1/questions',
    expect.objectContaining({
      stock_ids: ['stock-a', 'stock-b', 'stock-c'],
      text: '関連をつなぐには？',
    }),
  );
});

it('問いの設定で既存の関連を解除し、複数のストックを保存できる', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      createElement(QuestionSettings, {
        question: {
          ...question,
          stock_id: 'stock-old',
          stocks: [{ id: 'stock-old', title: '以前の記事' }],
          stock_ids: ['stock-old'],
        },
        projects: [project],
        disabled: false,
        onSave,
      }),
    ),
  );
  await choose('stock-old');
  await choose('stock-a');
  await click('次へ');
  await choose('stock-b');
  await submit();
  expect(onSave).toHaveBeenCalledWith({
    note: '',
    project_id: 'project',
    stock_ids: ['stock-a', 'stock-b'],
  });
});

it('問いの保存先は関連解除を保存してから変更できる', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const relatedQuestion = {
    ...question,
    stock_id: 'stock-old',
    stocks: [{ id: 'stock-old', title: '以前の記事' }],
    stock_ids: ['stock-old'],
  };
  await act(async () =>
    root.render(
      createElement(QuestionSettings, {
        question: relatedQuestion,
        projects: [project],
        disabled: false,
        onSave,
      }),
    ),
  );
  await choose('stock-old');
  expect(document.querySelector('select')!.disabled).toBe(true);
  await submit();
  await act(async () =>
    root.render(
      createElement(QuestionSettings, {
        question: { ...question, stocks: [], stock_ids: [] },
        projects: [project],
        disabled: false,
        onSave,
      }),
    ),
  );
  expect(document.querySelector('select')!.disabled).toBe(false);
});

it('プ譜の関連保存で複数の問いとストックを送り、新revisionで再表示する', async () => {
  await act(async () =>
    root.render(createElement(PufuPage, { id: 'pufu', onQuestion: vi.fn(), onGuard: vi.fn() })),
  );
  await choose('question-b');
  await click('次へ');
  await choose('stock-b');
  vi.mocked(api).mockImplementationOnce(async () => ({ pufu: { ...pufu, revision: 3 } }));
  await submit();
  expect(send).toHaveBeenCalledWith(
    '/api/v1/pufus/pufu/relations',
    {
      revision: 1,
      question_ids: ['question', 'question-b'],
      stock_ids: ['stock-a', 'stock-b'],
    },
    'PATCH',
  );
  expect(document.querySelector('.test-editor')?.textContent).toContain('editor revision 3');
});

it('プ譜編集中は関連保存を防ぎ、編集を保存した後は最新revisionで保存する', async () => {
  await act(async () =>
    root.render(createElement(PufuPage, { id: 'pufu', onQuestion: vi.fn(), onGuard: vi.fn() })),
  );
  await click('編集を開始');
  const save = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === '関連を保存',
  )!;
  expect(save).toBeDefined();
  expect(save.disabled).toBe(true);
  await submit();
  expect(send).not.toHaveBeenCalled();
  await click('編集を保存して閉じる');
  await submit();
  expect(send).toHaveBeenCalledWith(
    '/api/v1/pufus/pufu/relations',
    expect.objectContaining({ revision: 2 }),
    'PATCH',
  );
});

it('関連保存後の取得に失敗した場合は編集を止め、書き込みを繰り返さず再取得できる', async () => {
  await act(async () =>
    root.render(createElement(PufuPage, { id: 'pufu', onQuestion: vi.fn(), onGuard: vi.fn() })),
  );
  vi.mocked(api).mockRejectedValueOnce(new Error('再取得に失敗しました'));
  await submit();
  expect(document.querySelector('.pufu-relations [role="alert"]')?.textContent).toContain(
    '再取得に失敗しました',
  );
  expect(document.querySelector('.test-editor')!.parentElement!.hasAttribute('inert')).toBe(true);
  vi.mocked(api).mockResolvedValueOnce({ pufu: { ...pufu, revision: 3 } });
  await submit();
  expect(send).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.test-editor')?.textContent).toContain('editor revision 3');
  expect(document.querySelector('.test-editor')!.parentElement!.hasAttribute('inert')).toBe(false);
});
