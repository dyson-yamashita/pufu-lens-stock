import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testApp, mockStep } from './helpers';
import { scheduledMaintenance } from '../server/jobs';
import { aiStep } from '../server/usage';
import type { Job } from '../server/env';

let app: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.dispose();
});

it('移行中に終了した旧ユーザーメモリのAI結果をDBへ書き戻さない', async () => {
  await app.env.DB.prepare(
    "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision,status) VALUES ('old','alice','user_memory','alice',0,'running')",
  ).run();
  const job = (await app.env.DB.prepare(
    "SELECT * FROM processing_jobs WHERE id='old'",
  ).first<Job>())!;
  app.env.AI = { run: async () => ({}) };
  await aiStep(app.env, job, mockStep(), 'generate', async () => {
    await app.env.DB.prepare(
      "UPDATE users SET memory_revision=1,onboarding_completed_at=NULL WHERE id='alice'",
    ).run();
    return { text: 'private@example.com' };
  });
  expect(
    await app.env.DB.prepare("SELECT result_json FROM ai_calls WHERE id='old:generate'").first(
      'result_json',
    ),
  ).toBeNull();
});
it('移行中に終了した旧プ譜のAI結果もDBへ書き戻さない', async () => {
  await app.env.DB.batch([
    app.env.DB.prepare(
      "INSERT INTO pufu_scores(id,user_id,project_id,task,input_json,editor_version,status) VALUES ('old-pufu','alice','alice-project','課題','{}','0.9.19','generating')",
    ),
    app.env.DB.prepare(
      "INSERT INTO processing_jobs(id,user_id,kind,target_id,revision,status) VALUES ('old-pufu-job','alice','pufu','old-pufu',1,'running')",
    ),
  ]);
  const job = (await app.env.DB.prepare(
    "SELECT * FROM processing_jobs WHERE id='old-pufu-job'",
  ).first<Job>())!;
  app.env.AI = { run: async () => ({}) };
  await aiStep(app.env, job, mockStep(), 'generate-pufu', async () => {
    await app.env.DB.prepare(
      "UPDATE pufu_scores SET generation=2,status='failed' WHERE id='old-pufu'",
    ).run();
    return { text: 'private@example.com' };
  });
  expect(
    await app.env.DB.prepare(
      "SELECT result_json FROM ai_calls WHERE id='old-pufu-job:generate-pufu'",
    ).first('result_json'),
  ).toBeNull();
});

it.each(['user_memory', 'pufu'])(
  '%sのWorkflow状態の削除が失敗したら要求を残し、次の保守で削除を完了する',
  async (kind) => {
    await app.env.DB.prepare("INSERT INTO privacy_cleanup_jobs(id,kind) VALUES ('old-job',?)")
      .bind(kind)
      .run();
    let deleted = false;
    const remove = vi.fn(async () => {
      deleted = true;
    });
    remove.mockRejectedValueOnce(new Error('temporary failure'));
    app.env[kind === 'pufu' ? 'ARTICLE_WORKFLOW' : 'MEMORY_WORKFLOW'] = {
      get: vi.fn(async () => ({ delete: remove })),
      create: app.env.MEMORY_WORKFLOW.create,
    } as unknown as typeof app.env.MEMORY_WORKFLOW;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await scheduledMaintenance(app.env);
    expect(deleted).toBe(false);
    expect(await app.env.DB.prepare('SELECT id FROM privacy_cleanup_jobs').first()).not.toBeNull();
    await scheduledMaintenance(app.env);
    expect(deleted).toBe(true);
    expect(await app.env.DB.prepare('SELECT id FROM privacy_cleanup_jobs').first()).toBeNull();
  },
);

it.each(['instance.not_found', 'workflows.api.error.instance.not_found'])(
  '存在しないWorkflowの%sは削除済みとして要求を除去する',
  async (message) => {
    await app.env.DB.prepare(
      "INSERT INTO privacy_cleanup_jobs(id,kind) VALUES ('gone-job','user_memory')",
    ).run();
    app.env.MEMORY_WORKFLOW = {
      get: vi.fn(async () => {
        throw new Error(message);
      }),
      create: app.env.MEMORY_WORKFLOW.create,
    } as unknown as typeof app.env.MEMORY_WORKFLOW;
    await scheduledMaintenance(app.env);
    expect(await app.env.DB.prepare('SELECT id FROM privacy_cleanup_jobs').first()).toBeNull();
  },
);

it('一時失敗した要求があっても他の要求の削除を進める', async () => {
  await app.env.DB.batch([
    app.env.DB.prepare(
      "INSERT INTO privacy_cleanup_jobs(id,kind) VALUES ('bad-job','user_memory')",
    ),
    app.env.DB.prepare(
      "INSERT INTO privacy_cleanup_jobs(id,kind) VALUES ('good-job','user_memory')",
    ),
  ]);
  const remove = vi.fn(async () => {});
  app.env.MEMORY_WORKFLOW = {
    get: vi.fn(async (id: string) => {
      if (id === 'bad-job') throw new Error('temporary failure');
      return { delete: remove };
    }),
    create: app.env.MEMORY_WORKFLOW.create,
  } as unknown as typeof app.env.MEMORY_WORKFLOW;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await scheduledMaintenance(app.env);
  expect(remove).toHaveBeenCalledOnce();
  expect(
    (await app.env.DB.prepare('SELECT id FROM privacy_cleanup_jobs ORDER BY id').all()).results,
  ).toEqual([{ id: 'bad-job' }]);
});
