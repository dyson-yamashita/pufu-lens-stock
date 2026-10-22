import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import PufuImagePreview from '../src/PufuImagePreview';
import { pufuScoreSchema } from '../shared/pufu';
import fixture from './fixtures/pufu-sparse.json';

let root: Root;
let document: Document;
let closedWhileAttached: boolean[];
beforeEach(async () => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  closedWhileAttached = [];
  Object.defineProperties(window.HTMLElement.prototype, {
    showModal: {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    },
    close: {
      configurable: true,
      value() {
        closedWhileAttached.push(this.isConnected);
        this.removeAttribute('open');
      },
    },
    setPointerCapture: { configurable: true, value: vi.fn() },
    getBoundingClientRect: {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    },
  });
  document.body.style.overflow = 'auto';
  root = createRoot(document.getElementById('root')!);
  await act(async () =>
    root.render(
      createElement(PufuImagePreview, {
        score: pufuScoreSchema.parse(fixture),
        phase: 1,
        onEdit: vi.fn(),
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
async function click(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
const zoom = () => document.querySelector('output[aria-label="拡大率"]')?.textContent;
async function gesture(type: string, values: Record<string, unknown>) {
  const event = Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), values);
  await act(async () => document.querySelector('.pufu-image-viewport')!.dispatchEvent(event));
  return event;
}

it('画像を押すと拡大モーダルが開き、ボタンで拡大縮小・リセットして閉じられる', async () => {
  expect(document.querySelector('dialog')).toBeNull();
  await click('第1局面のプ譜を拡大表示');
  expect(document.querySelector('dialog[open] [role="img"]')).not.toBeNull();
  expect(document.body.style.overflow).toBe('hidden');
  expect(zoom()).toBe('100%');
  await click('拡大');
  expect(zoom()).toBe('150%');
  await click('縮小');
  expect(zoom()).toBe('100%');
  await click('拡大');
  await click('全体を表示');
  expect(zoom()).toBe('100%');
  await click('閉じる');
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('auto');
  expect(closedWhileAttached).toEqual([true]);
});

it('2点の距離でピンチ拡大縮小し、指のキャンセル後もドラッグと倍率制限が機能する', async () => {
  await click('第1局面のプ譜を拡大表示');
  const pointer = (pointerId: number, clientX: number, clientY = 300) => ({
    pointerId,
    clientX,
    clientY,
    pointerType: 'touch',
    button: 0,
  });
  await gesture('pointerdown', pointer(1, 200));
  await gesture('pointerdown', pointer(2, 400));
  await gesture('pointermove', pointer(2, 600));
  expect(zoom()).toBe('200%');
  await gesture('pointermove', pointer(2, 300));
  expect(zoom()).toBe('100%');
  await gesture('pointercancel', pointer(1, 200));
  await gesture('pointercancel', pointer(2, 300));
  await click('拡大');
  const canvas = document.querySelector<HTMLElement>('.pufu-image-canvas')!;
  const original = canvas.style.transform;
  await gesture('pointerdown', pointer(3, 300));
  await gesture('pointermove', pointer(3, 350, 350));
  expect(canvas.style.transform).not.toBe(original);
  expect(zoom()).toBe('150%');
  await gesture('pointerup', pointer(3, 350, 350));
  for (let index = 0; index < 15; index++) await click('拡大');
  expect(zoom()).toBe('600%');
  expect(document.querySelector<HTMLButtonElement>('button[aria-label="拡大"]')?.disabled).toBe(
    true,
  );
  await click('全体を表示');
  expect(document.querySelector<HTMLButtonElement>('button[aria-label="縮小"]')?.disabled).toBe(
    true,
  );
});

it('キーボードとトラックパッドのピンチ操作でも拡大でき、Escapeで閉じる', async () => {
  await click('第1局面のプ譜を拡大表示');
  await gesture('keydown', { key: '+' });
  expect(zoom()).toBe('150%');
  const canvas = document.querySelector<HTMLElement>('.pufu-image-canvas')!;
  const before = canvas.style.transform;
  await gesture('keydown', { key: 'ArrowRight' });
  expect(canvas.style.transform).not.toBe(before);
  await gesture('keydown', { key: '0' });
  expect(zoom()).toBe('100%');
  const wheel = await gesture('wheel', { ctrlKey: true, deltaY: -50, clientX: 400, clientY: 300 });
  expect(wheel.defaultPrevented).toBe(true);
  expect(zoom()).not.toBe('100%');
  await act(async () =>
    document
      .querySelector('dialog')!
      .dispatchEvent(new window.Event('cancel', { cancelable: true })),
  );
  expect(document.querySelector('dialog')).toBeNull();
});
