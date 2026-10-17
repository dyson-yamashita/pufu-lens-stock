import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { ArticleWorkflow, MemoryWorkflow } from '../server/workflows';
import { loadMemoryInputs } from '../server/memory';
import type { Job } from '../server/env';
import type { MemoryData, Project } from '../shared/domain';
import { applyMigration, mockEvent, mockStep, testApp } from './helpers';

describe('プロジェクトごとのユーザーメモリ設定', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp();
    app.env.LOCAL_DEMO_ENABLED = 'true';
  });
  afterEach(async () => app.dispose());

  const projects = async () =>
    ((await (await app.request('/api/v1/projects')).json()) as { projects: Project[] }).projects;
  async function setting(enabled: boolean, projectId = 'alice-project') {
    const response = await app.request(`/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      body: { name: projectId, include_in_user_memory: enabled },
    });
    expect(response.status).toBe(200);
  }
  async function userState() {
    return {
      revision: (await app.env.DB.prepare(
        "SELECT memory_revision FROM users WHERE id='alice'",
      ).first<{ memory_revision: number }>())!.memory_revision,
      jobs: (await app.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM processing_jobs WHERE user_id='alice' AND kind='user_memory'",
      ).first<{ count: number }>())!.count,
    };
  }
  async function execute(kind: string, target?: string) {
    const job = (await app.env.DB.prepare(
      'SELECT * FROM processing_jobs WHERE kind=? AND (? IS NULL OR target_id=?) ORDER BY revision DESC,created_at DESC LIMIT 1',
    )
      .bind(kind, target ?? null, target ?? null)
      .first<Job>())!;
    expect(job).not.toBeNull();
    const workflow =
      kind === 'article'
        ? new ArticleWorkflow(app.ctx, app.env)
        : new MemoryWorkflow(app.ctx, app.env);
    await workflow.run(mockEvent(job.id), mockStep());
    return job;
  }
  const save = (body: object) => app.request('/api/v1/stocks', { method: 'POST', body });
  const textInput = (title: string) => ({
    type: 'text',
    title,
    text: `${title}についての本文です。`,
  });
  async function memory(projectId?: string) {
    const response = await app.request(
      `/api/v1/memory${projectId ? `?project_id=${projectId}` : ''}`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as {
      memory: { article_count: number; data: MemoryData } | null;
      coverage: { ready_count: number; pending_count: number; waiting_count: number };
    };
  }

  it('初期値はオンで、オフの保存後も設定を省略した編集では維持する', async () => {
    expect((await projects()).every((project) => project.include_in_user_memory === true)).toBe(
      true,
    );
    const response = await app.request('/api/v1/projects', {
      method: 'POST',
      body: { name: '新規' },
    });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect((await projects()).find((project) => project.id === id)?.include_in_user_memory).toBe(
      true,
    );
    await setting(false, id);
    expect((await projects()).find((project) => project.id === id)?.include_in_user_memory).toBe(
      false,
    );
    expect(
      (
        await app.request(`/api/v1/projects/${id}`, {
          method: 'PATCH',
          body: { name: '名前だけ変更', description: '概要' },
        })
      ).status,
    ).toBe(200);
    expect((await projects()).find((project) => project.id === id)).toMatchObject({
      name: '名前だけ変更',
      include_in_user_memory: false,
    });
    expect(
      (
        await app.request('/api/v1/projects/bob-project', {
          method: 'PATCH',
          body: { name: '変更', include_in_user_memory: false },
        })
      ).status,
    ).toBe(404);
  });

  it('移行時に既存のプロジェクトを保持し、設定をオンで初期化する', async () => {
    await app.dispose();
    app = await testApp({
      migrations: (await readdir(new URL('../migrations/', import.meta.url)))
        .filter((filename) => filename.endsWith('.sql') && filename < '0018')
        .sort(),
      projectMemoryMigration: false,
    });
    const before = await app.env.DB.prepare('SELECT * FROM projects ORDER BY id').all();
    await applyMigration(app.env.DB, '0018_project_user_memory.sql');
    const after = await app.env.DB.prepare('SELECT * FROM projects ORDER BY id').all();
    expect(after.results).toEqual(
      before.results.map((project) => ({ ...project, include_in_user_memory: 1 })),
    );
    expect((await projects()).every((project) => project.include_in_user_memory === true)).toBe(
      true,
    );
  });

  it.each(['false', 0, null])('真偽値以外の設定を拒否する: %j', async (value) => {
    expect(
      (
        await app.request('/api/v1/projects/alice-project', {
          method: 'PATCH',
          body: { name: '変更', include_in_user_memory: value },
        })
      ).status,
    ).toBe(400);
  });

  it.each([
    { enabled: true, type: 'text' },
    { enabled: false, type: 'text' },
    { enabled: true, type: 'url' },
    { enabled: false, type: 'url' },
  ])(
    '追加と要約完了では設定に従い、プロジェクトメモリは常に更新する: $type / $enabled',
    async ({ enabled, type }) => {
      await setting(enabled);
      const before = await userState();
      const body = {
        project_id: 'alice-project',
        ...(type === 'text'
          ? textInput('設定を確認する記事')
          : {
              url: 'https://example.com/setting',
              supplemental_text: '設定を確認する記事の本文です。',
            }),
      };
      expect((await save(body)).status).toBe(202);
      const afterSave = await userState();
      expect(afterSave).toEqual({
        revision: before.revision + Number(enabled),
        jobs: before.jobs + Number(enabled),
      });
      expect((await memory()).coverage.waiting_count).toBe(Number(enabled));
      expect((await save(body)).status).toBe(200);
      expect(await userState()).toEqual(afterSave);
      const article = await execute('article');
      expect(await userState()).toEqual({
        revision: before.revision + Number(enabled) * 2,
        jobs: before.jobs + Number(enabled) * 2,
      });
      await execute('project_memory', 'alice-project');
      expect((await memory('alice-project')).memory).toMatchObject({ article_count: 1 });
      await execute('user_memory', 'alice');
      const userMemory = await memory();
      expect(userMemory.memory?.article_count).toBe(Number(enabled));
      expect(userMemory.coverage).toMatchObject({
        ready_count: Number(enabled),
        pending_count: 0,
        waiting_count: 0,
      });
      expect(JSON.stringify(userMemory.memory?.data).includes(article.target_id)).toBe(enabled);
    },
  );

  it('全プロジェクトへの保存ではオンの保存先だけをユーザーメモリへ反映する', async () => {
    await setting(false);
    const before = await userState();
    expect((await save(textInput('複数の保存先がある記事'))).status).toBe(202);
    expect((await userState()).revision).toBe(before.revision + 1);
    const article = await execute('article');
    expect((await userState()).revision).toBe(before.revision + 2);
    for (const projectId of ['alice-project', 'alice-second']) {
      await execute('project_memory', projectId);
      expect((await memory(projectId)).memory?.article_count).toBe(1);
    }
    const inputs = await loadMemoryInputs(app.env, 'alice', null);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].source).toMatchObject({
      articleId: article.target_id,
      project: 'Second project',
    });
    await execute('user_memory', 'alice');
    expect((await memory()).memory?.article_count).toBe(1);
  });

  it('別プロジェクトからの更新・手動再生成でもオフの記事を除外し、設定変更で対象を切り替える', async () => {
    await setting(false);
    expect((await save({ ...textInput('対象外の記事'), project_id: 'alice-project' })).status).toBe(
      202,
    );
    const excluded = await execute('article');
    expect((await save({ ...textInput('対象の記事'), project_id: 'alice-second' })).status).toBe(
      202,
    );
    const included = await execute('article');
    await execute('user_memory', 'alice');
    const checkIncludedOnly = async () => {
      const result = await memory();
      expect(result.memory?.article_count).toBe(1);
      expect(JSON.stringify(result.memory?.data)).toContain(included.target_id);
      expect(JSON.stringify(result.memory?.data)).not.toContain(excluded.target_id);
    };
    await checkIncludedOnly();
    expect(
      (
        await app.request('/api/v1/memory/rebuild', {
          method: 'POST',
          body: { mode: 'full', request_id: crypto.randomUUID() },
        })
      ).status,
    ).toBe(202);
    await execute('user_memory', 'alice');
    await checkIncludedOnly();
    await setting(true);
    await execute('user_memory', 'alice');
    expect((await memory()).memory?.article_count).toBe(2);
    await setting(false);
    await execute('user_memory', 'alice');
    await checkIncludedOnly();
  });

  it('要約済みの共有記事をオフの保存先に追加してもユーザーメモリの更新を要求しない', async () => {
    const body = textInput('共有する記事');
    expect((await save({ ...body, project_id: 'alice-second' })).status).toBe(202);
    await execute('article');
    await execute('user_memory', 'alice');
    await setting(false);
    await execute('user_memory', 'alice');
    const before = await userState();
    expect((await save({ ...body, project_id: 'alice-project' })).status).toBe(202);
    expect(await userState()).toEqual(before);
    await execute('project_memory', 'alice-project');
    expect((await memory('alice-project')).memory?.article_count).toBe(1);
    expect((await memory()).coverage).toMatchObject({ ready_count: 1, pending_count: 0 });
  });

  it.each([true, false])(
    '要約完了時は保存受付後に変更した設定を参照する: 初期値 %s',
    async (enabled) => {
      await setting(enabled);
      expect(
        (await save({ ...textInput('処理中に設定を変更する記事'), project_id: 'alice-project' }))
          .status,
      ).toBe(202);
      await setting(!enabled);
      const before = await userState();
      await execute('article');
      expect((await userState()).revision).toBe(before.revision + Number(!enabled));
      await execute('project_memory', 'alice-project');
      expect((await memory('alice-project')).memory?.article_count).toBe(1);
    },
  );
});
