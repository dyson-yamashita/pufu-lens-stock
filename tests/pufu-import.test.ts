import { expect, it, vi } from 'vitest';
import { parsePufuJson, readPufuJson } from '../src/pufu-import';
import score from './fixtures/pufu-sparse.json';

const metadata = {
  id: 'exported-score',
  projectId: 'original-project',
  number: 3,
  title: '元アプリのタイトル',
  owner: 'original-owner',
  editors: ['original-editor'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  _version: 1,
  _lastChangedAt: 1767312000000,
  _deleted: null,
};

it('元アプリの管理情報付きJSONも本文だけをファイル・テキストから取り込む', async () => {
  const json = JSON.stringify({ ...score, ...metadata });
  expect(parsePufuJson(json)).toEqual(score);
  expect(await readPufuJson(new File([json], 'exported.json'))).toEqual(score);
});

it.each([
  { ...score, gainingGoal: { ...score.gainingGoal, uuid: score.winCondition.uuid } },
  { ...score, gainingGoal: { ...score.gainingGoal, unknown: true } },
])('管理情報があっても本文の重複IDや不正な項目は拒否する', (invalid) => {
  expect(() => parsePufuJson(JSON.stringify({ ...invalid, ...metadata }))).toThrow();
});

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

it('テキスト入力もUTF-8の256KiB上限と本文・コメントの上限を検証する', () => {
  expect(parsePufuJson('\uFEFF' + JSON.stringify(score))).toEqual(score);
  expect(() => parsePufuJson('あ'.repeat(87382))).toThrow('256');
  const invalid = structuredClone(score);
  invalid.gainingGoal.text = 'あ'.repeat(1201);
  expect(() => parsePufuJson(JSON.stringify(invalid))).toThrow('1,200');
  invalid.gainingGoal.text = '';
  invalid.gainingGoal.comment.text = 'あ'.repeat(601);
  expect(() => parsePufuJson(JSON.stringify(invalid))).toThrow('600');
});

it('中間目的・施策がそれぞれ12件を超えていても省略せず取り込む', async () => {
  const many = structuredClone(score);
  many.purposes = Array.from({ length: 13 }, (_, i) => ({
    ...score.purposes[0],
    uuid: `purpose-${i}`,
    measures: Array.from({ length: 13 }, (_, j) => ({
      ...score.purposes[0].measures[0],
      uuid: `measure-${i}-${j}`,
    })),
  }));
  const json = JSON.stringify(many);
  expect(parsePufuJson(json)).toEqual(many);
  expect(await readPufuJson(new File([json], 'many.json'))).toEqual(many);
});
