import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { elementKeys, type Pufu, type PufuScore } from '../shared/pufu';
import { testApp } from './helpers';
import * as api from '../src/api';

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
  id: 'private-edit-mode',
  question_id: 'question',
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
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('MutationObserver', dom.window.MutationObserver);
  containerWidth = 1200;
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => containerWidth,
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each([
  { width: 1200, theme: 'light' },
  { width: 640, theme: 'light' },
  { width: 1200, theme: 'dark' },
  { width: 640, theme: 'dark' },
])(
  '公開プ譜は全内容を閲覧でき、狭い表示領域ではミニマップを利用できる（$width / $theme）',
  async ({ width, theme }) => {
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
it.each([1200, 640])(
  '編集画面は幅%sで入力・追加・並べ替えと必要なミニマップを利用できる',
  async (width) => {
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
    expect(Boolean(document.querySelector('button[aria-label^="全体マップ："]'))).toBe(width < 900);
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
    const preview = document.querySelector('[role="img"][aria-label="第1局面のプ譜"]');
    expect(preview?.querySelector('svg')).not.toBeNull();
    expect(preview?.textContent).toContain('goalの内容');
    expect(preview?.textContent).toContain('measureの振り返り');
    expect([...document.querySelectorAll('[role="img"], [role="score"]')]).toEqual([
      preview,
      editor,
    ]);
  },
);

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
  const click = async (label: string) => {
    const button = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === label || button.textContent === label,
    )!;
    await act(async () => button.click());
  };
  expect(preview()?.textContent).toContain('第2局面の目標');
  await click('前の局面へ');
  expect(preview()?.getAttribute('aria-label')).toBe('第1局面のプ譜');
  expect(preview()?.textContent).toContain('goalの内容');
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
  expect(document.querySelector('[role="score"]')).not.toBeNull();
  await act(async () => setScore(`${pufu.id}-phase-1`, JSON.stringify(score)));
  const save = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === '保存',
  )!;
  await act(async () => save.click());
  expect(document.querySelector('.pufu-image-preview svg')).not.toBeNull();
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
