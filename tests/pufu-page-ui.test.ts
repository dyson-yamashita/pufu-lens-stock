import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import PufuPage from '../src/PufuPage';
import { api } from '../src/api';
import { elementKeys, type Pufu, type PufuScore } from '../shared/pufu';

vi.mock('../src/api', () => ({ api: vi.fn(), send: vi.fn() }));
vi.mock('../src/PufuEditor', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});

const node = (uuid: string) => ({
  uuid,
  text: uuid,
  comment: { color: 'green' as const, text: '' },
});
const score: PufuScore = {
  gainingGoal: node('goal'),
  winCondition: node('win'),
  purposes: [],
  elements: Object.fromEntries(elementKeys.map((key) => [key, node(key)])) as PufuScore['elements'],
};
const pufu: Pufu = {
  id: 'pufu',
  question_id: 'question',
  project_id: 'project',
  task: '作成した課題',
  status: 'ready',
  error: null,
  model: 'test',
  editor_version: '0.9.14',
  revision: 1,
  current_phase: 1,
  generation: 1,
  created_at: '2026-10-16T00:00:00.000Z',
  updated_at: '2026-10-16T00:00:00.000Z',
  score,
  phases: [
    {
      number: 1,
      score,
      created_at: '2026-10-16T00:00:00.000Z',
      updated_at: '2026-10-16T00:00:00.000Z',
    },
  ],
  context: {
    question: { id: 'question', text: '保存した問い', source: 'user' },
    task: '作成した課題',
    project: { id: 'project', name: 'プロジェクト', description: '' },
    stock: null,
    userMemory: null,
    projectMemory: null,
  },
};
let root: Root;
let document: Document;
let stored: Map<string, string>;
let reload: ReturnType<typeof vi.fn>;
let online: boolean;
const href = 'https://lens.example.com/#pufu/pufu';

beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  stored = new Map();
  reload = vi.fn();
  online = true;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', {
    get onLine() {
      return online;
    },
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'location', { configurable: true, value: { href, reload } });
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
  vi.mocked(api).mockResolvedValue({ pufu });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function render() {
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          'div',
          null,
          'アプリのメニュー',
          createElement(PufuPage, {
            id: 'pufu',
            onQuestion: vi.fn(),
            onGuard: vi.fn(),
          }),
        ),
      ),
    );
  });
}

it('エディター取得失敗でも画面と保存済みの文脈を残し、自動再読み込みは1回だけ行う', async () => {
  await render();
  expect(document.body.textContent).toContain('アプリのメニュー');
  expect(document.querySelector('h1')?.textContent).toBe('プ譜');
  expect(document.body.textContent).toContain('保存した問い');
  expect(document.body.textContent).toContain('作成した課題');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'エディターを読み込めませんでした',
  );
  expect(reload).toHaveBeenCalledTimes(1);
});

it('問いなしのプ譜でも課題を表示し、プ譜一覧への戻り先を用意する', async () => {
  vi.mocked(api).mockResolvedValue({
    pufu: { ...pufu, question_id: null, context: { ...pufu.context, question: null } },
  });
  await render();
  expect(document.body.textContent).toContain('作成した課題');
  expect(document.querySelector('.back-link')?.textContent).toContain('プ譜の一覧に戻る');
  expect(document.querySelector('.pufu-context-questions')).toBeNull();
});

it('問い・気づきはラベル1つの下に全件を箇条書きで表示する', async () => {
  const questions = [
    { id: 'question', text: '保存した問い' },
    { id: 'question-2', text: '別の気づき' },
    { id: 'question-3', text: '3つ目の問い' },
  ];
  vi.mocked(api).mockResolvedValue({ pufu: { ...pufu, questions } });
  await render();
  const context = document.querySelector('.pufu-context')!;
  expect(
    [...context.querySelectorAll('.pufu-context-label')].filter(
      (label) => label.textContent === '問い・気づき',
    ),
  ).toHaveLength(1);
  expect(
    [...context.querySelectorAll('.pufu-context-questions li')].map((li) => li.textContent),
  ).toEqual(questions.map((question) => question.text));
});

it('再読み込み後も失敗した場合はループせず、画面のボタンから再試行できる', async () => {
  await render();
  expect(reload).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  root = createRoot(document.getElementById('root')!);
  reload.mockClear();
  await render();
  expect(reload).not.toHaveBeenCalled();
  const button = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === '画面を再読み込み',
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
  expect(reload).toHaveBeenCalledTimes(1);
});

it.each(['offline', 'unavailable-storage'])(
  '自動復帰できない環境でも画面に再読み込み操作を表示する: %s',
  async (mode) => {
    if (mode === 'offline') online = false;
    else
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        get() {
          throw new Error('Storage is unavailable');
        },
      });
    await render();
    expect(reload).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('画面を再読み込み');
  },
);
