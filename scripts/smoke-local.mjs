import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const base = 'http://localhost:5173';
const config = await (await fetch(`${base}/api/config`)).json();
assert.equal(config.demo, true, 'この検証はローカルデモ専用です。');
const login = await fetch(`${base}/api/auth/demo`, { method: 'POST', headers: { Origin: base } });
assert.equal(login.status, 200);
const session = login.headers
  .getSetCookie()
  .find((value) => value.startsWith('stock_session='))
  .split(';')[0];
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { Cookie: session, Origin: base, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.ok(response.ok, data.error ?? `${method} ${path} failed`);
  return data;
}
let projectId;
try {
  const project = await request('/projects', 'POST', {
    name: 'ローカル動作検証',
    description: '検証終了後に、この検証で作成したデータだけを削除します。',
  });
  projectId = project.id;
  const saved = await request('/stocks', 'POST', {
    project_id: projectId,
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/202',
  });
  const deadline = Date.now() + 60000;
  let verified = false;
  while (Date.now() < deadline) {
    const { stocks } = await request(`/stocks?project_id=${projectId}`);
    const stock = stocks.find((value) => value.id === saved.id);
    if (stock?.status === 'failed') throw new Error(stock.error);
    const { memory } = await request(`/memory?project_id=${projectId}`);
    const { question } = await request(`/stocks/${saved.id}/question`);
    if (question?.status === 'failed') throw new Error(question.error);
    if (stock?.status === 'ready' && memory?.article_count === 1 && question?.status === 'ready') {
      const { content } = await request(`/stocks/${saved.id}/content`);
      assert.ok(content.length >= 200);
      assert.ok(stock.summary.keyPoints.length);
      assert.ok(memory.data.knowledge[0].articleIds.includes(stock.article_id));
      assert.equal(question.stock_id, saved.id);
      assert.equal(question.project_id, projectId);
      assert.ok(question.text.length);
      const questions = await request(`/questions?project_id=${projectId}`);
      assert.equal(questions.total, 1);
      const manual = await request('/questions', 'POST', {
        stock_id: saved.id,
        text: 'この仕組みを利用するとき、どの点を確認すべきだろう？',
        request_id: randomUUID(),
      });
      assert.equal(manual.question.source, 'user');
      assert.equal(manual.question.stock_id, saved.id);
      const details = await request(`/stocks/${saved.id}/question`);
      assert.equal(details.question.source, 'ai');
      assert.equal(details.questions.length, 2);
      assert.ok(details.questions.some((value) => value.id === manual.question.id));
      const userQuestions = await request(`/questions?project_id=${projectId}&source=user`);
      assert.equal(userQuestions.total, 1);
      const inputText =
        'テキストストックの検証\n保存受付と要約処理を分離すると、通信が切れても処理を続けられます。\n同じ操作の再送では重複を防ぎ、失敗した処理だけを再試行します。';
      const textStock = await request('/stocks', 'POST', {
        type: 'text',
        project_id: projectId,
        text: inputText,
      });
      const textDeadline = Date.now() + 60000;
      let textVerified = false;
      while (Date.now() < textDeadline) {
        const { stock: textDetail } = await request(`/stocks/${textStock.id}`);
        if (textDetail.status === 'failed') throw new Error(textDetail.error);
        const { question: textQuestion } = await request(`/stocks/${textStock.id}/question`);
        const { memory: textMemory } = await request(`/memory?project_id=${projectId}`);
        if (
          textDetail.status === 'ready' &&
          textQuestion?.status === 'ready' &&
          textMemory?.article_count === 2
        ) {
          assert.equal(textDetail.source_type, 'text');
          assert.equal(textDetail.title, 'テキストストックの検証');
          assert.equal(textDetail.source_url, '');
          assert.equal((await request(`/stocks/${textStock.id}/content`)).content, inputText);
          assert.ok(
            textMemory.data.knowledge.some((item) =>
              item.articleIds.includes(textDetail.article_id),
            ),
          );
          textVerified = true;
          break;
        }
        await setTimeout(1000);
      }
      assert.ok(textVerified, '60秒以内にテキストの処理が完了しませんでした。');
      console.log(
        'ローカルWorkersでURLとテキストの保存・R2保存・要約・AIの問い・ユーザーの問いの追加・根拠付きメモリ更新を確認しました。',
      );
      verified = true;
      break;
    }
    await setTimeout(1000);
  }
  assert.ok(verified, '60秒以内に非同期処理が完了しませんでした。');
} finally {
  if (projectId) await request(`/projects/${projectId}`, 'DELETE');
}
