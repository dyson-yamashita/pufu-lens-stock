import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

test('THEME-001 トップのスイッチでテーマを選び、再読込と言語変更後も保持する', async ({
  app,
  browser,
  screen,
}) => {
  const address = new URL(app.baseUrl ?? 'about:blank');
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port)
    throw new Error('ローカル専用です。');
  await browser.route('**/*', async (route) => {
    if (new URL(route.request.url).origin === address.origin) await route.continue();
    else await route.abort();
  });
  await app.clearState();
  await browser.emulateMedia({ colorScheme: 'dark' });
  await app.open('/');
  const html = browser.locator('html');
  const logo = browser.locator('.login-page .brand-logo:visible');
  const toggle = screen.getByRole('switch', 'ダークモード', { exact: true });
  const checkLogo = async (theme: 'light' | 'dark') => {
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('alt', 'Pufu Lens');
    await expect(screen.getByRole('img', 'Pufu Lens', { exact: true })).toHaveCount(1);
    expect(
      await browser.evaluate(async (theme) => {
        const images = [...document.querySelectorAll<HTMLImageElement>('.login-page .brand-logo')];
        // 画像へ親のcolor-schemeが伝わらない環境でも、ページ側のテーマで選ぶ画像は見える。
        for (const image of images) image.style.colorScheme = 'light';
        const image = images.find((image) => image.getClientRects().length > 0)!;
        const mark = document.querySelector<HTMLImageElement>('.login-page .brand-mark')!;
        await Promise.all([image.decode(), mark.decode()]);
        const bounds = image.getBoundingClientRect();
        const markBounds = mark.getBoundingClientRect();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        // Pの上部を読み、OS設定とは独立した手動テーマでも文字が明暗反転することを確認する。
        const [red, green, blue, alpha] = context.getImageData(100, 30, 1, 1).data;
        const brightness = (red + green + blue) / 3;
        return (
          alpha === 255 &&
          (theme === 'dark' ? brightness > 200 : brightness < 100) &&
          markBounds.width >= 32 &&
          markBounds.left >= 0 &&
          markBounds.right < bounds.left &&
          bounds.width > bounds.height * 3 &&
          bounds.left >= 0 &&
          bounds.right <= window.innerWidth &&
          document.documentElement.scrollWidth <= window.innerWidth
        );
      }, theme),
    ).toBe(true);
  };
  const checkHome = async (language: 'ja' | 'en') => {
    await expect(browser.locator('.login-copy h1')).toHaveText(
      language === 'ja'
        ? '気づきを残し、AIと育て、次の一歩へ。'
        : 'Save insights. Grow them with AI. Take your next step.',
    );
    await expect(browser.locator('.home-entry-list article')).toHaveCount(3);
    await expect(browser.locator('.home-entry-example')).toHaveCount(3);
    await expect(browser.locator('.home-integration')).toContainText('MCP');
    const prefix = language === 'ja' ? '' : '/en';
    await expect(browser.locator('.login-manual-link')).toHaveAttribute('href', `${prefix}/manual`);
    await expect(browser.locator('#public-projects')).toBeVisible();
    expect(
      await browser.evaluate(() => {
        const selectors = ['.login-copy', '.home-entry', '.home-integration', '#use-cases article'];
        return selectors.every((selector) =>
          [...document.querySelectorAll(selector)].every((node) => {
            const bounds = node.getBoundingClientRect();
            return (
              bounds.left >= 0 &&
              bounds.right <= window.innerWidth &&
              node.scrollWidth <= node.clientWidth
            );
          }),
        );
      }),
    ).toBe(true);
  };
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await checkLogo('dark');
  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await checkLogo('light');
  await checkHome('ja');
  await app.screenshot('home-theme-light');
  await browser.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await checkLogo('dark');
  await checkHome('ja');
  await app.screenshot('home-theme-dark');
  // 設定の応答を保留して起動画面を経由させ、起動中の同名ロゴを検証対象にしない。
  let resumeConfig!: () => void;
  const configGate = new Promise<void>((resolve) => {
    resumeConfig = resolve;
  });
  await browser.route(new URL('/api/config', address).href, async (route) => {
    await configGate;
    await route.continue();
  });
  try {
    await browser.reload();
    await expect(browser.locator('.boot .brand-logo:visible')).toBeVisible();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await browser.emulateMedia({ colorScheme: 'light' });
    await expect(html).toHaveAttribute('data-theme', 'dark');
  } finally {
    resumeConfig();
  }
  await checkLogo('dark');
  await browser.locator('#site-language').selectOption({ value: 'en' });
  await expect(html).toHaveAttribute('lang', 'en');
  const englishToggle = screen.getByRole('switch', 'Dark mode', { exact: true });
  await expect(englishToggle).toHaveAttribute('aria-checked', 'true');
  await checkLogo('dark');
  await checkHome('en');
  await app.screenshot('home-theme-en-dark');
  await englishToggle.click();
  await checkHome('en');
  await app.screenshot('home-theme-en-light');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await browser.keyboard.press('Space');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(englishToggle).toHaveAttribute('aria-checked', 'true');
  await browser.keyboard.press('Enter');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(englishToggle).toHaveAttribute('aria-checked', 'false');
  // The anonymous bundle must retain styles for infrequent account states too.
  await app.open('/en/?login_error=1&withdrawn=pending');
  await expect(browser.locator('.form-error')).toBeVisible();
  await expect(browser.locator('.withdrawal-notice')).toBeVisible();
  expect(
    await browser.evaluate(() => {
      const error = getComputedStyle(document.querySelector('.form-error')!);
      const notice = getComputedStyle(document.querySelector('.withdrawal-notice')!);
      return (
        error.padding === '10px' &&
        error.marginTop === '15px' &&
        notice.padding === '12px 16px' &&
        notice.borderTopWidth === '1px'
      );
    }),
  ).toBe(true);

  // A refused JS or CSS chunk must offer a user-controlled recovery, never a blank root.
  let blocked: 'app' | 'css' | 'faq' | null = 'app';
  await browser.route('**/assets/**', async (route) => {
    const path = new URL(route.request.url).pathname;
    const refuse =
      (blocked === 'app' && /\/App-[^/]+\.js$/.test(path)) ||
      (blocked === 'css' && /\/styles-[^/]+\.css$/.test(path)) ||
      (blocked === 'faq' && /\/FaqPage-[^/]+\.js$/.test(path));
    if (refuse) await route.abort();
    else await route.continue();
  });
  const recover = async (language: 'ja' | 'en') => {
    await expect(html).toHaveAttribute('lang', language);
    await expect(screen.getByRole('alert')).toHaveText(
      language === 'ja'
        ? '画面を読み込めませんでした。再読み込みして、もう一度お試しください。'
        : 'Could not load the page. Please reload and try again.',
    );
    blocked = null;
    await screen
      .getByRole('button', language === 'ja' ? '再読み込み' : 'Reload', { exact: true })
      .click();
  };
  await browser.locator('.demo-login').click();
  await expect(browser.locator('.boot [role="alert"]')).toBeVisible();
  // Other scenarios may have completed onboarding for the same local demo account.
  // Its persisted language must win after sign-in; a new account still follows /en.
  const accountLanguage = await browser.evaluate(async () => {
    const response = await fetch('/api/v1/me');
    if (!response.ok) throw new Error('Demo identity lookup failed');
    const { user } = (await response.json()) as {
      user: { language: 'ja' | 'en'; onboarding_completed_at: string | null };
    };
    return user.onboarding_completed_at ? user.language : 'en';
  });
  await recover(accountLanguage);
  await expect(browser.locator('.onboarding-page, .app-shell')).toBeVisible();
  blocked = 'css';
  await browser.reload();
  await recover(accountLanguage);
  await expect(browser.locator('.onboarding-page, .app-shell')).toBeVisible();
  blocked = 'faq';
  await app.open('/en/faq');
  await recover('en');
  await expect(browser.locator('.faq-item')).toHaveCount(28);
});
