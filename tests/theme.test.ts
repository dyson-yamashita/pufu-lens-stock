import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';
import type { ThemeStore } from '../src/theme';

function start({
  stored,
  dark = false,
  blocked = false,
}: {
  stored?: string;
  dark?: boolean;
  blocked?: boolean;
} = {}) {
  const { document } = parseHTML('<html><head><meta name="theme-color"></head></html>');
  if (blocked)
    Object.defineProperty(document, 'cookie', {
      set() {
        throw new Error('Cookies denied');
      },
    });
  const values = new Map(stored === undefined ? [] : [['pufu-lens-theme', stored]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
  const mediaListeners = new Set<() => void>();
  const media = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
  };
  let storageListener: (event: { key: string | null }) => void;
  const window = {
    location: { protocol: 'https:' },
    get localStorage() {
      if (blocked) throw new Error('Storage denied');
      return storage;
    },
    matchMedia: () => media,
    addEventListener: (_: string, listener: typeof storageListener) => {
      storageListener = listener;
    },
    pufuTheme: undefined as ThemeStore | undefined,
  };
  runInNewContext(readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8'), {
    window,
    document,
  });
  return {
    document,
    values,
    storage,
    theme: window.pufuTheme!,
    systemDark(value: boolean) {
      media.matches = value;
      mediaListeners.forEach((listener) => listener());
    },
    otherTab(value: string | null) {
      if (value === null) values.clear();
      else values.set('pufu-lens-theme', value);
      storageListener({ key: value === null ? null : 'pufu-lens-theme' });
    },
  };
}

it.each([false, true])(
  '初期設定ではOSの明暗に従い、初回描画前の背景とブラウザ色を設定する（dark=%s）',
  (dark) => {
    const app = start({ dark });
    expect(app.theme.getSnapshot()).toEqual({
      preference: 'system',
      theme: dark ? 'dark' : 'light',
    });
    expect(app.document.documentElement.dataset.theme).toBe(dark ? 'dark' : 'light');
    expect(app.document.documentElement.style.colorScheme).toBe(dark ? 'dark' : 'light');
    expect(app.document.documentElement.style.backgroundColor).toBe(dark ? '#101827' : '#fbfcff');
    expect(app.document.querySelector('meta')?.getAttribute('content')).toBe(
      dark ? '#101827' : '#233b63',
    );
  },
);

it('手動設定をOSより優先し、保存した設定を再起動時にも反映する', () => {
  const app = start({ dark: true });
  app.theme.setPreference('light');
  expect(app.theme.getSnapshot()).toEqual({ preference: 'light', theme: 'light' });
  expect(app.values.get('pufu-lens-theme')).toBe('light');
  expect(app.document.cookie).toContain('pufu_lens_theme=light;');
  app.systemDark(false);
  app.systemDark(true);
  expect(app.theme.getSnapshot().theme).toBe('light');
  expect(
    start({ stored: app.values.get('pufu-lens-theme'), dark: true }).theme.getSnapshot(),
  ).toEqual(app.theme.getSnapshot());
});

it('システムに戻すと現在のOS設定を使い、その後の変更にも追従する', () => {
  const app = start({ stored: 'dark' });
  app.theme.setPreference('system');
  expect(app.theme.getSnapshot().theme).toBe('light');
  app.systemDark(true);
  expect(app.theme.getSnapshot().theme).toBe('dark');
  expect(app.values.get('pufu-lens-theme')).toBe('system');
});

it.each(['invalid', undefined])('不正または未保存の値はシステム設定として扱う（%s）', (stored) => {
  expect(start({ stored, dark: true }).theme.getSnapshot()).toEqual({
    preference: 'system',
    theme: 'dark',
  });
});

it('保存領域を利用できない場合も起動・切り替え・OS追従が動く', () => {
  const app = start({ blocked: true });
  app.theme.setPreference('dark');
  expect(app.theme.getSnapshot().theme).toBe('dark');
  app.theme.setPreference('system');
  app.systemDark(true);
  expect(app.theme.getSnapshot()).toEqual({ preference: 'system', theme: 'dark' });
});

it('別タブでの設定変更と保存領域のクリアを反映する', () => {
  const app = start();
  app.otherTab('dark');
  expect(app.theme.getSnapshot()).toEqual({ preference: 'dark', theme: 'dark' });
  app.otherTab(null);
  expect(app.theme.getSnapshot()).toEqual({ preference: 'system', theme: 'light' });
});

it('状態の変更だけを通知し、購読を解除できる', () => {
  const app = start();
  const listener = vi.fn();
  const unsubscribe = app.theme.subscribe(listener);
  const initial = app.theme.getSnapshot();
  app.systemDark(false);
  expect(app.theme.getSnapshot()).toBe(initial);
  expect(listener).not.toHaveBeenCalled();
  app.theme.setPreference('light');
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  app.theme.setPreference('dark');
  expect(listener).toHaveBeenCalledTimes(1);
});
