import { expect, it, vi } from 'vitest';
import { readPufuJson } from '../src/pufu-import';
import score from './fixtures/pufu-sparse.json';

it('pufu editorのJSONをBOM付きでもコメント・色・進捗を保って読み込む', async () => {
  const exported = structuredClone(score);
  exported.winCondition.comment.text = '確認コメント';
  exported.purposes[0].measures[0].color = 'red';
  exported.purposes[0].measures[0].progress = 65;
  expect(await readPufuJson(new File(['\uFEFF' + JSON.stringify(exported)], 'score.json'))).toEqual(
    exported,
  );
});

it.each([
  '{',
  'null',
  '[]',
  '{}',
  JSON.stringify({
    ...score,
    gainingGoal: { ...score.gainingGoal, uuid: score.winCondition.uuid },
  }),
])('不正なJSONや構造・重複IDを拒否する: %s', async (json) => {
  await expect(readPufuJson(new File([json], 'score.json'))).rejects.toThrow();
});

it('上限を超えるファイルは読み込む前に拒否する', async () => {
  const text = vi.fn();
  await expect(readPufuJson({ size: 262145, text })).rejects.toThrow('256');
  expect(text).not.toHaveBeenCalled();
});
