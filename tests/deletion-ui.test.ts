import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import App from '../src/App';
import QuestionPage from '../src/QuestionPage';
import PufuPage from '../src/PufuPage';
import XIntegration from '../src/XIntegration';
import { api, send } from '../src/api';
import type { Project, Question, Stock } from '../shared/domain';

vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));
const project: Project = {
  id: 'project',
  name: '調査プロジェクト',
  description: '',
  show_in_all_lists: true,
  include_in_user_memory: true,
  auto_generate_questions: true,
  count: 1,
  ready_count: 1,
  question_count: 1,
  pufu_count: 0,
  created_at: '2026-10-24',
};
const stock: Stock = {
  id: 'stock',
  article_id: 'article',
  project_id: project.id,
  project_name: project.name,
  title: '調べている記事',
  source_type: 'text',
  source_url: '',
  domain: '',
  note: '未編集のメモ',
  status: 'ready',
  summary: null,
  error: null,
  model: null,
  is_favorite: 0,
  created_at: '2026-10-24T00:00:00Z',
};
let question: Question;
let root: Root;
let document: Document;
let focus: ReturnType<typeof vi.fn>;
let deleteRequest: (path: string) => Promise<unknown>;
const onDeleted = vi.fn();
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // LinkeDOMにないネイティブdialog・フォーカスAPIの境界だけを補う。
  focus = vi.fn();
  Object.defineProperties(window.HTMLElement.prototype, {
    showModal: { configurable: true, value() {} },
    close: { configurable: true, value() {} },
    focus: { configurable: true, value: focus },
  });
  Object.defineProperties(window, {
    location: { configurable: true, value: { hash: '', pathname: '/', search: '' } },
    matchMedia: {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
    scrollTo: { configurable: true, value: vi.fn() },
    requestAnimationFrame: { configurable: true, value: () => 0 },
    cancelAnimationFrame: { configurable: true, value: vi.fn() },
  });
  const theme = { preference: 'dark' as const, theme: 'dark' as const };
  window.pufuTheme = { getSnapshot: () => theme, subscribe: () => () => {}, setPreference() {} };
  question = {
    id: 'question',
    text: '何を検証する？',
    stock_id: null,
    project_id: project.id,
    project_name: project.name,
    article_title: null,
    article_status: null,
    domain: null,
    source: 'user',
    status: 'ready',
    is_favorite: 0,
    has_pufu: 0,
    model: null,
    error: null,
    created_at: '2026-10-24',
    updated_at: '2026-10-24',
  };
  deleteRequest = async () => ({ ok: true });
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (options?.method === 'DELETE') return deleteRequest(path);
    const url = new URL(path, 'https://example.com');
    switch (url.pathname) {
      case '/api/config':
        return { demo: false, googleConfigured: true, aiEnabled: false, aiModel: null };
      case '/api/v1/me':
        return {
          user: {
            id: 'user',
            name: '利用者',
            onboarding_completed_at: '2026-10-30T00:00:00Z',
            bio: '',
            avatar_url: null,
          },
        };
      case '/api/v1/projects':
        return { projects: [project] };
      case '/api/v1/projects/project/publication':
        return { publication: { is_public: false, public_id: null, public_description: '' } };
      case '/api/v1/memory':
        return { memory: null, pending: false, error: null };
      case '/api/v1/stocks':
        return { stocks: [stock], total: 1 };
      case '/api/v1/stocks/stock':
        return { stock };
      case '/api/v1/questions/question':
        return { question, pufus: [] };
      case '/api/v1/pufus/pufu':
        return {
          pufu: {
            id: 'pufu',
            task: '検証を進める',
            status: 'failed',
            context: { project, question: null, stock: null },
            is_favorite: 0,
          },
        };
      case '/api/v1/comments':
        return { comments: [], has_more: false };
      case '/api/v1/integrations/x':
        return { configured: true, available: true };
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
type Screen = 'project' | 'stock' | 'question' | 'pufu' | 'x';
async function render(screen: Screen) {
  if (screen === 'project') window.location.hash = '#settings/project';
  await act(async () =>
    root.render(
      screen === 'pufu'
        ? createElement(PufuPage, {
            id: 'pufu',
            onQuestion() {},
            onBack() {},
            onGuard() {},
            onDeleted,
          })
        : screen === 'x'
          ? createElement(XIntegration)
          : screen === 'question'
            ? createElement(QuestionPage, {
                id: 'question',
                resolve: false,
                projects: [project],
                onUpdated() {},
                onBack() {},
                onResolve() {},
                onPufu() {},
                onStock: async () => {},
                onDeleted,
              })
            : createElement(App),
    ),
  );
  if (screen === 'stock')
    await act(async () => document.querySelector<HTMLButtonElement>('.article-open')!.click());
}
function button(text: string, container: Pick<Document, 'querySelectorAll'> = document) {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === text,
  );
  expect(found, `ボタン: ${text}`).toBeDefined();
  return found!;
}
function deletes() {
  return vi.mocked(api).mock.calls.filter(([, options]) => options?.method === 'DELETE');
}
async function openConfirmation(label: string) {
  const trigger = button(label);
  const disclosure = trigger.closest('details');
  expect(disclosure).not.toBeNull();
  expect(disclosure!.hasAttribute('open')).toBe(false);
  expect(trigger.closest('form')).toBeNull();
  disclosure!.setAttribute('open', '');
  await act(async () => trigger.click());
  const dialog = document.querySelector<HTMLDialogElement>('dialog.delete-confirmation');
  expect(dialog).not.toBeNull();
  return dialog!;
}

it.each([
  ['project', 'プロジェクトを削除', '/api/v1/projects/project', '調査プロジェクト'],
  ['stock', 'このストックを削除', '/api/v1/stocks/stock', '調べている記事'],
  ['question', '問い・気づきを削除', '/api/v1/questions/question', '何を検証する？'],
  ['pufu', 'プ譜を削除', '/api/v1/pufus/pufu', '検証を進める'],
  ['x', 'Xの認証情報を削除', '/api/v1/integrations/x', 'X'],
] as const)(
  '%s: 削除を通常操作から分離し、対象の確認後だけDELETEを送る',
  async (screen, label, path, target) => {
    await render(screen);
    if (screen === 'stock') {
      await act(async () => button('メモ・保存先').click());
      document.querySelector<HTMLTextAreaElement>('#edit-note')!.value = '編集中のメモ';
    }
    const dialog = await openConfirmation(label);
    expect(dialog.textContent).toContain(target);
    expect(focus.mock.contexts.at(-1)).toBe(button('キャンセル', dialog));
    expect(deletes()).toHaveLength(0);
    await act(async () => button('キャンセル', dialog).click());
    expect(document.querySelector('.delete-confirmation')).toBeNull();
    expect(deletes()).toHaveLength(0);
    if (screen === 'stock')
      expect(document.querySelector<HTMLTextAreaElement>('#edit-note')!.value).toBe('編集中のメモ');
    if (screen === 'project') {
      const controls = document.querySelector('.project-settings')!;
      expect(controls.lastElementChild?.querySelector('summary')?.textContent).toBe(
        'プロジェクトの削除',
      );
    }
    await act(async () => button(label).click());
    await act(async () => button(label, document.querySelector('.delete-confirmation')!).click());
    expect(deletes()).toEqual([[path, { method: 'DELETE' }]]);
    expect(send).not.toHaveBeenCalled();
    if (screen === 'question' || screen === 'pufu') expect(onDeleted).toHaveBeenCalledOnce();
  },
);

it('削除失敗は確認内に表示し、再試行中の連打・Escapeを防いで成功後に閉じる', async () => {
  await render('x');
  let attempts = 0;
  let finish!: () => void;
  deleteRequest = async () => {
    if (++attempts === 1) throw new Error('通信に失敗しました。');
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { ok: true };
  };
  const dialog = await openConfirmation('Xの認証情報を削除');
  await act(async () => button('Xの認証情報を削除', dialog).click());
  expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('通信に失敗しました。');
  await act(async () => {
    const confirm = button('Xの認証情報を削除', dialog);
    confirm.click();
    confirm.click();
  });
  expect(attempts).toBe(2);
  expect(button('キャンセル', dialog).disabled).toBe(true);
  expect(button('削除中…', dialog).disabled).toBe(true);
  await act(async () => dialog.dispatchEvent(new window.Event('cancel', { cancelable: true })));
  expect(document.querySelector('.delete-confirmation')).toBe(dialog);
  await act(async () => finish());
  expect(document.querySelector('.delete-confirmation')).toBeNull();
  expect(document.body.textContent).toContain('Xの認証情報を削除しました。');
});

it('本文がまだない生成待ちの問い・気づきも、削除対象と関連データの影響を確認できる', async () => {
  question.text = null;
  question.status = 'queued';
  await render('question');
  const dialog = await openConfirmation('問い・気づきを削除');
  expect(dialog.textContent).toContain('生成待ちの問い・気づき');
  expect(dialog.textContent).toContain('プ譜');
  expect(dialog.textContent).toContain('コメント');
  expect(deletes()).toHaveLength(0);
});

it('ストック内の削除確認をEscapeで閉じても、親の詳細と編集中のメモは閉じない', async () => {
  await render('stock');
  await act(async () => button('メモ・保存先').click());
  const note = document.querySelector<HTMLTextAreaElement>('#edit-note')!;
  note.value = '書きかけ';
  const dialog = await openConfirmation('このストックを削除');
  await act(async () =>
    dialog.dispatchEvent(new window.Event('cancel', { cancelable: true, bubbles: true })),
  );
  expect(document.querySelector('.delete-confirmation')).toBeNull();
  expect(document.querySelector('#edit-note')).toBe(note);
  expect(note.value).toBe('書きかけ');
  expect(deletes()).toHaveLength(0);
});

it('問い・気づきのメモ保存中は削除を無効にし、保存後は最新の保存先を確認する', async () => {
  await render('question');
  await act(async () => button('メモ・保存先').click());
  await act(async () => {
    const note = document.querySelector<HTMLTextAreaElement>('#question-note')!;
    note.value = '保存中のメモ';
    note.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  let finish!: (value: unknown) => void;
  vi.mocked(send).mockReturnValueOnce(
    new Promise((done) => {
      finish = done;
    }),
  );
  await act(async () =>
    document
      .querySelector('#question-note')!
      .closest('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(send).toHaveBeenCalledWith(
    '/api/v1/questions/question',
    { note: '保存中のメモ', project_id: project.id, stock_ids: [] },
    'PATCH',
  );
  expect(button('問い・気づきを削除').disabled).toBe(true);
  expect(deletes()).toHaveLength(0);
  await act(async () =>
    finish({
      question: { ...question, note: '保存中のメモ', project_name: '更新後の保存先' },
    }),
  );
  expect(button('問い・気づきを削除').disabled).toBe(false);
  const dialog = await openConfirmation('問い・気づきを削除');
  expect(dialog.textContent).toContain('更新後の保存先');
  await act(async () => button('キャンセル', dialog).click());
  expect(document.querySelector<HTMLTextAreaElement>('#question-note')!.value).toBe('保存中のメモ');
  expect(deletes()).toHaveLength(0);
});
