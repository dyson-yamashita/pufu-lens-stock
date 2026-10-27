import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { elementKeys, type Pufu, type PufuScore } from '../shared/pufu';
import { testApp } from './helpers';
import * as api from '../src/api';
import { createPufuPng } from '../src/pufu-download';

vi.mock('../src/pufu-download', () => ({ createPufuPng: vi.fn() }));

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
const pufu: Pufu = {
  is_favorite: 0,
  id: 'private-edit-mode',
  question_id: 'question',
  project_id: 'project',
  task: '課題',
  status: 'ready',
  error: null,
  model: 'test',
  editor_version: '0.9.18',
  revision: 1,
  current_phase: 1,
  generation: 1,
  created_at: '2026-10-22T00:00:00.000Z',
  updated_at: '2026-10-22T00:00:00.000Z',
  score,
  phases: [{ number: 1, score, created_at: '', updated_at: '' }],
  context: {
    question: { id: 'question', text: '問い', source: 'user' },
    task: '課題',
    project: { id: 'project', name: 'プロジェクト', description: '' },
    stock: null,
    userMemory: null,
    projectMemory: null,
  },
};
let root: Root;
let document: Document;
let containerWidth: number;
let resizeCallbacks: Set<() => void>;
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('MutationObserver', dom.window.MutationObserver);
  const snapshot = { theme: 'light', preference: 'light' } as const;
  window.pufuTheme = { subscribe: () => () => {}, getSnapshot: () => snapshot, setPreference() {} };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  containerWidth = 1200;
  resizeCallbacks = new Set();
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => containerWidth,
  });
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
        this.removeAttribute('open');
      },
    },
  });
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
      constructor(private callback: () => void) {}
      observe() {
        resizeCallbacks.add(this.callback);
      }
      disconnect() {
        resizeCallbacks.delete(this.callback);
      }
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === label || button.textContent === label,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
it.each([
  { width: 900, theme: 'light', textClass: 'text-base' },
  { width: 899, theme: 'light', textClass: 'text-xs' },
  { width: 1200, theme: 'dark', textClass: 'text-base' },
  { width: 640, theme: 'dark', textClass: 'text-xs' },
])(
  '公開プ譜は全内容を閲覧でき、狭い表示領域ではミニマップを利用できる（$width / $theme）',
  async ({ width, theme, textClass }) => {
    containerWidth = width;
    const snapshot = { theme, preference: theme };
    Object.defineProperty(window, 'pufuTheme', {
      configurable: true,
      value: { subscribe: () => () => {}, getSnapshot: () => snapshot },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: width < 1000, addEventListener() {}, removeEventListener() {} }),
    });
    const { default: PublicScore } = await import('../src/PublicPufuScore');
    const original = structuredClone(score);
    await act(async () => root.render(createElement(PublicScore, { score })));
    expect(Boolean(document.querySelector('[aria-label="プ譜の表示エリア"]'))).toBe(width < 900);
    expect(Boolean(document.querySelector('button[aria-label^="全体マップ："]'))).toBe(width < 900);
    expect(document.querySelector('[role="score"]')).not.toBeNull();
    const fields = [
      ...document
        .querySelector('[role="score"]')!
        .querySelectorAll<HTMLTextAreaElement>('textarea'),
    ];
    expect(fields.length).toBeGreaterThanOrEqual(12);
    const textFields = fields.filter((field) => !field.getAttribute('role')?.endsWith('-comment'));
    expect(textFields.every((field) => field.classList.contains(textClass))).toBe(true);
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
    expect(lists.every((sortable) => sortable.option('disabled') === true)).toBe(true);
    expect(
      document
        .querySelector('[role="score"]')!
        .querySelectorAll(
          'input,button,[contenteditable="true"],[aria-label="delete-icon"],[aria-label="add-icon"]',
        ),
    ).toHaveLength(0);
  },
);
it.each([
  { width: 900, textClass: 'text-base' },
  { width: 899, textClass: 'text-xs' },
])(
  '編集画面は幅$width pxで入力・追加・並べ替えと必要なミニマップを利用できる',
  async ({ width, textClass }) => {
    containerWidth = width;
    const snapshot = { theme: 'light', preference: 'light' };
    Object.defineProperty(window, 'pufuTheme', {
      configurable: true,
      value: { subscribe: () => () => {}, getSnapshot: () => snapshot },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: width < 1000, addEventListener() {}, removeEventListener() {} }),
    });
    const { default: PufuEditor } = await import('../src/PufuEditor');
    await act(async () => root.render(createElement(PufuEditor, { pufu, onGuard: () => {} })));
    expect(document.querySelector('[role="score"]')).toBeNull();
    expect(document.querySelector('.pufu-image-preview figcaption')).toBeNull();
    const help = document.querySelector('.pufu-phase-help')!;
    expect(help.nextElementSibling?.classList.contains('pufu-image-preview')).toBe(true);
    await click('編集する');
    expect(document.querySelector('dialog[open] [role="score"]')).not.toBeNull();
    expect(Boolean(document.querySelector('button[aria-label^="全体マップ："]'))).toBe(width < 900);
    const editor = document.querySelector('[role="score"]')!;
    const fields = [...editor.querySelectorAll('textarea')];
    expect(fields.length).toBeGreaterThanOrEqual(12);
    const textFields = fields.filter((field) => !field.getAttribute('role')?.endsWith('-comment'));
    expect(textFields.every((field) => field.classList.contains(textClass))).toBe(true);
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
    const preview = document.querySelector('[role="img"][aria-label="第1局面のプ譜"]');
    expect(preview?.querySelector('svg')).not.toBeNull();
    expect(preview?.textContent).toContain('goalの内容');
    expect(preview?.textContent).toContain('measureの振り返り');
    expect(document.querySelector('dialog')?.contains(editor)).toBe(true);
  },
);

it('幅の変更でミニマップと文字サイズが一緒に切り替わり、未保存の編集を保持する', async () => {
  containerWidth = 900;
  const { default: PufuEditor } = await import('../src/PufuEditor');
  const { setScore, getScoreJson } = require(
    join(editorRoot, 'components/ProjectScore.js'),
  ) as typeof import('@goto-lab/pufu-editor');
  await act(async () => root.render(createElement(PufuEditor, { pufu, onGuard: () => {} })));
  await click('編集する');
  const edited = structuredClone(score);
  edited.gainingGoal.text = '幅を変更しても保持する目標';
  const key = `${pufu.id}-phase-1`;
  await act(async () => setScore(key, JSON.stringify(edited)));
  for (const { width, textClass, minimap } of [
    { width: 899, textClass: 'text-xs', minimap: true },
    { width: 900, textClass: 'text-base', minimap: false },
  ]) {
    await act(async () => {
      containerWidth = width;
      for (const callback of [...resizeCallbacks]) callback();
    });
    expect(Boolean(document.querySelector('button[aria-label^="全体マップ："]'))).toBe(minimap);
    const fields = [
      ...document.querySelectorAll('[role="score"] textarea:not([role$="-comment"])'),
    ];
    expect(fields.every((field) => field.classList.contains(textClass))).toBe(true);
    expect(JSON.parse(getScoreJson(key)!).gainingGoal.text).toBe('幅を変更しても保持する目標');
  }
});

it('プ譜画像は選択中の局面を表示し、未保存の編集では変わらず保存・局面追加後に更新する', async () => {
  const { default: PufuEditor } = await import('../src/PufuEditor');
  const { setScore } = require(
    join(editorRoot, 'components/ProjectScore.js'),
  ) as typeof import('@goto-lab/pufu-editor');
  const second = structuredClone(score);
  second.gainingGoal.text = '第2局面の目標';
  const input = structuredClone(pufu);
  input.current_phase = 2;
  input.phases.push({ number: 2, score: second, created_at: '', updated_at: '' });
  const send = vi.spyOn(api, 'send').mockResolvedValue({
    revision: 2,
    current_phase: 2,
    updated_at: '2026-10-22T01:00:00.000Z',
  });
  await act(async () => root.render(createElement(PufuEditor, { pufu: input, onGuard: () => {} })));
  const preview = () => document.querySelector('.pufu-image-preview [role="img"]');
  expect(preview()?.textContent).toContain('第2局面の目標');
  await click('前の局面へ');
  expect(preview()?.getAttribute('aria-label')).toBe('第1局面のプ譜');
  expect(preview()?.textContent).toContain('goalの内容');
  await click('編集する');
  const edited = structuredClone(score);
  edited.gainingGoal.text = '保存後の目標';
  await act(async () => setScore(`${pufu.id}-phase-1`, JSON.stringify(edited)));
  expect(preview()?.textContent).toContain('goalの内容');
  await click('保存');
  expect(send).toHaveBeenLastCalledWith(
    `/api/v1/pufus/${pufu.id}`,
    { revision: 1, phase: 1, score: expect.objectContaining({ gainingGoal: edited.gainingGoal }) },
    'PATCH',
  );
  expect(preview()?.textContent).toContain('保存後の目標');
  await click('閉じる');
  expect(document.querySelector('[role="score"]')).toBeNull();
  await click('次の局面へ');
  expect(preview()?.textContent).toContain('第2局面の目標');
  send.mockResolvedValue({
    revision: 3,
    current_phase: 3,
    updated_at: '2026-10-22T02:00:00.000Z',
  });
  await click('局面を追加');
  expect(preview()?.getAttribute('aria-label')).toBe('第3局面のプ譜');
  expect(preview()?.textContent).toContain('第2局面の目標');
});

it('画像にできない内容でも編集画面を維持し、保存で解消すると画像を表示する', async () => {
  const { default: PufuEditor } = await import('../src/PufuEditor');
  const { setScore } = require(
    join(editorRoot, 'components/ProjectScore.js'),
  ) as typeof import('@goto-lab/pufu-editor');
  const input = structuredClone(pufu);
  input.phases[0].score.elements.people.text = '\n'.repeat(1000);
  vi.spyOn(api, 'send').mockResolvedValue({
    revision: 2,
    current_phase: 1,
    updated_at: '2026-10-22T01:00:00.000Z',
  });
  await act(async () => root.render(createElement(PufuEditor, { pufu: input, onGuard: () => {} })));
  expect(document.querySelector('.pufu-image-preview')?.textContent).toContain(
    'プ譜の画像を表示できません',
  );
  await click('編集する');
  expect(document.querySelector('[role="score"]')).not.toBeNull();
  await act(async () => setScore(`${pufu.id}-phase-1`, JSON.stringify(score)));
  const save = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === '保存',
  )!;
  await act(async () => save.click());
  expect(document.querySelector('.pufu-image-preview svg')).not.toBeNull();
});

it('未保存の編集は閉じる・Escapeで確認し、保存失敗後も保持して破棄後は保存済み内容に戻す', async () => {
  const { default: PufuEditor } = await import('../src/PufuEditor');
  const { setScore, getScoreJson } = require(
    join(editorRoot, 'components/ProjectScore.js'),
  ) as typeof import('@goto-lab/pufu-editor');
  const confirm = vi.fn().mockReturnValue(false);
  Object.defineProperty(window, 'confirm', { configurable: true, value: confirm });
  const send = vi.spyOn(api, 'send').mockRejectedValue(new Error('保存に失敗しました'));
  const guard = vi.fn();
  await act(async () => root.render(createElement(PufuEditor, { pufu, onGuard: guard })));
  await click('編集する');
  const edited = structuredClone(score);
  edited.gainingGoal.text = '未保存の目標';
  const key = `${pufu.id}-phase-1`;
  await act(async () => setScore(key, JSON.stringify(edited)));
  await click('保存');
  expect(send).toHaveBeenCalledOnce();
  expect(document.querySelector('dialog [role="alert"]')?.textContent).toContain('保存に失敗');
  const cancel = new window.Event('cancel', { cancelable: true });
  await act(async () => document.querySelector('dialog')!.dispatchEvent(cancel));
  expect(cancel.defaultPrevented).toBe(true);
  expect(document.querySelector('dialog[open]')).not.toBeNull();
  expect(JSON.parse(getScoreJson(key)!).gainingGoal.text).toBe('未保存の目標');
  await click('閉じる');
  expect(document.querySelector('dialog[open]')).not.toBeNull();
  confirm.mockReturnValue(true);
  await click('閉じる');
  expect(document.querySelector('dialog')).toBeNull();
  await click('編集する');
  expect(JSON.parse(getScoreJson(key)!).gainingGoal.text).toBe('goalの内容');
  expect(guard.mock.lastCall?.[0]()).toBe(true);
});

it('保存中は閉じる・Escapeを受け付けず、完了後に閉じられる', async () => {
  const { default: PufuEditor } = await import('../src/PufuEditor');
  let finish!: (value: unknown) => void;
  vi.spyOn(api, 'send').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(createElement(PufuEditor, { pufu, onGuard: () => {} })));
  await click('編集する');
  await click('保存');
  expect(
    document.querySelector<HTMLButtonElement>('dialog button[aria-label="閉じる"]')?.disabled,
  ).toBe(true);
  await act(async () =>
    document
      .querySelector('dialog')!
      .dispatchEvent(new window.Event('cancel', { cancelable: true })),
  );
  expect(document.querySelector('dialog[open]')).not.toBeNull();
  await act(async () =>
    finish({ revision: 2, current_phase: 1, updated_at: '2026-10-22T01:00:00Z' }),
  );
  await click('閉じる');
  expect(document.querySelector('dialog')).toBeNull();
});

it('エディターを一度も開かずに保存済みの局面をJSON出力できる', async () => {
  const { default: PufuEditor } = await import('../src/PufuEditor');
  const input = { ...pufu, id: 'unmounted-export' };
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  await act(async () => root.render(createElement(PufuEditor, { pufu: input, onGuard: () => {} })));
  expect(
    [...document.querySelectorAll('button')].some((button) => button.textContent === 'JSON'),
  ).toBe(false);
  await click('ダウンロード');
  await click('JSON');
  expect(document.querySelector('[role="score"]')).toBeNull();
  const blob = createUrl.mock.calls[0][0] as Blob;
  expect(JSON.parse(await blob.text())).toEqual(score);
  expect(document.querySelector('dialog')).toBeNull();
});

it.each([1, 2, 3])('第%s局面で各項目のコメントを開き、修正内容を保存できる', async (number) => {
  const { default: PufuEditor } = await import('../src/PufuEditor');
  const { setScore } = require(
    join(editorRoot, 'components/ProjectScore.js'),
  ) as typeof import('@goto-lab/pufu-editor');
  const input = structuredClone(pufu);
  input.id = `comments-phase-${number}`;
  input.current_phase = number;
  input.phases = Array.from({ length: number }, (_, index) => ({
    ...structuredClone(pufu.phases[0]),
    number: index + 1,
  }));
  const send = vi
    .spyOn(api, 'send')
    .mockResolvedValue({ revision: 2, current_phase: number, updated_at: input.updated_at });
  await act(async () => root.render(createElement(PufuEditor, { pufu: input, onGuard: () => {} })));
  await click('編集する');
  const icons = document.querySelectorAll('dialog [aria-label^="comment-icon"]');
  expect(icons.length).toBe(15);
  await act(async () =>
    document
      .querySelector<HTMLElement>('dialog [role="gaining-goal"][aria-label="comment-icon"]')!
      .dispatchEvent(new window.Event('click', { bubbles: true })),
  );
  const field = document.querySelector<HTMLTextAreaElement>(
    'textarea[role="gaining-goal-comment"]',
  )!;
  expect(field).not.toBeNull();
  expect(field.hasAttribute('readOnly')).toBe(false);
  const updated = structuredClone(score);
  updated.gainingGoal.comment.text = `第${number}局面のコメントを修正`;
  await act(async () => setScore(`${input.id}-phase-${number}`, JSON.stringify(updated)));
  expect(field.value).toBe(updated.gainingGoal.comment.text);
  await click('保存');
  expect(send).toHaveBeenLastCalledWith(
    `/api/v1/pufus/${input.id}`,
    { revision: 1, phase: number, score: updated },
    'PATCH',
  );
  expect(document.querySelector('.pufu-image-preview')?.textContent).toContain(
    updated.gainingGoal.comment.text,
  );
});

it('PNGは選択中の保存済み局面を出力し、失敗時は形式選択から再試行できる', async () => {
  const { default: PufuEditor } = await import('../src/PufuEditor');
  const input = structuredClone(pufu);
  input.current_phase = 2;
  const second = structuredClone(score);
  second.gainingGoal.text = '第2局面の目標';
  input.phases.push({ ...input.phases[0], number: 2, score: second });
  const png = new Blob(['png'], { type: 'image/png' });
  vi.mocked(createPufuPng)
    .mockRejectedValueOnce(new Error('画像の生成に失敗しました'))
    .mockResolvedValue(png);
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:png-export');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const links: string[] = [];
  vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    links.push(this.download);
  });
  await act(async () => root.render(createElement(PufuEditor, { pufu: input, onGuard: () => {} })));
  await click('前の局面へ');
  await click('ダウンロード');
  await click('画像（PNG）');
  expect(document.querySelector('dialog [role="alert"]')?.textContent).toContain(
    '画像の生成に失敗しました',
  );
  expect(document.querySelector('dialog button[disabled]')).toBeNull();
  await click('画像（PNG）');
  expect(createPufuPng).toHaveBeenLastCalledWith(score, 'light');
  expect(createUrl).toHaveBeenCalledWith(png);
  expect(links).toEqual([`${pufu.id}-phase-1.png`]);
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.querySelector('[role="score"]')).toBeNull();
});

it('読み取り専用の取得結果はEditorのJSON出力と一致し、そのまま再読み込みできる', async () => {
  const app = await testApp();
  try {
    const { ProjectScore, getScoreJson, setScore } = require(
      join(editorRoot, 'components/ProjectScore.js'),
    ) as typeof import('@goto-lab/pufu-editor');
    const key = 'mcp-export-roundtrip';
    const input = structuredClone(score);
    input.purposes[0].measures[0].progress = 0;
    input.purposes[1].measures[0].progress = 100;
    await act(async () =>
      root.render(
        createElement(ProjectScore, {
          uniqueKey: key,
          initScore: input,
          mobile: true,
        }),
      ),
    );
    const exported = getScoreJson(key)!;
    const created = await app.request('/api/v1/questions', {
      method: 'POST',
      body: { project_id: 'alice-project', text: 'Editorとの互換性' },
    });
    const { question } = (await created.json()) as { question: { id: string } };
    await app.env.DB.prepare(
      `INSERT INTO pufu_scores(id,user_id,question_id,task,input_json,score_json,editor_version,status)
      VALUES('exported','alice',?,'課題','{}',?,'0.9.15','ready')`,
    )
      .bind(question.id, exported)
      .run();
    const response = await app.request(`/api/v1/questions/${question.id}/pufu`);
    expect(response.status).toBe(200);
    const { projectScore } = (await response.json()) as { projectScore: PufuScore };
    expect(projectScore).toEqual(JSON.parse(exported));
    await act(async () => setScore(key, JSON.stringify(projectScore)));
    expect(JSON.parse(getScoreJson(key)!)).toEqual(projectScore);
    expect(projectScore.purposes[0].measures[0].progress).toBe(0);
    expect(projectScore.purposes[1].measures[0].progress).toBe(100);
    expect(projectScore.purposes[0].measures[1]).not.toHaveProperty('progress');
  } finally {
    await app.dispose();
  }
});
