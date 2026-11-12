import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import ManualHelp from '../src/ManualHelp';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { getManualTree } from '../src/UserManual';
import { selectManualBranch } from '../src/manual-search';
vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());
it.each(['ja', 'en'] as const)(
  'sends descendant context for %s headings and follows a login question to its actual procedure',
  async (language) => {
    const question = language === 'ja' ? 'ログイン方法' : 'How do I sign in?';
    const root = getManualTree(language);
    vi.mocked(api).mockImplementation(async (_path, options) => {
      const { choices } = JSON.parse(String(options?.body)) as {
        choices: { title: string; preview: string }[];
      };
      // A parent is recognizable by the procedure it contains, even if its title is abstract.
      const selection = choices.findIndex((choice) =>
        language === 'ja'
          ? choice.preview.includes('Googleでログイン')
          : choice.preview.includes('Sign in with Google'),
      );
      return { selection: selection < 0 ? null : selection, available: true };
    });
    const first = await selectManualBranch(
      'alice',
      question,
      root,
      language,
      new AbortController().signal,
    );
    expect(first?.id).toBe('manual-start-guide');
    const answer = await selectManualBranch(
      'alice',
      question,
      first!.children,
      language,
      new AbortController().signal,
    );
    expect(answer?.id).toBe('manual-sign-in');
    expect(answer?.children).toHaveLength(0);
    expect(answer?.text).toContain(language === 'ja' ? 'Googleでログイン' : 'Sign in with Google');
    expect(answer?.text).not.toContain(language === 'ja' ? 'プロジェクトを追加' : 'Add a project');
    for (const [, options] of vi.mocked(api).mock.calls) {
      const { choices } = JSON.parse(String(options?.body)) as { choices: { preview: string }[] };
      expect(
        choices.every((choice) => choice.preview.length > 0 && choice.preview.length <= 240),
      ).toBe(true);
    }
  },
);

it('answers the short login question with the actual procedure instead of displaying headings', async () => {
  const { window, document } = parseHTML('<html><body><main></main></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.querySelector('main')!);
  const escalate = vi.fn();
  vi.mocked(api).mockImplementation(async (_path, options) => {
    const { choices } = JSON.parse(String(options?.body)) as { choices: { preview: string }[] };
    const selection = choices.findIndex((c) => c.preview.includes('Googleでログイン'));
    return { selection: selection < 0 ? null : selection, available: true };
  });
  try {
    await act(async () =>
      root.render(
        createElement(ManualHelp, {
          owner: 'alice',
          language: 'ja',
          initialMessages: [],
          onBusy: () => {},
          onClose: () => {},
          onEscalate: escalate,
          onInvalidSession: () => {},
        }),
      ),
    );
    await act(async () => {
      const field = document.querySelector('textarea')!;
      field.value = 'ログイン方法';
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await act(async () => {
      document
        .querySelector('form')!
        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    const conversation = document.querySelector('.pufi-thread')!.textContent;
    expect(conversation).toContain('トップページの「Googleでログイン」を押し');
    expect(conversation).toContain('Googleアカウントを選びます');
    expect(conversation).toContain('お役に立ちましたか？');
    expect(conversation).not.toContain('該当する項目をお選びください');
    expect(document.querySelector('.pufi-manual-link')?.getAttribute('href')).toBe(
      '/manual#manual-sign-in',
    );
    expect(escalate).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
