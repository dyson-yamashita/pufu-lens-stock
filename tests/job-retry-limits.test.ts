import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testApp, mockStep, mockEvent } from './helpers';
import { dispatchJobs, scheduledMaintenance } from '../server/jobs';
import { aiStep, AiLimitError, deferLimitedJob } from '../server/usage';
import type { Job } from '../server/env';
import { ArticleWorkflow, MemoryWorkflow } from '../server/workflows';
import { stopWaitingJob } from '../server/job-retries';

describe('AIジョブの再試行と待機期限', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    app = await testApp({ quotaDefaults: true });
  });
  afterEach(async () => {
    await app.dispose();
  });
  async function addJob(id: string, kind: Job['kind'] = 'pufu', ageMinutes = 0) {
    await app.env.DB.prepare(
      "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision,created_at) VALUES (?,'alice',?,?,0,?)",
    )
      .bind(
        id,
        kind,
        kind === 'user_memory' ? 'alice' : 'target',
        new Date(Date.now() - ageMinutes * 60000).toISOString(),
      )
      .run();
    return (await app.env.DB.prepare('SELECT * FROM processing_jobs WHERE id=?')
      .bind(id)
      .first<Job>())!;
  }

  it('並行dispatcherでも同時に5ジョブまで起動し、6件目は待機する', async () => {
    for (let i = 0; i < 6; i++) await addJob(`parallel-${i}`);
    await Promise.all([dispatchJobs(app.env), dispatchJobs(app.env)]);
    const counts = await app.env.DB.prepare(
      'SELECT status,COUNT(*) AS n FROM processing_jobs GROUP BY status ORDER BY status',
    ).all();
    expect(counts.results).toEqual([
      { status: 'dispatched', n: 5 },
      { status: 'pending', n: 1 },
    ]);
    expect(app.env.ARTICLE_WORKFLOW.create).toHaveBeenCalledTimes(5);
    expect(
      await app.env.DB.prepare('SELECT MAX(attempts) AS n FROM job_dispatch_attempts').first(),
    ).toEqual({ n: 1 });
  });

  it('実AI呼び出しも同時5件まで実行し、6件目は発行しない', async () => {
    app.env.AI = { run: vi.fn() };
    for (let i = 0; i < 4; i++)
      await app.env.DB.prepare(
        "INSERT INTO ai_calls (id,job_id,user_id,status) VALUES (?,?,'alice','running')",
      )
        .bind(`existing-${i}`, `existing-${i}`)
        .run();
    const fifth = await addJob('fifth');
    const sixth = await addJob('sixth');
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const running = aiStep(app.env, fifth, mockStep(), 'generate', async () => {
      entered();
      await gate;
      return { text: '5件目' };
    });
    try {
      expect(
        await Promise.race([
          started.then(() => 'started'),
          running.then(
            () => 'done',
            () => 'rejected',
          ),
        ]),
      ).toBe('started');
      const sixthCall = vi.fn(async () => ({ text: '6件目' }));
      await expect(
        aiStep(app.env, sixth, mockStep(), 'generate', sixthCall),
      ).rejects.toBeInstanceOf(AiLimitError);
      expect(sixthCall).not.toHaveBeenCalled();
    } finally {
      release();
      await running.catch(() => undefined);
    }
  });

  it('Workflowの自動再試行でも10回目のAI生成に成功できる', async () => {
    app.env.AI = { run: vi.fn() };
    const job = await addJob('tenth-ai-success');
    const step = {
      ...mockStep(),
      do: async (
        _name: string,
        config: { retries: { limit: number } },
        operation: () => Promise<unknown>,
      ) => {
        for (let retries = 0; ; retries++) {
          try {
            return await operation();
          } catch (error) {
            if (retries >= config.retries.limit) throw error;
          }
        }
      },
    } as unknown as import('cloudflare:workers').WorkflowStep;
    let calls = 0;
    expect(
      await aiStep(app.env, job, step, 'generate', async () => {
        calls++;
        if (calls < 10) throw new Error('形式エラー');
        return { text: '成功' };
      }),
    ).toEqual({ text: '成功' });
    expect(calls).toBe(10);
  });

  it('受付時のDB障害でも起動試行を待機に戻して保持する', async () => {
    const job = await addJob('admission-error');
    await app.env.DB.prepare(
      "CREATE TRIGGER fail_admission BEFORE INSERT ON ai_operations BEGIN SELECT RAISE(ABORT,'temporary_admission_error'); END",
    ).run();
    await expect(dispatchJobs(app.env)).resolves.toBeUndefined();
    expect(
      await app.env.DB.prepare('SELECT status FROM processing_jobs WHERE id=?')
        .bind(job.id)
        .first(),
    ).toEqual({ status: 'pending' });
    expect(app.env.ARTICLE_WORKFLOW.create).not.toHaveBeenCalled();
  });

  it('10回目の起動応答が失われても実行開始済みのジョブを失敗に戻さない', async () => {
    const job = await addJob('accepted-start');
    await app.env.DB.prepare('INSERT INTO job_dispatch_attempts (job_id,attempts) VALUES (?,9)')
      .bind(job.id)
      .run();
    app.env.ARTICLE_WORKFLOW.create = vi.fn(async () => {
      await app.env.DB.prepare("UPDATE processing_jobs SET status='running' WHERE id=?")
        .bind(job.id)
        .run();
      throw new Error('起動は受理されたが応答が失われた');
    }) as unknown as typeof app.env.ARTICLE_WORKFLOW.create;
    app.env.ARTICLE_WORKFLOW.get = vi.fn(async () => {
      throw new Error('状態も一時的に取得できない');
    }) as unknown as typeof app.env.ARTICLE_WORKFLOW.get;
    await dispatchJobs(app.env);
    expect(
      await app.env.DB.prepare('SELECT status FROM processing_jobs WHERE id=?')
        .bind(job.id)
        .first(),
    ).toEqual({ status: 'running' });
    expect(
      await app.env.DB.prepare('SELECT job_id FROM ai_deferrals WHERE job_id=?')
        .bind(job.id)
        .first(),
    ).toBeNull();
  });

  it.each(['article', 'user_memory'] as const)(
    '停止確定後に遅れて起動した%sはAI処理を開始しない',
    async (kind) => {
      await app.request('/api/v1/stocks', {
        method: 'POST',
        body: {
          type: 'text',
          project_id: 'alice-project',
          text: '遅れて起動する処理の確認用本文です。',
        },
      });
      const job = (await app.env.DB.prepare('SELECT * FROM processing_jobs WHERE kind=?')
        .bind(kind)
        .first<Job>())!;
      if (kind === 'user_memory')
        await app.env.DB.prepare("UPDATE articles SET status='ready',summary_json=?")
          .bind(JSON.stringify({ overview: '確認', keyPoints: ['確認'], topics: ['確認'] }))
          .run();
      await app.env.DB.batch([
        app.env.DB.prepare("UPDATE processing_jobs SET status='pending' WHERE id=?").bind(job.id),
        app.env.DB.prepare('UPDATE job_dispatch_attempts SET attempts=9 WHERE job_id=?').bind(
          job.id,
        ),
      ]);
      app.env.ARTICLE_WORKFLOW.create = vi.fn(async () => {
        throw new Error('起動応答の喪失');
      }) as unknown as typeof app.env.ARTICLE_WORKFLOW.create;
      app.env.ARTICLE_WORKFLOW.get = vi.fn(async () => {
        throw new Error('状態の取得失敗');
      }) as unknown as typeof app.env.ARTICLE_WORKFLOW.get;
      await dispatchJobs(app.env);
      expect(
        await app.env.DB.prepare('SELECT status FROM processing_jobs WHERE id=?')
          .bind(job.id)
          .first(),
      ).toEqual({ status: 'failed' });
      const run = vi.fn(async () => ({
        response: JSON.stringify({
          overview: '確認',
          keyPoints: ['確認'],
          topics: ['確認'],
          interests: ['確認'],
          knowledge: [],
          questions: [],
        }),
      }));
      app.env.AI = { run };
      const Workflow = kind === 'article' ? ArticleWorkflow : MemoryWorkflow;
      await new Workflow(app.ctx, app.env).run(mockEvent(job.id), mockStep());
      expect(run).not.toHaveBeenCalled();
      expect(
        await app.env.DB.prepare('SELECT status FROM processing_jobs WHERE id=?')
          .bind(job.id)
          .first(),
      ).toEqual({ status: 'failed' });
    },
  );

  it('保留表示の更新が期限切れと競合しても失敗状態と再試行操作を維持する', async () => {
    const saved = await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { type: 'text', project_id: 'alice-project', text: '期限切れの競合確認用の記事です。' },
    });
    const { id } = (await saved.json()) as { id: string };
    const job = (await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='article'",
    ).first<Job>())!;
    const database = app.env.DB;
    let batches = 0;
    app.env.DB = new Proxy(database, {
      get(target, key) {
        if (key === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            if (++batches === 2) {
              await database
                .prepare('UPDATE processing_jobs SET created_at=? WHERE id=?')
                .bind(new Date(Date.now() - 1800000).toISOString(), job.id)
                .run();
              await dispatchJobs(app.env);
            }
            return database.batch(statements);
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await deferLimitedJob(
      app.env,
      job,
      new AiLimitError(new Date(Date.now() + 86400000).toISOString()),
    );
    expect(
      await database.prepare('SELECT status FROM processing_jobs WHERE id=?').bind(job.id).first(),
    ).toEqual({ status: 'failed' });
    expect(
      await database.prepare('SELECT status FROM articles WHERE id=?').bind(job.target_id).first(),
    ).toEqual({ status: 'failed' });
    expect((await app.request(`/api/v1/stocks/${id}/retry`, { method: 'POST' })).status).toBe(202);
  });

  it('期限判定の直後に開始した記事処理を停止更新で上書きしない', async () => {
    await app.request('/api/v1/stocks', {
      method: 'POST',
      body: {
        type: 'text',
        project_id: 'alice-project',
        text: '期限判定と実行開始の競合確認用本文です。',
      },
    });
    const job = (await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='article'",
    ).first<Job>())!;
    await app.env.DB.prepare("UPDATE processing_jobs SET status='pending',created_at=? WHERE id=?")
      .bind(new Date(Date.now() - 1800000).toISOString(), job.id)
      .run();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    app.env.AI = {
      run: vi.fn(async () => {
        entered();
        await gate;
        return {
          response: JSON.stringify({ overview: '確認', keyPoints: ['確認'], topics: ['確認'] }),
        };
      }),
    };
    const database = app.env.DB;
    let intercept = true;
    let workflow: Promise<void> | undefined;
    app.env.DB = new Proxy(database, {
      get(target, key) {
        if (key === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            if (intercept) {
              intercept = false;
              workflow = new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job.id), mockStep());
              await started;
            }
            return database.batch(statements);
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      expect(await stopWaitingJob(app.env, job)).toBe(false);
      expect(
        await database
          .prepare('SELECT status FROM processing_jobs WHERE id=?')
          .bind(job.id)
          .first(),
      ).toEqual({ status: 'running' });
      expect(
        await database
          .prepare('SELECT status FROM articles WHERE id=?')
          .bind(job.target_id)
          .first(),
      ).toEqual({ status: 'summarizing' });
    } finally {
      release();
      await workflow;
    }
  });

  it('並行Cronの古い完了確認で10回目の実行を待機・失敗へ戻さない', async () => {
    await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { type: 'text', project_id: 'alice-project', text: '並行Cronの競合確認用本文です。' },
    });
    const job = (await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='article'",
    ).first<Job>())!;
    await app.env.DB.batch([
      app.env.DB.prepare(
        "UPDATE processing_jobs SET status='running',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 minutes') WHERE id=?",
      ).bind(job.id),
      app.env.DB.prepare('UPDATE job_dispatch_attempts SET attempts=9 WHERE job_id=?').bind(job.id),
    ]);
    let releaseAi!: () => void;
    let aiStarted!: () => void;
    let releaseFirst!: () => void;
    let firstReading!: () => void;
    const aiGate = new Promise<void>((resolve) => {
      releaseAi = resolve;
    });
    const enteredAi = new Promise<void>((resolve) => {
      aiStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const enteredFirst = new Promise<void>((resolve) => {
      firstReading = resolve;
    });
    app.env.AI = {
      run: vi.fn(async () => {
        aiStarted();
        await aiGate;
        return {
          response: JSON.stringify({ overview: '確認', keyPoints: ['確認'], topics: ['確認'] }),
        };
      }),
    };
    let workflow: Promise<void> | undefined;
    const restart = async () => {
      workflow = new ArticleWorkflow(app.ctx, app.env).run(mockEvent(job.id), mockStep());
      await enteredAi;
    };
    app.env.ARTICLE_WORKFLOW.create = vi.fn(async (input: { id: string }) => {
      if (input.id === job.id) throw new Error('既存Workflow');
      return { id: input.id };
    }) as unknown as typeof app.env.ARTICLE_WORKFLOW.create;
    let reads = 0;
    app.env.ARTICLE_WORKFLOW.get = vi.fn(async () => {
      if (++reads === 1) {
        firstReading();
        await firstGate;
      }
      return { status: async () => ({ status: 'complete' }), restart };
    }) as unknown as typeof app.env.ARTICLE_WORKFLOW.get;
    const first = scheduledMaintenance(app.env);
    await enteredFirst;
    try {
      await scheduledMaintenance(app.env);
      releaseFirst();
      await first;
      expect(
        await app.env.DB.prepare('SELECT status FROM processing_jobs WHERE id=?')
          .bind(job.id)
          .first(),
      ).toEqual({ status: 'running' });
      expect(
        await app.env.DB.prepare('SELECT status FROM articles WHERE id=?')
          .bind(job.target_id)
          .first(),
      ).toEqual({ status: 'summarizing' });
    } finally {
      releaseFirst();
      releaseAi();
      await first;
      await workflow;
    }
  });

  it.each(['起動失敗', '利用枠不足', 'cleanup起動失敗'])(
    '%sが続いても10試行で停止する',
    async (reason) => {
      const job = await addJob('retry-budget', reason === 'cleanup起動失敗' ? 'cleanup' : 'pufu');
      if (reason === '利用枠不足') {
        app.env.AI_CONCURRENT_JOBS = '1';
        await addJob('occupied');
        await app.env.DB.batch([
          app.env.DB.prepare("UPDATE processing_jobs SET status='running' WHERE id='occupied'"),
          app.env.DB.prepare(
            "INSERT INTO ai_operations (id,user_id,kind) VALUES ('occupied','alice','pufu')",
          ),
        ]);
      } else {
        app.env.ARTICLE_WORKFLOW.create = vi.fn(async () => {
          throw new Error('起動できない');
        }) as unknown as typeof app.env.ARTICLE_WORKFLOW.create;
        app.env.ARTICLE_WORKFLOW.get = vi.fn(async () => {
          throw new Error('存在しない');
        }) as unknown as typeof app.env.ARTICLE_WORKFLOW.get;
      }
      for (let i = 1; i <= 10; i++) {
        await dispatchJobs(app.env);
        expect(
          await app.env.DB.prepare('SELECT status FROM processing_jobs WHERE id=?')
            .bind(job.id)
            .first(),
        ).toEqual({ status: i === 10 ? 'failed' : 'pending' });
        await app.env.DB.prepare(
          "UPDATE ai_deferrals SET retry_at='2000-01-01T00:00:00.000Z'",
        ).run();
      }
      await dispatchJobs(app.env);
      expect(
        await app.env.DB.prepare('SELECT status,error FROM processing_jobs WHERE id=?')
          .bind(job.id)
          .first(),
      ).toMatchObject({ status: 'failed', error: expect.stringContaining('10') });
      if (reason !== '利用枠不足')
        expect(app.env.ARTICLE_WORKFLOW.create).toHaveBeenCalledTimes(10);
    },
  );

  it.each([
    { age: 29, future: false, status: 'dispatched' },
    { age: 30, future: false, status: 'failed' },
    { age: 30, future: true, status: 'failed' },
  ])('受付から $age 分、未来の保留=$future → $status', async ({ age, future, status }) => {
    const job = await addJob('deadline', 'pufu', age);
    if (future)
      await app.env.DB.prepare('INSERT INTO ai_deferrals (job_id,retry_at) VALUES (?,?)')
        .bind(job.id, new Date(Date.now() + 86400000).toISOString())
        .run();
    await dispatchJobs(app.env);
    expect(
      await app.env.DB.prepare('SELECT status FROM processing_jobs WHERE id=?')
        .bind(job.id)
        .first(),
    ).toEqual({ status });
    if (status === 'failed') {
      expect(app.env.ARTICLE_WORKFLOW.create).not.toHaveBeenCalled();
      expect(
        await app.env.DB.prepare('SELECT error FROM processing_jobs WHERE id=?')
          .bind(job.id)
          .first(),
      ).toEqual({ error: expect.stringContaining('30分') });
    }
  });

  it('Workflow内で利用枠を待つ場合も30分で停止し、記事に失敗理由を表示する', async () => {
    await app.request('/api/v1/stocks', {
      method: 'POST',
      body: { type: 'text', project_id: 'alice-project', text: '期限確認用の記事です。' },
    });
    const job = (await app.env.DB.prepare(
      "SELECT * FROM processing_jobs WHERE kind='article'",
    ).first<Job>())!;
    await app.env.DB.prepare("UPDATE processing_jobs SET status='running',created_at=? WHERE id=?")
      .bind(new Date(Date.now() - 1800000).toISOString(), job.id)
      .run();
    expect(
      await deferLimitedJob(
        app.env,
        job,
        new AiLimitError(new Date(Date.now() + 86400000).toISOString()),
      ),
    ).toBe(true);
    expect(
      await app.env.DB.prepare('SELECT status,error FROM processing_jobs WHERE id=?')
        .bind(job.id)
        .first(),
    ).toMatchObject({ status: 'failed', error: expect.stringContaining('30分') });
    expect(
      await app.env.DB.prepare('SELECT status,error FROM articles WHERE id=?')
        .bind(job.target_id)
        .first(),
    ).toMatchObject({ status: 'failed', error: expect.stringContaining('30分') });
  });

  it('30分を超えても実行中のジョブを期限だけで停止しない', async () => {
    const job = await addJob('still-running', 'pufu', 31);
    await app.env.DB.prepare("UPDATE processing_jobs SET status='running' WHERE id=?")
      .bind(job.id)
      .run();
    await scheduledMaintenance(app.env);
    expect(
      await app.env.DB.prepare('SELECT status FROM processing_jobs WHERE id=?')
        .bind(job.id)
        .first(),
    ).toEqual({ status: 'running' });
  });

  it.each([
    { age: 29, status: 'dispatched' },
    { age: 30, status: 'failed' },
  ])('Workflowの起動待ちは10回目でも $age 分では $status', async ({ age, status }) => {
    const job = await addJob('queued-workflow', 'pufu', age);
    await app.env.DB.batch([
      app.env.DB.prepare(
        "UPDATE processing_jobs SET status='dispatched',updated_at=created_at WHERE id=?",
      ).bind(job.id),
      app.env.DB.prepare('INSERT INTO job_dispatch_attempts (job_id,attempts) VALUES (?,10)').bind(
        job.id,
      ),
    ]);
    app.env.ARTICLE_WORKFLOW.get = vi.fn(async () => ({
      status: async () => ({ status: 'queued' }),
    })) as unknown as typeof app.env.ARTICLE_WORKFLOW.get;
    await scheduledMaintenance(app.env);
    expect(
      await app.env.DB.prepare('SELECT status FROM processing_jobs WHERE id=?')
        .bind(job.id)
        .first(),
    ).toEqual({ status });
    expect(app.env.ARTICLE_WORKFLOW.create).not.toHaveBeenCalled();
  });

  it.each(['complete', 'errored'])(
    'Workflowが%sのままでも10回で回復処理を打ち切る',
    async (status) => {
      const job = await addJob('workflow-recovery', status === 'errored' ? 'cleanup' : 'pufu');
      const restart = vi.fn(async () => undefined);
      app.env.ARTICLE_WORKFLOW.create = vi
        .fn()
        .mockResolvedValueOnce({ id: job.id })
        .mockRejectedValue(
          new Error('同じIDのWorkflowが存在する'),
        ) as unknown as typeof app.env.ARTICLE_WORKFLOW.create;
      app.env.ARTICLE_WORKFLOW.get = vi.fn(async () => ({
        status: async () => ({ status }),
        restart,
      })) as unknown as typeof app.env.ARTICLE_WORKFLOW.get;
      await dispatchJobs(app.env);
      for (let i = 0; i < 10; i++) {
        await app.env.DB.prepare(
          "UPDATE processing_jobs SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 minutes') WHERE id=?",
        )
          .bind(job.id)
          .run();
        await scheduledMaintenance(app.env);
      }
      expect(
        await app.env.DB.prepare('SELECT status FROM processing_jobs WHERE id=?')
          .bind(job.id)
          .first(),
      ).toEqual({ status: 'failed' });
      expect(app.env.ARTICLE_WORKFLOW.create).toHaveBeenCalledTimes(10);
      expect(restart).toHaveBeenCalledTimes(9);
      await scheduledMaintenance(app.env);
      expect(restart).toHaveBeenCalledTimes(9);
    },
  );
});
