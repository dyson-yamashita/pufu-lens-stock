import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import ProfileUsage from '../src/ProfileUsage';
import { api } from '../src/api';
import { setLanguage } from '../src/i18n';
import type { ProfileUsage as Usage } from '../shared/profile-usage';

vi.mock('../src/api', () => ({ api: vi.fn() }));
let root: Root;
let document: Document;
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!);
  setLanguage('ja');
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('通信失敗を0件と表示せず、再読み込み後に選択中の期間を表示する', async () => {
  let resolve!: (usage: Usage) => void;
  vi.mocked(api)
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(
      () =>
        new Promise<Usage>((done) => {
          resolve = done;
        }),
    );
  await act(async () => root.render(createElement(ProfileUsage, { userId: 'alice' })));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    '利用状況を取得できませんでした。',
  );
  expect(document.querySelector('.usage-metrics')).toBeNull();
  const month = document.querySelector<HTMLInputElement>('input[value="month"]')!;
  await act(async () => {
    month.dispatchEvent(new window.Event('click', { bubbles: true }));
    document.querySelector('button')!.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(document.querySelector('.usage-metrics')).toBeNull();
  const counts = {
    stocks: 1200,
    questions: 30,
    pufus: 5,
    ai_neurons: 21.234567,
    ai_unmeasured_calls: 0,
  };
  await act(async () =>
    resolve({
      timezone: 'Asia/Tokyo',
      as_of: '2026-11-12T03:00:00.000Z',
      periods: {
        week: {
          since: '2026-11-08T15:00:00.000Z',
          stocks: 0,
          questions: 0,
          pufus: 0,
          ai_neurons: 0,
          ai_unmeasured_calls: 0,
        },
        month: { since: '2026-10-31T15:00:00.000Z', ...counts },
        all: { since: null, ...counts },
      },
    }),
  );
  expect(document.querySelector('[data-metric="stocks"] strong')?.textContent).toBe('1,200');
  expect(document.querySelector('[data-metric="ai_neurons"] dd')?.textContent).toBe('21Neurons');
  expect(document.querySelector('.usage-range')?.textContent).toContain('2026/11/1');
});

it.each([
  [0, 1, '未計測', ''],
  [0.00001, 0, '0', 'Neurons'],
  [695.078, 1, '695', 'Neurons'],
  [695.5, 0, '696', 'Neurons'],
  [999.5, 0, '1,000', 'Neurons'],
])(
  '未計測と四捨五入した整数を表示する: %s Neurons, 未計測%s回',
  async (neurons, missing, value, unit) => {
    const counts = {
      since: null,
      stocks: 0,
      questions: 0,
      pufus: 0,
      ai_neurons: neurons,
      ai_unmeasured_calls: missing,
    };
    vi.mocked(api).mockResolvedValue({
      timezone: 'Asia/Tokyo',
      as_of: '2026-11-12T03:00:00Z',
      periods: { week: counts, month: counts, all: counts },
    });
    await act(async () => root.render(createElement(ProfileUsage, { userId: 'alice' })));
    expect(document.querySelector('[data-metric="ai_neurons"] strong')?.textContent).toBe(value);
    expect(document.querySelector('[data-metric="ai_neurons"] span')?.textContent ?? '').toBe(unit);
  },
);
