import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import MemoryKnowledge from '../src/MemoryKnowledge';

let root: Root;
let document: Document;
const longText =
  'スクラムマスターはチーム内とチーム外の両方の視点を持つことが重要です。視点のバランスが崩れると、チームの成長や学びに悪影響を及ぼす可能性があります。外部の視点から支援の方法を見直し、チームが自分で考えられる環境を整えます。';

beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', undefined);
  vi.stubGlobal('getComputedStyle', () => ({ lineHeight: '20px' }));
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function render(text: string, height: number) {
  await act(async () => {
    root.render(
      createElement(MemoryKnowledge, { text }, createElement('button', null, '根拠記事')),
    );
  });
  const paragraph = document.querySelector('p')!;
  Object.defineProperty(paragraph, 'scrollHeight', { value: height, configurable: true });
  await act(async () => window.dispatchEvent(new window.Event('resize')));
  return paragraph;
}

it('長い知識を展開・折りたたみでき、全文と根拠記事を保持する', async () => {
  const paragraph = await render(longText, 120);
  const toggle = document.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  expect(toggle).not.toBeNull();
  expect(toggle.textContent).toBe('続きを読む');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.getAttribute('aria-controls')).toBe(paragraph.id);
  expect(paragraph.textContent).toBe(longText);

  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(toggle.textContent).toBe('閉じる');
  expect(paragraph.textContent).toBe(longText);

  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(paragraph.textContent).toBe(longText);
  expect(document.querySelector('button:not([aria-expanded])')?.textContent).toBe('根拠記事');

  await act(async () => toggle.click());
  await render('更新後の知識。', 120);
  expect(document.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe(
    'false',
  );
  await render(longText, 120);
  expect(document.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe(
    'false',
  );
});

it('3行に収まる知識には展開操作を出さず、幅の変更であふれた場合だけ表示する', async () => {
  const paragraph = await render('短い知識。', 60);
  expect(document.querySelector('button[aria-expanded]')).toBeNull();

  Object.defineProperty(paragraph, 'scrollHeight', { value: 80, configurable: true });
  await act(async () => window.dispatchEvent(new window.Event('resize')));
  expect(document.querySelector('button[aria-expanded]')?.textContent).toBe('続きを読む');

  Object.defineProperty(paragraph, 'scrollHeight', { value: 60, configurable: true });
  await act(async () => window.dispatchEvent(new window.Event('resize')));
  expect(document.querySelector('button[aria-expanded]')).toBeNull();
  expect(paragraph.textContent).toBe('短い知識。');
});
