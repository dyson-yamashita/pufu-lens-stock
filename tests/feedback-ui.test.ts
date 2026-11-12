import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import PufiFeedback from '../src/PufiFeedback';
import { FeedbackDetector } from '../src/feedback-detector';
import { api, send } from '../src/api';

vi.mock('../src/api', () => ({
  api: vi.fn(),
  send: vi.fn(),
  createRequestId: () => crypto.randomUUID(),
}));
let root: Root;
let document: Document;
let detector: FeedbackDetector;
let local: Map<string, string>;
const storage = (values: Map<string, string>) => ({
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api).mockResolvedValue({ user: { id: 'alice' } });
  vi.mocked(send).mockResolvedValue({ received: true, round: 0, follow_up: null, pending: false });
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  local = new Map([['pufi-detection-consent', 'true']]);
  vi.stubGlobal('localStorage', storage(local));
  vi.stubGlobal('sessionStorage', storage(new Map()));
  detector = new FeedbackDetector();
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const render = async (blocked = false) =>
  act(async () => {
    root.render(createElement(PufiFeedback, { detector, host: null, blocked }));
  });
const advance = async () =>
  act(async () => {
    vi.advanceTimersByTime(4000);
  });
const clicks = () => {
  for (let i = 0; i < 4; i++) detector.click('save');
};

it('displays a gentle prompt after unacknowledged clicks and dismisses it for seven days without sending logs', async () => {
  await render();
  clicks();
  await advance();
  expect(document.querySelector('.pufi-panel')?.textContent).toContain('ちょっと困った？');
  expect(send).not.toHaveBeenCalled();
  await act(async () =>
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent === '大丈夫')!
      .click(),
  );
  expect(Number(local.get('pufi-until')) - Date.now()).toBe(7 * 86400000);
  clicks();
  await advance();
  expect(document.querySelector('.pufi-panel')).toBeNull();
});

it('suppresses automatic prompts while busy or focused in an input, then waits until the user is free', async () => {
  await render(true);
  clicks();
  await advance();
  expect(document.querySelector('.pufi-panel')).toBeNull();
  const input = document.createElement('textarea');
  document.body.appendChild(input);
  Object.defineProperty(document, 'activeElement', { configurable: true, value: input });
  await render();
  await advance();
  expect(document.querySelector('.pufi-panel')).toBeNull();
  Object.defineProperty(document, 'activeElement', { configurable: true, value: null });
  await advance();
  expect(document.querySelector('.pufi-panel')?.textContent).toContain('ちょっと困った？');
});

it('starts with detection off without consent and reacts to opt-out in another tab', async () => {
  local.clear();
  await render();
  clicks();
  await advance();
  expect(document.querySelector('.pufi-panel')).toBeNull();
  const enable = new window.Event('storage');
  Object.assign(enable, { key: 'pufi-detection-consent', newValue: 'true' });
  await act(async () => window.dispatchEvent(enable));
  clicks();
  await advance();
  expect(document.querySelector('.pufi-panel')).not.toBeNull();
  const disable = new window.Event('storage');
  Object.assign(disable, { key: 'pufi-detection-consent', newValue: 'false' });
  await act(async () => window.dispatchEvent(disable));
  expect(document.querySelector('.pufi-panel')).toBeNull();
  clicks();
  await advance();
  expect(document.querySelector('.pufi-panel')).toBeNull();
});
