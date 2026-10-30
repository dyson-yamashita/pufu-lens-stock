import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { ProjectPublicationSettings } from '../src/PublicProjects';
import { api, send } from '../src/api';
import type { Publication } from '../shared/public-project';

vi.mock('../src/api', () => ({ api: vi.fn(), send: vi.fn() }));
let root: Root;
let document: Document;
let publication: Publication;
let focus: ReturnType<typeof vi.fn>;
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://example.com' },
  });
  focus = vi.fn();
  // LinkeDOMにないブラウザのdialog・フォーカスAPIだけを補う。
  Object.defineProperties(window.HTMLElement.prototype, {
    showModal: { configurable: true, value() {} },
    close: { configurable: true, value() {} },
    focus: { configurable: true, value: focus },
  });
  publication = {
    is_public: false,
    public_id: null,
    public_description: '公開用の紹介文',
    published_at: null,
  };
  vi.mocked(api).mockImplementation(async () => ({ publication }));
  vi.mocked(send).mockImplementation(async (_path, body) => {
    publication = {
      ...publication,
      ...(body as { is_public: boolean; public_description: string }),
      public_id: 'public-project',
    };
    return { publication };
  });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
async function render() {
  await act(async () =>
    root.render(createElement(ProjectPublicationSettings, { projectId: 'project' })),
  );
}
function button(text: string, container: Pick<Document, 'querySelectorAll'> = document) {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === text,
  );
  expect(found, `ボタン: ${text}`).toBeDefined();
  return found!;
}
async function toggle(checkbox: HTMLInputElement) {
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
function dialog() {
  const found = document.querySelector<HTMLDialogElement>('dialog');
  expect(found).not.toBeNull();
  return found!;
}
async function confirmAll() {
  for (const checkbox of dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    await toggle(checkbox);
}
async function startPublishing() {
  await toggle(document.querySelector<HTMLInputElement>('[role="switch"]')!);
  await submit();
  return dialog();
}

it('公開への変更は3項目すべてを確認してOKを押した後だけ保存する', async () => {
  await render();
  const confirmation = await startPublishing();
  const checks = [...confirmation.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(checks).toHaveLength(3);
  expect(confirmation.textContent).toContain('個人情報');
  expect(confirmation.textContent).toContain('著作権');
  expect(confirmation.textContent).toContain('トップページ');
  expect(focus.mock.contexts.at(-1)).toBe(button('キャンセル', confirmation));
  expect(document.querySelector('.form-actions .public-help')?.textContent).toContain('非公開');
  expect(send).not.toHaveBeenCalled();
  for (const [index, check] of checks.entries()) {
    expect(button('OK', confirmation).disabled).toBe(true);
    await act(async () => button('OK', confirmation).click());
    expect(send).not.toHaveBeenCalled();
    await toggle(check);
    expect(button('OK', confirmation).disabled).toBe(index < 2);
  }
  await toggle(checks[0]);
  expect(button('OK', confirmation).disabled).toBe(true);
  await toggle(checks[0]);
  expect(send).not.toHaveBeenCalled();
  await act(async () => button('OK', confirmation).click());
  expect(send).toHaveBeenCalledExactlyOnceWith(
    '/api/v1/projects/project/publication',
    { is_public: true, public_description: '公開用の紹介文' },
    'PATCH',
  );
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.querySelector('.publication-url input')?.getAttribute('value')).toBe(
    'https://example.com/p/public-project',
  );
  expect(document.querySelector('[role="status"]')?.textContent).toContain('保存しました');
});

it.each(['キャンセル', 'Escape'])(
  '%sでは保存せず、再表示時はチェックをリセットする',
  async (action) => {
    await render();
    const confirmation = await startPublishing();
    await confirmAll();
    if (action === 'キャンセル') {
      await act(async () => button('キャンセル', confirmation).click());
    } else {
      const parentCancel = vi.fn();
      document.body.addEventListener('cancel', parentCancel);
      await act(async () =>
        confirmation.dispatchEvent(new window.Event('cancel', { bubbles: true, cancelable: true })),
      );
      expect(parentCancel).not.toHaveBeenCalled();
    }
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
    expect(focus.mock.contexts.at(-1)).toBe(button('公開設定を保存'));
    expect(document.querySelector('textarea')?.value).toBe('公開用の紹介文');
    await submit();
    expect(button('OK', dialog()).disabled).toBe(true);
    expect(
      [...dialog().querySelectorAll<HTMLInputElement>('input')].every((check) => !check.checked),
    ).toBe(true);
  },
);

it('公開の保存に失敗したら確認内に表示し、再試行中は連打やキャンセルを防ぐ', async () => {
  await render();
  const confirmation = await startPublishing();
  await confirmAll();
  vi.mocked(send).mockRejectedValueOnce(new Error('通信に失敗しました。'));
  await act(async () => button('OK', confirmation).click());
  expect(confirmation.querySelector('[role="alert"]')?.textContent).toContain(
    '通信に失敗しました。',
  );
  expect(document.querySelector('.publication-url')).toBeNull();
  let finish!: (value: { publication: Publication }) => void;
  vi.mocked(send).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => {
    button('OK', confirmation).click();
    button('OK', confirmation).click();
  });
  expect(send).toHaveBeenCalledTimes(2);
  expect(button('キャンセル', confirmation).disabled).toBe(true);
  expect(button('保存中…', confirmation).disabled).toBe(true);
  await act(async () =>
    confirmation.dispatchEvent(new window.Event('cancel', { cancelable: true })),
  );
  expect(document.querySelector('dialog')).toBe(confirmation);
  await act(async () =>
    finish({ publication: { ...publication, is_public: true, public_id: 'public-project' } }),
  );
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.querySelector('.publication-url')).not.toBeNull();
});

it.each([false, true])(
  '公開状態を変えない紹介文の保存は確認を挟まない（公開=%s）',
  async (isPublic) => {
    publication.is_public = isPublic;
    publication.public_id = isPublic ? 'public-project' : null;
    await render();
    await submit();
    expect(document.querySelector('dialog')).toBeNull();
    expect(send).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/projects/project/publication',
      { is_public: isPublic, public_description: '公開用の紹介文' },
      'PATCH',
    );
  },
);

it('非公開への変更はすぐ保存し、再公開するときは改めて確認する', async () => {
  publication.is_public = true;
  publication.public_id = 'public-project';
  await render();
  await toggle(document.querySelector<HTMLInputElement>('[role="switch"]')!);
  await submit();
  expect(document.querySelector('dialog')).toBeNull();
  expect(send).toHaveBeenCalledExactlyOnceWith(
    '/api/v1/projects/project/publication',
    { is_public: false, public_description: '公開用の紹介文' },
    'PATCH',
  );
  expect(document.querySelector('.publication-url')).toBeNull();
  await startPublishing();
  expect(button('OK', dialog()).disabled).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});
