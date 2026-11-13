import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import PushSettings from '../src/PushSettings';
import { api, send } from '../src/api';

vi.mock('../src/api', () => ({ api: vi.fn(), send: vi.fn() }));
let root: Root;
let document: Document;
const permission = vi.fn();
const unsubscribe = vi.fn();
const subscribe = vi.fn();
const register = vi.fn();
let subscription: { endpoint: string; unsubscribe: typeof unsubscribe } | null;
let serverSubscribed = false;
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  Object.assign(dom.window, {
    isSecureContext: true,
    PushManager: function () {},
    Notification: { permission: 'default', requestPermission: permission },
  });
  const registration = { pushManager: { getSubscription: async () => subscription, subscribe } };
  register.mockResolvedValue(registration);
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: async () => registration,
      register,
      ready: Promise.resolve(registration),
    },
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(api).mockResolvedValue({ available: true, publicKey: 'AQ' });
  vi.mocked(send).mockImplementation(async (path, _body, method) => {
    if (path.endsWith('/status')) return { subscribed: serverSubscribed } as never;
    if (method === 'DELETE') serverSubscribed = false;
    return { ok: true } as never;
  });
  subscription = null;
  serverSubscribed = false;
  permission.mockImplementation(async () => {
    Object.assign(Notification, { permission: 'denied' });
    return 'denied';
  });
  unsubscribe.mockResolvedValue(true);
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
const render = () => act(async () => root.render(createElement(PushSettings)));
const toggle = () => document.querySelector<HTMLButtonElement>('[role="switch"]')!;
const click = () => act(async () => toggle().click());
it('表示だけでは許可を要求せず、明示操作で拒否された時は設定の案内を表示する', async () => {
  await render();
  expect(permission).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
  expect(toggle().getAttribute('aria-checked')).toBe('false');
  await click();
  expect(permission).toHaveBeenCalledTimes(1);
  expect(register).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('ブラウザーの設定で通知を許可してください');
  expect(document.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
});
it('解除失敗では受信中の表示を保ち、成功した時はサーバー解除後にブラウザー購読を解除する', async () => {
  subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', unsubscribe };
  serverSubscribed = true;
  Object.assign(Notification, { permission: 'granted' });
  await render();
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  vi.mocked(send).mockRejectedValueOnce(new Error('offline'));
  await click();
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await click();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(serverSubscribed).toBe(false);
  expect(toggle().getAttribute('aria-checked')).toBe('false');
});
it('管理者未設定ではスイッチを無効にし、詳細説明は折りたたむ', async () => {
  vi.mocked(api).mockResolvedValue({ available: false, publicKey: null });
  await render();
  expect(document.body.textContent).toContain('準備中');
  expect(toggle().disabled).toBe(true);
  expect(toggle().getAttribute('aria-checked')).toBe('false');
  expect(document.querySelector('details')?.hasAttribute('open')).toBe(false);
  expect(permission).not.toHaveBeenCalled();
});
