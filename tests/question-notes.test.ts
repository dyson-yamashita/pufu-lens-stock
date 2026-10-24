import { afterEach, beforeEach, expect, it } from 'vitest';
import { testApp } from './helpers';

let app: Awaited<ReturnType<typeof testApp>>;
let id: string;
beforeEach(async () => {
  app = await testApp();
  const response = await app.request('/api/v1/questions', {
    method: 'POST',
    body: { project_id: 'alice-project', text: 'これから考えたいこと' },
  });
  id = ((await response.json()) as { question: { id: string } }).question.id;
});
afterEach(async () => app.dispose());
const update = (body: unknown, options = {}) =>
  app.request(`/api/v1/questions/${id}`, { method: 'PATCH', body, ...options });
const detail = async () =>
  (await (await app.request(`/api/v1/questions/${id}`)).json()) as {
    question: { note: string; project_id: string; project_name: string; text: string };
  };

it('既存の問いに空のメモを返し、改行を含むメモを保存・再取得・削除できる', async () => {
  expect((await detail()).question.note).toBe('');
  const response = await update({ note: '考えた理由\n次に試すこと' });
  expect(response.status).toBe(200);
  expect((await detail()).question).toMatchObject({
    note: '考えた理由\n次に試すこと',
    text: 'これから考えたいこと',
    project_id: 'alice-project',
  });
  expect((await update({ note: '' })).status).toBe(200);
  expect((await detail()).question.note).toBe('');
});

it('独立した問いはメモと保存先を一緒に変更できる', async () => {
  expect((await update({ note: '移動後も残す', project_id: 'alice-second' })).status).toBe(200);
  expect((await detail()).question).toMatchObject({
    note: '移動後も残す',
    project_id: 'alice-second',
  });
  const list = await app.request('/api/v1/questions?project_id=alice-second');
  expect(await list.json()).toMatchObject({ total: 1 });
});

it('2,000文字まで保存し、超過・空の更新・未定義項目を拒否する', async () => {
  expect((await update({ note: 'あ'.repeat(2000) })).status).toBe(200);
  for (const input of [{ note: 'あ'.repeat(2001) }, {}, { note: null }, { text: '上書き' }])
    expect((await update(input)).status).toBe(400);
  expect((await detail()).question.note).toHaveLength(2000);
});

it('他人の問い・保存先・未認証・別サイトからの更新を拒否し、メモを保つ', async () => {
  expect((await update({ note: '自分の記録' })).status).toBe(200);
  expect((await update({ note: '改ざん' }, { user: 'bob' })).status).toBe(404);
  expect((await update({ note: '改ざん', project_id: 'bob-project' })).status).toBe(404);
  expect((await update({ note: '改ざん', project_id: 'missing' })).status).toBe(404);
  expect((await update({ note: '改ざん' }, { headers: { Cookie: '' } })).status).toBe(401);
  expect(
    (await update({ note: '改ざん' }, { headers: { Origin: 'https://evil.example' } })).status,
  ).toBe(403);
  expect((await detail()).question.note).toBe('自分の記録');
});

it('記事に紐づく問いはメモだけを変更でき、保存先は元の記事に従う', async () => {
  const saved = await app.request('/api/v1/stocks', {
    method: 'POST',
    body: { project_id: 'alice-project', type: 'text', text: '参考にした記事' },
  });
  const stockId = ((await saved.json()) as { id: string }).id;
  const response = await app.request('/api/v1/questions', {
    method: 'POST',
    body: { stock_id: stockId, text: '記事から考えた問い' },
  });
  id = ((await response.json()) as { question: { id: string } }).question.id;
  expect((await update({ note: '問い自身のメモ', project_id: 'alice-project' })).status).toBe(200);
  expect((await update({ note: '更新されない', project_id: 'alice-second' })).status).toBe(409);
  expect((await detail()).question).toMatchObject({
    note: '問い自身のメモ',
    project_id: 'alice-project',
  });
  await app.request(`/api/v1/stocks/${stockId}`, {
    method: 'PATCH',
    body: { note: '', project_id: 'alice-second' },
  });
  expect((await detail()).question).toMatchObject({
    note: '問い自身のメモ',
    project_id: 'alice-second',
  });
});

it('公開したプロジェクトでもメモは公開レスポンスに含めない', async () => {
  expect((await update({ note: '非公開の考え' })).status).toBe(200);
  const publish = await app.request('/api/v1/projects/alice-project/publication', {
    method: 'PATCH',
    body: { is_public: true, public_description: '' },
  });
  expect(publish.status).toBe(200);
  const { publication } = (await publish.json()) as { publication: { public_id: string } };
  const response = await app.request(
    `/api/public/projects/${publication.public_id}/questions/${id}`,
  );
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain('非公開の考え');
});
