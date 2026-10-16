import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import ScrollHeader from '../src/ScrollHeader';

let root: Root;
let document: Document;
let header: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;

beforeEach(async () => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 640 });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 2000 });
  frames = new Map();
  let frameId = 0;
  window.requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback);
    return frameId;
  };
  window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  root = createRoot(document.getElementById('root')!);
  await render(true);
  header = document.querySelector('.topbar')!;
  Object.defineProperty(header, 'offsetHeight', { value: 64 });
});

async function render(autoHide: boolean) {
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(ScrollHeader, {
          autoHide,
          children: createElement('button', null, 'メニューを開く'),
        }),
      ),
    );
  });
}

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function scroll(y: number) {
  window.scrollY = y;
  await act(async () => window.dispatchEvent(new window.Event('scroll')));
}
function expectHidden(hidden: boolean) {
  expect(header.classList.contains('is-hidden')).toBe(hidden);
}
async function frame() {
  const callbacks = [...frames.values()];
  frames.clear();
  await act(async () => callbacks.forEach((callback) => callback(0)));
}

it('記事を読み進めると隠し、上部へ戻ると表示する。ページ最上部では表示する', async () => {
  expectHidden(false);
  await scroll(40);
  expectHidden(false);
  await scroll(120);
  expectHidden(true);
  await scroll(200);
  expectHidden(true);
  await scroll(175);
  expectHidden(false);
  await scroll(190);
  expectHidden(true);
  await scroll(0);
  expectHidden(false);
});

it('小さな揺れでは表示を切り替えず、ゆっくり戻るスクロールでも表示する', async () => {
  await scroll(120);
  expectHidden(true);
  await scroll(118);
  expectHidden(true);
  await scroll(120);
  expectHidden(true);
  await scroll(114);
  expectHidden(true);
  await scroll(110);
  expectHidden(false);
  await scroll(116);
  expectHidden(false);
  await scroll(121);
  expectHidden(true);
});

it('ページ上下のバウンドを逆方向へのスクロールと誤認しない', async () => {
  await scroll(-30);
  expectHidden(false);
  await scroll(0);
  expectHidden(false);
  await scroll(1360);
  expectHidden(true);
  await scroll(1400);
  expectHidden(true);
  await scroll(1360);
  expectHidden(true);
  await scroll(1340);
  expectHidden(false);
  await scroll(0);
  await scroll(-20);
  await scroll(0);
  expectHidden(false);
});

it.each(['focus', 'navigation'])('%sの際は隠れたヘッダーを再表示する', async (mode) => {
  await scroll(120);
  expectHidden(true);
  await act(async () => {
    if (mode === 'focus') {
      header.querySelector('button')!.dispatchEvent(new window.Event('focusin', { bubbles: true }));
    } else window.dispatchEvent(new window.Event('hashchange'));
  });
  expectHidden(false);
  if (mode === 'navigation') {
    await frame();
    await scroll(400);
    expectHidden(false);
    await frame();
    await scroll(450);
    expectHidden(true);
  }
});

it('PCでは固定し、スマートフォンからPCへ幅を変更した場合も再表示する', async () => {
  await render(false);
  await scroll(120);
  await scroll(200);
  expectHidden(false);
  await render(true);
  await scroll(250);
  expectHidden(true);
  await render(false);
  expectHidden(false);
  await scroll(300);
  expectHidden(false);
  await render(true);
  expectHidden(false);
  await scroll(350);
  expectHidden(true);
});
