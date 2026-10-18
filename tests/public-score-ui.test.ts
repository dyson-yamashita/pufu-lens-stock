import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { elementKeys, type PufuScore } from '../shared/pufu';

const require = createRequire(import.meta.url);
const editorRoot = dirname(require.resolve('@goto-lab/pufu-editor'));
const stylesheet = join(editorRoot, 'components/Comment.module.css');
const savedStylesheet = require.cache[stylesheet];
require.cache[stylesheet] = { loaded: true, exports: {} } as NodeModule;
afterAll(() => {
  if (savedStylesheet) require.cache[stylesheet] = savedStylesheet;
  else delete require.cache[stylesheet];
});
// CommonJSが読み込むCSSだけを除き、実際のProjectScoreを使う。
vi.mock(
  '@goto-lab/pufu-editor',
  () =>
    require(
      join(editorRoot, 'components/ProjectScore.js'),
    ) as typeof import('@goto-lab/pufu-editor'),
);
const node = (uuid: string) => ({
  uuid,
  text: `${uuid}の内容`,
  comment: { color: 'green' as const, text: `${uuid}の振り返り` },
});
const score: PufuScore = {
  gainingGoal: node('goal'),
  winCondition: node('win'),
  purposes: [
    {
      ...node('purpose'),
      measures: [
        { ...node('measure'), color: 'blue', progress: 50 },
        { ...node('second-measure'), color: 'green' },
      ],
    },
    {
      ...node('second-purpose'),
      measures: [{ ...node('shared-measure'), text: 'measureの内容', color: 'red', progress: 75 }],
    },
  ],
  elements: Object.fromEntries(elementKeys.map((key) => [key, node(key)])) as PufuScore['elements'],
};
let root: Root;
let document: Document;
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  document.cookie = '';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { search: '', hash: '', hostname: 'example.com', href: 'https://example.com' },
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(window, 'getComputedStyle', {
    configurable: true,
    value: () => ({
      boxSizing: 'border-box',
      paddingTop: '0',
      paddingBottom: '0',
      borderTopWidth: '0',
      borderBottomWidth: '0',
    }),
  });
  Object.defineProperty(window, 'navigator', {
    configurable: true,
    value: { userAgent: 'test chrome' },
  });
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it.each([
  { mobile: false, theme: 'light' },
  { mobile: true, theme: 'light' },
  { mobile: false, theme: 'dark' },
  { mobile: true, theme: 'dark' },
])(
  '公開プ譜はpufu-editorで全内容を閲覧でき、編集できない（$mobile / $theme）',
  async ({ mobile, theme }) => {
    const snapshot = { theme, preference: theme };
    Object.defineProperty(window, 'pufuTheme', {
      configurable: true,
      value: { subscribe: () => () => {}, getSnapshot: () => snapshot },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }),
    });
    const { default: PublicScore } = await import('../src/PublicPufuScore');
    const original = structuredClone(score);
    await act(async () => root.render(createElement(PublicScore, { score })));
    expect(document.querySelector('[role="score"]')).not.toBeNull();
    const fields = [
      ...document
        .querySelector('[role="score"]')!
        .querySelectorAll<HTMLTextAreaElement>('textarea'),
    ];
    expect(fields.length).toBeGreaterThanOrEqual(12);
    expect(fields.filter((field) => !field.hasAttribute('readOnly'))).toHaveLength(0);
    for (const key of [
      'goal',
      'win',
      'purpose',
      'measure',
      'second-measure',
      'second-purpose',
      ...elementKeys,
    ]) {
      expect(fields.some((field) => (field.value || field.defaultValue) === `${key}の内容`)).toBe(
        true,
      );
      expect(
        fields.some((field) => (field.value || field.defaultValue) === `${key}の振り返り`),
      ).toBe(true);
    }
    expect(
      fields.some((field) => (field.value || field.defaultValue) === 'shared-measureの振り返り'),
    ).toBe(true);
    expect(document.body.textContent).toContain('50%');
    expect(document.body.textContent).toContain('75%');
    expect(document.querySelector('[role="score"]')?.classList.contains('dark')).toBe(
      theme === 'dark',
    );
    expect(document.body.textContent).toContain('BSD-3-Clause');
    expect(score).toEqual(original);
    const Sortable = require('sortablejs') as {
      get: (element: Element) => { option: (name: string) => unknown } | undefined;
    };
    const lists = [...document.querySelectorAll('[role="score"] div')]
      .map((element) => Sortable.get(element))
      .filter((sortable) => sortable !== undefined);
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((sortable) => sortable.option('disabled') === true)).toBe(true);
    expect(
      document.querySelectorAll(
        'input,button,[contenteditable="true"],[aria-label="delete-icon"],[aria-label="add-icon"]',
      ),
    ).toHaveLength(0);
  },
);
it('通常の編集モードでは入力・追加・並べ替えを引き続き利用できる', async () => {
  const { ProjectScore } = require(
    join(editorRoot, 'components/ProjectScore.js'),
  ) as typeof import('@goto-lab/pufu-editor');
  await act(async () =>
    root.render(
      createElement(ProjectScore, {
        initScore: structuredClone(score),
        uniqueKey: 'private-edit-mode',
        mobile: true,
        preview: false,
      }),
    ),
  );
  const editor = document.querySelector('[role="score"]')!;
  const fields = [...editor.querySelectorAll('textarea')];
  expect(fields.length).toBeGreaterThanOrEqual(12);
  expect(fields.every((field) => !field.hasAttribute('readOnly'))).toBe(true);
  expect(editor.querySelector('[aria-label="add-icon"]')).not.toBeNull();
  const Sortable = require('sortablejs') as {
    get: (element: Element) => { option: (name: string) => unknown } | undefined;
  };
  const lists = [...editor.querySelectorAll('div')]
    .map((element) => Sortable.get(element))
    .filter((sortable) => sortable !== undefined);
  expect(lists.length).toBeGreaterThan(0);
  expect(lists.every((sortable) => sortable.option('disabled') === false)).toBe(true);
});
