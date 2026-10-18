import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { expect, it } from 'vitest';
import { PublicScore } from '../src/PublicProjects';
import { elementKeys, type PufuScore } from '../shared/pufu';

it('公開プ譜は全要素・施策・振り返りを表示し、入力欄や編集ボタンを持たない', () => {
  const node = (id: string) => ({
    uuid: id,
    text: `${id}の内容`,
    comment: { color: 'green' as const, text: `${id}の振り返り` },
  });
  const score: PufuScore = {
    gainingGoal: node('goal'),
    winCondition: node('win'),
    purposes: [
      { ...node('purpose'), measures: [{ ...node('measure'), color: 'blue', progress: 50 }] },
    ],
    elements: Object.fromEntries(
      elementKeys.map((key) => [key, node(key)]),
    ) as PufuScore['elements'],
  };
  const markup = renderToStaticMarkup(createElement(PublicScore, { score }));
  const { document } = parseHTML(`<html><body>${markup}</body></html>`);
  expect(document.querySelectorAll('textarea,input,button,[contenteditable]')).toHaveLength(0);
  for (const key of ['goal', 'win', 'purpose', 'measure', ...elementKeys]) {
    expect(document.body.textContent).toContain(`${key}の内容`);
    expect(document.body.textContent).toContain(`${key}の振り返り`);
  }
  expect(document.body.textContent).toContain('50%');
  expect(markup).toContain('public-score-comment green');
});
