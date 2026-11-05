import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import PufuForm from '../src/PufuForm';
import { send } from '../src/api';

vi.mock('../src/api', () => ({ send: vi.fn(), createRequestId: () => crypto.randomUUID() }));
vi.mock('../src/RelationPicker', () => ({
  default: ({
    kind,
    value,
    onChange,
  }: {
    kind: string;
    value: { id: string; label: string }[];
    onChange: (value: { id: string; label: string }[]) => void;
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-kind': kind,
        onClick: () => onChange([{ id: kind === 'stocks' ? 's1' : 'q1', label: '選択' }]),
      },
      `${kind}:${value.length}`,
    ),
}));

let root: Root;
let document: Document;
const onDone = vi.fn();
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document as unknown as Document;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!);
  vi.mocked(send).mockResolvedValue({ id: 'created' });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function render(questionId?: string) {
  await act(async () =>
    root.render(
      createElement(PufuForm, {
        projects: [
          { id: 'project', name: 'プロジェクト' },
          { id: 'other', name: '別' },
        ],
        projectId: 'project',
        questionId,
        onDone,
      }),
    ),
  );
}
const submitButton = () => document.querySelector<HTMLButtonElement>('button.primary')!;
async function submit() {
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
}
async function select(kind: string) {
  await act(async () =>
    document.querySelector<HTMLButtonElement>(`[data-kind="${kind}"]`)!.click(),
  );
}
it('目標も参照も空なら送信せず、参照選択後は空欄の目標で生成する', async () => {
  await render();
  expect(submitButton().disabled).toBe(true);
  await submit();
  expect(send).not.toHaveBeenCalled();
  await select('questions');
  await select('stocks');
  expect(submitButton().disabled).toBe(false);
  expect(document.querySelector('#pufu-task')!.hasAttribute('required')).toBe(false);
  await submit();
  expect(send).toHaveBeenCalledWith(
    '/api/v1/projects/project/pufus/generate',
    expect.objectContaining({ task: '', question_ids: ['q1'], stock_ids: ['s1'] }),
  );
  expect(onDone).toHaveBeenCalledWith('created');
});
it('プロジェクトを変えると選択済みの参照を解除する', async () => {
  await render();
  await select('stocks');
  const project = document.querySelector('#pufu-project')!;
  Object.defineProperty(project, 'value', { configurable: true, value: 'other' });
  await act(async () => project.dispatchEvent(new window.Event('change', { bubbles: true })));
  expect(document.querySelector('[data-kind="stocks"]')!.textContent).toBe('stocks:0');
  expect(submitButton().disabled).toBe(true);
});
it('問いからの作成は目標が空でも送信できる', async () => {
  await render('question');
  expect(submitButton().disabled).toBe(false);
  await submit();
  expect(send).toHaveBeenCalledWith(
    '/api/v1/questions/question/pufus',
    expect.objectContaining({ task: '' }),
  );
});
