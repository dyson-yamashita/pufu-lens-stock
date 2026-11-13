import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import Announcements from '../src/Announcements';
import { api, ApiError } from '../src/api';
import { testAnnouncement } from './announcement-fixture';
vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  api: vi.fn(),
}));
let root: Root;
let document: Document;
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it('404では見つからない案内と一覧へ戻る導線を表示する', async () => {
  vi.mocked(api).mockRejectedValue(new ApiError('not found', 404));
  await act(async () => root.render(createElement(Announcements, { id: 'missing' })));
  expect(document.body.textContent).toContain('このお知らせは見つかりません');
  expect(document.querySelector('a')?.getAttribute('href')).toBe('#announcements');
});
it('詳細から一覧へ移動した後の遅い応答が現在の表示を上書きしない', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(createElement(Announcements, { id: 'test-news' })));
  vi.mocked(api).mockResolvedValue({
    announcements: [
      testAnnouncement(),
      {
        ...testAnnouncement(),
        id: 'second',
        ja: { ...testAnnouncement().ja, title: '次のお知らせ' },
      },
    ],
  });
  await act(async () => root.render(createElement(Announcements)));
  await act(async () => finish({ announcements: [testAnnouncement()] }));
  expect(document.body.textContent).toContain('次のお知らせ');
});
