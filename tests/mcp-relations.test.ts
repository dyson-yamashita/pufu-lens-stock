import { afterEach, beforeEach, expect, it } from 'vitest';
import { testApp } from './helpers';
import { mcpToken } from './mcp-helpers';
import worker from '../server/index';
import score from './fixtures/pufu-sparse.json';
let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
  for (const id of ['one', 'two'])
    await app.env.DB.batch([
      app.env.DB.prepare(
        "INSERT INTO articles(id,user_id,canonical_url,source_url,title,domain,status) VALUES (?,'alice',?,?,?,'example.com','ready')",
      ).bind(id, `https://example.com/${id}`, `https://example.com/${id}`, `SECRET_STOCK_${id}`),
      app.env.DB.prepare(
        "INSERT INTO stocks(id,user_id,project_id,article_id) VALUES (?,'alice','alice-project',?)",
      ).bind(id, id),
      app.env.DB.prepare(
        "INSERT INTO questions(id,project_id,source,text,status) VALUES (?,'alice-project','user',?,'ready')",
      ).bind(`q-${id}`, `SECRET_QUESTION_${id}`),
    ]);
});
afterEach(async () => app.dispose());
async function call(token: string, name: string, args: unknown) {
  const response = await worker.fetch(
    new Request(`${app.env.APP_URL}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Host: new URL(app.env.APP_URL).host,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
    app.env,
    app.ctx,
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  const data = JSON.parse(
    response.headers.get('Content-Type')?.includes('application/json')
      ? text
      : text
          .split('\n')
          .find((line) => line.startsWith('data: '))!
          .slice(6),
  );
  return data.result as {
    isError?: boolean;
    structuredContent: { pufu: { id: string }; question: { id: string; note: string } };
    content?: unknown;
  };
}
it('プ譜の書き込み許可だけのMCP応答には関連する問い本文・ストック名を返さない', async () => {
  const token = await mcpToken(app, 'alice-project', ['pufus:write']);
  const args = {
    project_id: 'alice-project',
    question_ids: ['q-one', 'q-two'],
    stock_ids: ['one', 'two'],
    projectScore: score,
    request_id: crypto.randomUUID(),
  };
  const result = await call(token, 'create_pufu', args);
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent.pufu.id).toBeTruthy();
  expect(JSON.stringify(result)).not.toContain('SECRET_');
  const id = result.structuredContent.pufu.id;
  const changed = structuredClone(score);
  changed.gainingGoal.text = 'SECRET_EDITED_GOAL';
  await app.request(`/api/v1/pufus/${id}`, {
    method: 'PATCH',
    body: { revision: 1, score: changed, question_id: 'q-two' },
  });
  const repeated = await call(token, 'create_pufu', args);
  expect(repeated.isError).not.toBe(true);
  expect(JSON.stringify(repeated)).not.toContain('SECRET_');
  expect(await (await app.request(`/api/v1/pufus/${id}`)).json()).toMatchObject({
    pufu: { question_ids: ['q-two'], stock_ids: ['one', 'two'] },
  });
});
it('問いの書き込み許可だけで関連ストック名や再送後の個人メモを読み出せない', async () => {
  const token = await mcpToken(app, 'alice-project', ['questions:write']);
  const args = {
    project_id: 'alice-project',
    stock_ids: ['one', 'two'],
    text: '自分で送った問い',
    note: '自分で送ったメモ',
    request_id: crypto.randomUUID(),
  };
  const first = await call(token, 'add_question', args);
  expect(first.isError).not.toBe(true);
  expect(JSON.stringify(first)).not.toContain('SECRET_');
  const id = first.structuredContent.question.id;
  expect(first.structuredContent.question.note).toBe(args.note);
  await app.request(`/api/v1/questions/${id}`, {
    method: 'PATCH',
    body: { note: 'SECRET_PERSONAL_NOTE', stock_ids: ['two'] },
  });
  const repeated = await call(token, 'add_question', args);
  expect(repeated.isError).not.toBe(true);
  expect(JSON.stringify(repeated)).not.toContain('SECRET_');
  expect(repeated.structuredContent.question.note).toBe(args.note);
});
it('問い詳細の読み取り途中に移動しても移動先で編集されたプ譜を返さない', async () => {
  const response = await app.request('/api/v1/pufus', {
    method: 'POST',
    body: {
      project_id: 'alice-project',
      question_id: 'q-one',
      score,
      request_id: crypto.randomUUID(),
    },
  });
  const { pufu } = (await response.json()) as { pufu: { id: string } };
  const token = await mcpToken(app, 'alice-project', ['questions:read']);
  const original = app.env.DB;
  app.env.DB = new Proxy(original, {
    get(target, key) {
      if (key === 'prepare')
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (sql.includes('FROM pufu_scores WHERE EXISTS (SELECT 1 FROM pufu_questions'))
            return {
              bind: (...values: unknown[]) => ({
                all: async () => {
                  app.env.DB = original;
                  await app.request('/api/v1/questions/q-one', {
                    method: 'PATCH',
                    body: { project_id: 'alice-second' },
                  });
                  const changed = structuredClone(score);
                  changed.gainingGoal.text = 'PRIVATE_OTHER_PROJECT_GOAL';
                  await app.request(`/api/v1/pufus/${pufu.id}`, {
                    method: 'PATCH',
                    body: { revision: 1, score: changed },
                  });
                  return statement.bind(...values).all();
                },
              }),
            };
          return statement;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const result = await call(token, 'get_question', { question_id: 'q-one' });
  expect(result.isError).not.toBe(true);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_OTHER_PROJECT_GOAL');
});
