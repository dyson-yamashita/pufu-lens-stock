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

it('Workflow状態の削除が失敗したら要求を残し、次の保守で削除を完了する', async () => {
  await app.env.DB.prepare("INSERT INTO privacy_cleanup_jobs(id) VALUES ('old-user-memory')").run();
  let deleted = false;
  const remove = vi.fn(async () => {
    deleted = true;
  });
  remove.mockRejectedValueOnce(new Error('temporary failure'));
  vi.mocked(app.env.MEMORY_WORKFLOW.get).mockResolvedValue({
    delete: remove,
  } as unknown as WorkflowInstance);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await scheduledMaintenance(app.env);
  expect(deleted).toBe(false);
  expect(await app.env.DB.prepare('SELECT id FROM privacy_cleanup_jobs').first()).not.toBeNull();
  await scheduledMaintenance(app.env);
  expect(deleted).toBe(true);
  expect(await app.env.DB.prepare('SELECT id FROM privacy_cleanup_jobs').first()).toBeNull();
});
