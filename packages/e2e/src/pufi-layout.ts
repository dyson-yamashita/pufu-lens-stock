import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';

// A reduced layout viewport checks scrolling with limited vertical space;
// it does not emulate an iOS software keyboard or Safari's focus zoom.
export async function checkPufiCompose(browser: Browser) {
  const original = await browser.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const input = browser.locator('.pufi-compose textarea');
  const draft = await browser.evaluate(
    () => document.querySelector<HTMLTextAreaElement>('.pufi-compose textarea')!.value,
  );
  try {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
      { width: 320, height: 360 },
    ]) {
      await browser.setViewport(viewport);
      await input.fill(
        '入力した文章が送信ボタンに隠れず、最後まで読めます。English text.\n'.repeat(12),
      );
      await input.click();
      const layout = await browser.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.pufi-panel')!;
        const input = document.querySelector<HTMLTextAreaElement>('.pufi-compose textarea')!;
        const send = document.querySelector<HTMLElement>('.pufi-send')!;
        const p = panel.getBoundingClientRect();
        const t = input.getBoundingClientRect();
        const b = send.getBoundingClientRect();
        const style = getComputedStyle(input);
        const panelStyle = getComputedStyle(panel);
        return {
          fullWidth:
            Math.abs(
              t.width -
                (panel.clientWidth -
                  parseFloat(panelStyle.paddingLeft) -
                  parseFloat(panelStyle.paddingRight)),
            ) < 1,
          buttonInside:
            b.left >= t.left && b.right <= t.right && b.top >= t.top && b.bottom <= t.bottom,
          textClear:
            t.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight) <= b.left,
          reachable:
            t.top >= p.top && t.bottom <= p.bottom && b.top >= 0 && b.bottom <= innerHeight,
          noOverflow:
            panel.scrollWidth === panel.clientWidth &&
            input.scrollWidth === input.clientWidth &&
            p.left >= 0 &&
            p.right <= innerWidth &&
            document.documentElement.scrollWidth <= innerWidth,
          fontSize: parseFloat(style.fontSize),
          buttonWidth: b.width,
          buttonHeight: b.height,
          focused: document.activeElement === input,
        };
      });
      expect(layout).toEqual({
        fullWidth: true,
        buttonInside: true,
        textClear: true,
        reachable: true,
        noOverflow: true,
        fontSize: 16,
        buttonWidth: 36,
        buttonHeight: 36,
        focused: true,
      });
    }
  } finally {
    await browser.setViewport(original);
    await input.fill(draft);
  }
}
