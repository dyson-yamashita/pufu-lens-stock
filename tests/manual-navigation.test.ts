import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { revealManualSection } from '../src/manual-navigation';
let target: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  const { window, document } = parseHTML(
    '<html><body><div class="manual-page"><main class="manual-main"><details><summary>外側</summary><details><summary>内側</summary><p id="manual-part" tabindex="0">手順</p></details></details></main></div></body></html>',
  );
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: 'https://pufu.test/manual/' },
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true }),
  });
  target = document.getElementById('manual-part')!;
  target.focus = vi.fn();
  target.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('opens ancestors, respects reduced motion and restores only temporary styles', () => {
  const cleanup = revealManualSection('/manual#manual-part')!;
  expect(cleanup).toBeTypeOf('function');
  expect(
    [...document.querySelectorAll('details')].every((detail) => detail.hasAttribute('open')),
  ).toBe(true);
  expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  expect(target.classList.contains('manual-target-highlight')).toBe(true);
  cleanup();
  cleanup();
  expect(target.classList.contains('manual-target-highlight')).toBe(false);
  expect(target.getAttribute('tabindex')).toBe('0');
});
it.each([
  '/en/manual#manual-part',
  'https://other.test/manual#manual-part',
  '/manual#other',
  '/manual#manual-missing',
  '/manual#%zz',
])('leaves an unavailable/different-page destination alone: %s', (href) => {
  expect(revealManualSection(href)).toBeNull();
  expect(target.focus).not.toHaveBeenCalled();
  expect(target.scrollIntoView).not.toHaveBeenCalled();
  expect(document.querySelector('details[open]')).toBeNull();
});
it('does not focus matching IDs outside the rendered manual', () => {
  document.body.appendChild(target);
  expect(revealManualSection('/manual#manual-part')).toBeNull();
  expect(target.focus).not.toHaveBeenCalled();
});
