import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import ManualHelp from '../src/ManualHelp';
import { manualTree, selectManualBranch } from '../src/manual-search';
vi.mock('../src/manual-search', () => ({ manualTree: vi.fn(), selectManualBranch: vi.fn() }));
const leaf = {
  id: 'pufu-download',
  title: 'JSON・画像を保存',
  text: 'ダウンロードを押し、JSONまたは画像を選びます。',
  href: '/manual#pufu-download',
  children: [],
};
let root: Root, document: Document;
const escalate = vi.fn(),
  close = vi.fn();
beforeEach(async () => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(manualTree).mockResolvedValue([leaf, { ...leaf, id: 'other' }]);
  vi.mocked(selectManualBranch).mockResolvedValue(leaf);
  root = createRoot(document.getElementById('root')!);
  await act(async () =>
    root.render(
      createElement(ManualHelp, {
        owner: 'alice',
        language: 'ja',
        initialMessages: [],
        onBusy: () => {},
        onClose: close,
        onEscalate: escalate,
        onInvalidSession: () => {},
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const enter = async (text: string) =>
  act(async () => {
    const field = document.querySelector('textarea')!;
    field.value = text;
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
const press = async (label: string) =>
  act(async () => {
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!
      .click();
  });
it('shows actual manual text and a link, then hears the unresolved part without searching again', async () => {
  await enter('プ譜を画像で保存したい');
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(document.body.textContent).toContain(leaf.text);
  expect(
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent === '回答を表示する',
    ),
  ).toBe(false);
  expect(document.querySelector('a')?.getAttribute('href')).toBe(leaf.href);
  expect(document.body.textContent).toContain('お役に立ちましたか？');
  await press('解決しませんでした');
  expect(document.body.textContent).toContain('どの部分が解決しませんでしたか？');
  expect(selectManualBranch).toHaveBeenCalledTimes(1);
  await enter('画像を選んだ後に、どこに保存されたか分かりません');
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(escalate).toHaveBeenCalledTimes(1);
  expect(escalate.mock.calls[0][0].detail).toContain('どこに保存されたか');
  expect(escalate.mock.calls[0][0].manual_context.question).toBe('プ譜を画像で保存したい');
  expect(selectManualBranch).toHaveBeenCalledTimes(1);
});
it('can finish resolved guidance without saving an improvement report', async () => {
  await enter('ダウンロードしたい');
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  await press('解決しました');
  expect(escalate).not.toHaveBeenCalled();
  await press('会話を閉じる');
  expect(close).toHaveBeenCalledTimes(1);
});

it('keeps the beginning of a long answer concise and links to the full procedure', async () => {
  const long = {
    ...leaf,
    text: 'トップページの「Googleでログイン」を押します。Googleアカウントを選びます。初回は利用規約を確認してください。',
  };
  vi.mocked(selectManualBranch).mockResolvedValue(long);
  await enter('ログイン方法');
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  const answer = [...document.querySelectorAll('.pufi-message-pufi')].find((node) =>
    node.textContent?.startsWith('トップページ'),
  )!;
  expect(answer.textContent).toContain(
    'トップページの「Googleでログイン」を押します。Googleアカウントを選びます。…',
  );
  await press('回答を表示する');
  expect(answer.textContent).toContain(long.text);
  expect(document.querySelector('button[aria-expanded="true"]')?.textContent).toBe('折りたたむ');
  await press('折りたたむ');
  expect(answer.textContent).not.toContain('初回は利用規約を確認してください。');
  await press('回答を表示する');
  await press('解決しませんでした');
  expect(answer.textContent).toContain(long.text);
  expect(selectManualBranch).toHaveBeenCalledTimes(1);
  expect(escalate).not.toHaveBeenCalled();
  await enter('まだ解決していません');
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(escalate.mock.calls[0][1]).toContainEqual({ role: 'pufi', text: long.text });
  expect(document.querySelector('a')?.getAttribute('href')).toBe(long.href);
});
