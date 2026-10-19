import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigration, testApp, mockEvent, mockStep } from './helpers';
import { readdir } from 'node:fs/promises';
import { hash } from '../server/security';
import { scheduledMaintenance } from '../server/jobs';
import { ArticleWorkflow, MemoryWorkflow } from '../server/workflows';
import { AiLimitError, deferLimitedJob } from '../server/usage';
import type { Job } from '../server/env';
import { cleanupAccount } from '../server/account';
import { allMcpScopes, mcpToken, mcpTokens } from './mcp-helpers';
import worker from '../server/index';

describe('退会と登録データの削除', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  const deleteWorkflow = vi.fn(async () => undefined);
  const token = 'alice-shortcut-secret-for-deletion';
  beforeEach(async () => {
    app = await testApp();
    deleteWorkflow.mockReset();
    deleteWorkflow.mockResolvedValue(undefined);
    vi.spyOn(app.env.ARTICLE_WORKFLOW, 'get').mockResolvedValue({
      delete: deleteWorkflow,
    } as unknown as WorkflowInstance);
    for (const user of ['alice', 'bob']) {
      await app.env.DB.batch([
        app.env.DB.prepare(
          "INSERT INTO articles (id,user_id,canonical_url,source_url,title,domain,content_key,input_text,status) VALUES (?,?,?,?,'記事','example.com',?,'入力本文','ready')",
        ).bind(
          `${user}-article`,
          user,
          `https://example.com/${user}`,
          `https://example.com/${user}`,
          `${user}/article/1.txt`,
        ),
        app.env.DB.prepare(
          'INSERT INTO stocks (id,user_id,project_id,article_id,note) VALUES (?,?,?,?,?)',
        ).bind(`${user}-stock`, user, `${user}-project`, `${user}-article`, 'メモ'),
        app.env.DB.prepare(
          "INSERT INTO questions (id,stock_id,source,text,status) VALUES (?,?,'user','自分の問い','ready')",
        ).bind(`${user}-question`, `${user}-stock`),
        app.env.DB.prepare(
          "INSERT INTO pufu_scores (id,user_id,question_id,task,input_json,generated_json,score_json,editor_version,status) VALUES (?,?,?,'課題','{}','{}','{}','0.9.14','ready')",
        ).bind(`${user}-pufu`, user, `${user}-question`),
        app.env.DB.prepare(
          "INSERT INTO pufu_phases (pufu_id,number,score_json,created_at,updated_at) VALUES (?,1,'{}','2026-10-19','2026-10-19')",
        ).bind(`${user}-pufu`),
        app.env.DB.prepare(
          "INSERT INTO memories (id,user_id,revision,text,data_json,article_count,model) VALUES (?,?,0,'メモリ','{}',1,'test')",
        ).bind(`user-${user}`, user),
        app.env.DB.prepare(
          "INSERT INTO idempotency_keys (user_id,key,request_hash,stock_id) VALUES (?,'request','hash',?)",
        ).bind(user, `${user}-stock`),
        app.env.DB.prepare(
          "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision,status) VALUES (?,?,'article',?,1,'done'), (?,?,'user_memory',?,0,'running')",
        ).bind(`${user}-job`, user, `${user}-article`, `${user}-memory-job`, user, user),
        app.env.DB.prepare(
          "INSERT INTO ai_deferrals (job_id,retry_at) VALUES (?,'2099-01-01')",
        ).bind(`${user}-memory-job`),
        app.env.DB.prepare(
          "INSERT INTO ai_operations (id,user_id,kind) VALUES (?,?,'article')",
        ).bind(`${user}-job`, user),
        app.env.DB.prepare(
          'INSERT INTO ai_calls (id,job_id,user_id,status,result_json) VALUES (?,?,?,\'done\',\'{"text":"生成結果"}\')',
        ).bind(`${user}-call`, `${user}-job`, user),
        app.env.DB.prepare('INSERT INTO ai_attempts (id,user_id) VALUES (?,?)').bind(
          `${user}-attempt`,
          user,
        ),
        app.env.DB.prepare('INSERT INTO memory_requests (id,user_id) VALUES (?,?)').bind(
          `${user}-request`,
          user,
        ),
        app.env.DB.prepare('INSERT INTO job_dispatch_attempts (job_id,attempts) VALUES (?,1)').bind(
          `${user}-job`,
        ),
        app.env.DB.prepare(
          "INSERT INTO external_integrations (user_id,provider,encrypted_token) VALUES (?,'x','encrypted-test-token')",
        ).bind(user),
        app.env.DB.prepare(
          'INSERT INTO memory_sources (memory_id,article_id,source_hash) VALUES (?,?,?)',
        ).bind(`user-${user}`, `${user}-article`, 'source-hash'),
        app.env.DB.prepare(
          "INSERT INTO questions (id,project_id,source,text,status) VALUES (?,?,'user','独立した問い','ready')",
        ).bind(`${user}-independent-question`, `${user}-project`),
        app.env.DB.prepare(
          'UPDATE projects SET is_public=1,public_id=?,published_at=? WHERE id=?',
        ).bind(`public-${user}`, '2026-10-19', `${user}-project`),
      ]);
      await app.env.CONTENT.put(`${user}/article/1.txt`, '保存本文');
    }
    await app.env.CONTENT.put('alice/deleted-article/old.txt', '参照のなくなった旧本文');
    await app.env.CONTENT.put('alice-other/article/1.txt', '似たIDの別ユーザー');
    await app.env.DB.prepare(
      'INSERT INTO api_tokens (id,user_id,name,token_hash,prefix) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('alice-token', 'alice', 'iPhone', await hash(token), 'alice')
      .run();
    await app.env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
      .bind(await hash('alice-other-session'), 'alice', '2099-01-01')
      .run();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.dispose();
  });
  const remove = (headers: Record<string, string> = {}) =>
    app.request('/api/v1/me', { method: 'DELETE', headers });

  it('本人の全登録データと旧本文・Workflow状態を削除し、他ユーザーを保持する', async () => {
    const tables = [
      'users',
      'sessions',
      'api_tokens',
      'projects',
      'articles',
      'stocks',
      'questions',
      'pufu_scores',
      'pufu_phases',
      'memories',
      'idempotency_keys',
      'processing_jobs',
      'stock_usage',
      'ai_operations',
      'ai_calls',
      'ai_attempts',
      'memory_requests',
      'ai_deferrals',
      'job_dispatch_attempts',
      'external_integrations',
      'memory_sources',
    ];
    const before = await Promise.all(
      tables.map(
        async (table) => (await app.env.DB.prepare(`SELECT * FROM ${table}`).all()).results,
      ),
    );
    const response = await remove();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, cleanup_pending: false });
    expect(response.headers.get('Set-Cookie')).toContain('stock_session=;');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    for (const [index, table] of tables.entries()) {
      const remaining = (await app.env.DB.prepare(`SELECT * FROM ${table}`).all()).results;
      expect(remaining, table).toEqual(
        before[index].filter((row) => JSON.stringify(row).includes('bob')),
      );
    }
    expect((await app.env.CONTENT.list({ prefix: 'alice/' })).objects).toHaveLength(0);
    expect(await app.env.CONTENT.get('bob/article/1.txt')).not.toBeNull();
    expect(await app.env.CONTENT.get('alice-other/article/1.txt')).not.toBeNull();
    expect(deleteWorkflow).toHaveBeenCalledTimes(2);
    expect((await app.env.DB.prepare('SELECT * FROM account_deletions').all()).results).toEqual([]);
    expect((await app.env.DB.prepare('SELECT * FROM account_deletion_jobs').all()).results).toEqual(
      [],
    );
    for (const cookie of ['alice-session', 'alice-other-session'])
      expect(
        (await app.request('/api/v1/me', { headers: { Cookie: `stock_session=${cookie}` } }))
          .status,
      ).toBe(401);
    expect(
      (
        await app.request('/api/v1/projects', {
          headers: { Cookie: '', Authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(401);
    expect((await app.request('/api/v1/me', { user: 'bob' })).status).toBe(200);
    expect((await app.request('/api/public/projects/public-alice')).status).toBe(404);
    expect((await app.request('/api/public/projects/public-bob')).status).toBe(200);
    await new ArticleWorkflow(app.ctx, app.env).run(mockEvent('alice-job'), mockStep());
    await new MemoryWorkflow(app.ctx, app.env).run(mockEvent('alice-memory-job'), mockStep());
    expect(
      (await app.env.DB.prepare('SELECT * FROM articles WHERE user_id=?').bind('alice').all())
        .results,
    ).toEqual([]);
  });

  it.each([
    [{ Cookie: '' }, 401],
    [{ Origin: 'https://evil.example.com' }, 403],
    [{ Origin: '' }, 403],
    [{ Cookie: '', Authorization: `Bearer ${token}` }, 403],
  ] as const)('未認証・別Origin・Bearerからの退会を拒否する (%j)', async (headers, status) => {
    expect((await remove(headers)).status).toBe(status);
    expect((await app.request('/api/v1/me')).status).toBe(200);
    expect(await app.env.CONTENT.get('alice/article/1.txt')).not.toBeNull();
  });

  it('R2削除が失敗しても退会と認証失効を確定し、Cronで再試行する', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const content = app.env.CONTENT;
    const removeBody = vi
      .fn(content.delete.bind(content))
      .mockRejectedValueOnce(new Error('storage unavailable'));
    app.env.CONTENT = new Proxy(content, {
      get: (target, key) => (key === 'delete' ? removeBody : Reflect.get(target, key)),
    });
    const response = await remove();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, cleanup_pending: true });
    expect((await app.request('/api/v1/me')).status).toBe(401);
    expect(
      (await app.env.DB.prepare('SELECT user_id FROM account_deletions').all()).results,
    ).toEqual([{ user_id: 'alice' }]);
    await scheduledMaintenance(app.env);
    expect((await app.env.CONTENT.list({ prefix: 'alice/' })).objects).toEqual([]);
    expect((await app.env.DB.prepare('SELECT * FROM account_deletions').all()).results).toEqual([]);
    expect(await app.env.CONTENT.get('bob/article/1.txt')).not.toBeNull();
  });

  it('Workflow削除の失敗を再試行し、存在しないWorkflowも完了扱いにする', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    deleteWorkflow.mockRejectedValueOnce(new Error('workflow unavailable'));
    expect((await remove()).status).toBe(202);
    vi.mocked(app.env.ARTICLE_WORKFLOW.get).mockRejectedValue(new Error('instance.not_found'));
    await scheduledMaintenance(app.env);
    expect((await app.env.DB.prepare('SELECT * FROM account_deletions').all()).results).toEqual([]);
    expect((await app.env.CONTENT.list({ prefix: 'alice/' })).objects).toEqual([]);
  });

  it('複数ページの本文は削除要求を保持して最後まで削除する', async () => {
    await Promise.all(
      Array.from({ length: 101 }, (_, i) => app.env.CONTENT.put(`alice/orphans/${i}.txt`, '本文')),
    );
    expect((await remove()).status).toBe(202);
    expect(
      (await app.env.DB.prepare('SELECT * FROM account_deletions').all()).results,
    ).toHaveLength(1);
    await scheduledMaintenance(app.env);
    expect((await app.env.CONTENT.list({ prefix: 'alice/' })).objects).toEqual([]);
    expect((await app.env.DB.prepare('SELECT * FROM account_deletions').all()).results).toEqual([]);
  });

  it('DBで退会を確定できなかった場合はデータ・認証・本文を保持する', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await app.env.DB.prepare(
      "CREATE TRIGGER fail_deletion BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'database unavailable'); END",
    ).run();
    expect((await remove()).status).toBe(500);
    expect((await app.request('/api/v1/me')).status).toBe(200);
    expect(await app.env.CONTENT.get('alice/article/1.txt')).not.toBeNull();
    expect(deleteWorkflow).not.toHaveBeenCalled();
    expect((await app.env.DB.prepare('SELECT * FROM account_deletions').all()).results).toEqual([]);
    expect(
      (
        await app.env.DB.prepare('SELECT * FROM ai_deferrals WHERE job_id=?')
          .bind('alice-memory-job')
          .all()
      ).results,
    ).toHaveLength(1);
  });

  it('退会後に処理中のジョブが保留へ戻っても、削除した履歴を再登録しない', async () => {
    const job = await app.env.DB.prepare('SELECT * FROM processing_jobs WHERE id=?')
      .bind('alice-job')
      .first<Job>();
    await remove();
    expect(await deferLimitedJob(app.env, job!, new AiLimitError('2099-01-01'))).toBe(true);
    expect(
      (await app.env.DB.prepare('SELECT * FROM ai_deferrals WHERE job_id=?').bind(job!.id).all())
        .results,
    ).toEqual([]);
  });

  it('多数のWorkflowの削除を次のCronに引き継ぐ', async () => {
    await app.env.DB.batch(
      Array.from({ length: 12 }, (_, i) =>
        app.env.DB.prepare(
          "INSERT INTO processing_jobs (id,user_id,kind,target_id,revision) VALUES (?,'alice','cleanup','alice/orphan.txt',1)",
        ).bind(`cleanup-${i}`),
      ),
    );
    expect((await remove()).status).toBe(202);
    expect(
      (await app.env.DB.prepare('SELECT * FROM account_deletion_jobs').all()).results,
    ).toHaveLength(4);
    await scheduledMaintenance(app.env);
    expect((await app.env.DB.prepare('SELECT * FROM account_deletions').all()).results).toEqual([]);
    expect(deleteWorkflow).toHaveBeenCalledTimes(14);
  });

  it('一部の削除が失敗し続けても、後続ユーザーの削除を進める', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const content = app.env.CONTENT;
    const removeBody = vi
      .fn(content.delete.bind(content))
      .mockRejectedValueOnce(new Error('temporary failure'));
    app.env.CONTENT = new Proxy(content, {
      get: (target, key) => (key === 'delete' ? removeBody : Reflect.get(target, key)),
    });
    expect((await remove()).status).toBe(202);
    await app.env.DB.batch(
      Array.from({ length: 5 }, (_, i) =>
        app.env.DB.prepare(
          "INSERT INTO account_deletions (user_id,created_at) VALUES (?,'2000-01-01')",
        ).bind(`failed-${i}`),
      ),
    );
    const list = content.list.bind(content);
    app.env.CONTENT = new Proxy(content, {
      get: (target, key) =>
        key === 'list'
          ? (options: R2ListOptions) =>
              options.prefix?.startsWith('failed-')
                ? Promise.reject(new Error('persistent failure'))
                : list(options)
          : Reflect.get(target, key),
    });
    await scheduledMaintenance(app.env);
    expect(
      await app.env.DB.prepare(
        "SELECT user_id FROM account_deletions WHERE user_id='alice'",
      ).first(),
    ).not.toBeNull();
    await scheduledMaintenance(app.env);
    expect(
      await app.env.DB.prepare(
        "SELECT user_id FROM account_deletions WHERE user_id='alice'",
      ).first(),
    ).toBeNull();
    expect((await app.env.CONTENT.list({ prefix: 'alice/' })).objects).toEqual([]);
  });

  it('デモの再登録でIDを再利用せず、並行する旧削除処理が新しい本文を消さない', async () => {
    app.env.LOCAL_DEMO_ENABLED = 'true';
    vi.mocked(app.env.ARTICLE_WORKFLOW.get).mockResolvedValue({
      status: async () => ({ status: 'complete' }),
    } as WorkflowInstance);
    const login = await app.request('/api/auth/demo', { method: 'POST' });
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0];
    const before = (await (
      await app.request('/api/v1/me', { headers: { Cookie: cookie } })
    ).json()) as { user: { id: string } };
    await Promise.all(
      Array.from({ length: 201 }, (_, i) =>
        app.env.CONTENT.put(`${before.user.id}/old/${i}.txt`, '旧本文'),
      ),
    );
    expect((await remove({ Cookie: cookie })).status).toBe(202);
    const content = app.env.CONTENT;
    let release!: () => void;
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const list = vi.fn(content.list.bind(content)).mockImplementationOnce(async (options) => {
      reached();
      await waiting;
      return content.list(options);
    });
    app.env.CONTENT = new Proxy(content, {
      get: (target, key) => (key === 'list' ? list : Reflect.get(target, key)),
    });
    const oldCleanup = cleanupAccount(app.env, before.user.id);
    await started;
    try {
      const relogin = await app.request('/api/auth/demo', { method: 'POST' });
      expect(relogin.status).toBe(200);
      const after = (await (
        await app.request('/api/v1/me', {
          headers: { Cookie: relogin.headers.get('Set-Cookie')!.split(';')[0] },
        })
      ).json()) as { user: { id: string } };
      expect(after.user.id).not.toBe(before.user.id);
      await content.put(`${after.user.id}/new/1.txt`, '新しい本文');
      release();
      await oldCleanup;
      expect(await content.get(`${after.user.id}/new/1.txt`)).not.toBeNull();
    } finally {
      release();
      await oldCleanup;
    }
  });

  it('MCP認可とトークンも削除し、KVの一時障害時はCronから再試行できる', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const accessToken = await mcpToken(app);
    const before = await app.env.OAUTH_KV!.list({ prefix: 'grant:alice:' });
    expect(before.keys.length).toBeGreaterThan(0);
    const kv = app.env.OAUTH_KV!;
    const removeKey = vi.fn(kv.delete.bind(kv)).mockRejectedValueOnce(new Error('kv unavailable'));
    app.env.OAUTH_KV = new Proxy(kv, {
      get: (target, key) => (key === 'delete' ? removeKey : Reflect.get(target, key)),
    });
    delete app.env.OAUTH_PROVIDER;
    expect((await remove()).status).toBe(202);
    delete app.env.OAUTH_PROVIDER;
    await scheduledMaintenance(app.env);
    expect((await kv.list({ prefix: 'grant:alice:' })).keys).toEqual([]);
    expect((await kv.list({ prefix: 'token:alice:' })).keys).toEqual([]);
    expect((await app.env.DB.prepare('SELECT * FROM account_deletions').all()).results).toEqual([]);
    const response = await worker.fetch(
      new Request(`${app.env.APP_URL}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
          },
        }),
      }),
      app.env,
      app.ctx,
    );
    expect(response.status).toBe(401);
  });

  it.each([1, 2])(
    '退会と競合したMCP認可・コード交換を拒否し、後から保存された認可も削除する (%i)',
    async (pauseAt) => {
      const kv = app.env.OAUTH_KV!;
      let release!: () => void;
      let reached!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let writes = 0;
      app.env.OAUTH_KV = new Proxy(kv, {
        get: (target, key) =>
          key === 'put'
            ? async (name: string, value: string, options?: KVNamespacePutOptions) => {
                if (name.startsWith('grant:alice:') && ++writes === pauseAt) {
                  reached();
                  await held;
                }
                return kv.put(name, value, options);
              }
            : Reflect.get(target, key),
      });
      const authorizing = mcpToken(app).then(
        () => true,
        () => false,
      );
      await started;
      try {
        expect((await remove()).status).toBe(200);
        release();
        expect(await authorizing).toBe(false);
        expect((await kv.list({ prefix: 'grant:alice:' })).keys).toEqual([]);
        expect((await kv.list({ prefix: 'token:alice:' })).keys).toEqual([]);
        expect((await app.env.DB.prepare('SELECT * FROM account_deletions').all()).results).toEqual(
          [],
        );
      } finally {
        release();
        await authorizing;
      }
    },
  );

  it('退会と競合したMCPトークン更新を拒否し、削除失敗時もCronで認可を削除する', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tokens = await mcpTokens(app, null, [...allMcpScopes, 'offline_access']);
    expect(tokens.refresh_token).toBeTypeOf('string');
    const kv = app.env.OAUTH_KV!;
    let release!: () => void;
    let reached!: () => void;
    let failDelete = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    app.env.OAUTH_KV = new Proxy(kv, {
      get: (target, key) => {
        if (key === 'put')
          return async (name: string, value: string, options?: KVNamespacePutOptions) => {
            if (name.startsWith('grant:alice:')) {
              reached();
              await held;
            }
            return kv.put(name, value, options);
          };
        if (key === 'delete')
          return (name: string) => {
            if (failDelete) {
              failDelete = false;
              return Promise.reject(new Error('kv unavailable'));
            }
            return kv.delete(name);
          };
        return Reflect.get(target, key);
      },
    });
    const refreshing = worker.fetch(
      new Request(`${app.env.APP_URL}/oauth/token`, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: tokens.client_id,
          refresh_token: tokens.refresh_token!,
          resource: `${app.env.APP_URL}/mcp`,
        }),
      }),
      app.env,
      app.ctx,
    );
    await started;
    try {
      expect((await remove()).status).toBe(200);
      failDelete = true;
      release();
      const response = await refreshing;
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
      expect(
        (await app.env.DB.prepare('SELECT * FROM account_deletions').all()).results,
      ).toHaveLength(1);
      delete app.env.OAUTH_PROVIDER;
      await scheduledMaintenance(app.env);
      expect((await kv.list({ prefix: 'grant:alice:' })).keys).toEqual([]);
      expect((await kv.list({ prefix: 'token:alice:' })).keys).toEqual([]);
      expect((await app.env.DB.prepare('SELECT * FROM account_deletions').all()).results).toEqual(
        [],
      );
    } finally {
      release();
      await refreshing;
    }
  });

  it.each([false, true])(
    '並行する古い削除処理が、遅延MCP保存の新しい削除要求を消さない（要求再作成: %s）',
    async (recreate) => {
      const gate = () => {
        let resolve!: () => void;
        const promise = new Promise<void>((done) => {
          resolve = done;
        });
        return { promise, resolve };
      };
      const reachedGrant = gate(),
        releaseGrant = gate(),
        reachedDelete = gate(),
        releaseDelete = gate(),
        insertedLate = gate(),
        releaseLate = gate();
      const kv = app.env.OAUTH_KV!;
      let writes = 0,
        deleteBlocked = false,
        late = false;
      app.env.OAUTH_KV = new Proxy(kv, {
        get: (target, key) =>
          key === 'put'
            ? async (name: string, value: string, options?: KVNamespacePutOptions) => {
                if (name.startsWith('grant:alice:') && ++writes === 2) {
                  reachedGrant.resolve();
                  await releaseGrant.promise;
                }
                return kv.put(name, value, options);
              }
            : Reflect.get(target, key),
      });
      const database = app.env.DB;
      function wrap(sql: string, statement: D1PreparedStatement): D1PreparedStatement {
        return new Proxy(statement, {
          get: (target, key) => {
            if (key === 'bind') return (...args: unknown[]) => wrap(sql, target.bind(...args));
            if (
              key === 'first' &&
              sql.startsWith('DELETE FROM account_deletions') &&
              !deleteBlocked
            ) {
              deleteBlocked = true;
              return async () => {
                reachedDelete.resolve();
                await releaseDelete.promise;
                return target.first();
              };
            }
            if (key === 'run' && sql.includes('INTO account_deletions (user_id) VALUES'))
              return async () => {
                const result = await target.run();
                late = true;
                insertedLate.resolve();
                return result;
              };
            if (
              key === 'first' &&
              sql.startsWith('SELECT user_id') &&
              sql.includes('FROM account_deletions WHERE') &&
              late
            )
              return async () => {
                await releaseLate.promise;
                return target.first();
              };
            return Reflect.get(target, key);
          },
        });
      }
      app.env.DB = new Proxy(database, {
        get: (target, key) =>
          key === 'prepare'
            ? (sql: string) => wrap(sql, database.prepare(sql))
            : Reflect.get(target, key),
      });
      const authorizing = mcpToken(app).then(
        () => true,
        () => false,
      );
      await reachedGrant.promise;
      const deleting = remove();
      await reachedDelete.promise;
      try {
        if (recreate) expect(await cleanupAccount(app.env, 'alice')).toBe(true);
        releaseGrant.resolve();
        await insertedLate.promise;
        releaseDelete.resolve();
        expect((await deleting).status).toBe(202);
        releaseLate.resolve();
        expect(await authorizing).toBe(false);
        expect((await kv.list({ prefix: 'grant:alice:' })).keys).toEqual([]);
        expect((await kv.list({ prefix: 'token:alice:' })).keys).toEqual([]);
        expect((await database.prepare('SELECT * FROM account_deletions').all()).results).toEqual(
          [],
        );
      } finally {
        releaseGrant.resolve();
        releaseDelete.resolve();
        releaseLate.resolve();
        await authorizing;
        await deleting;
      }
    },
  );

  it('0021からの移行で既存データを保持する', async () => {
    await app.dispose();
    const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((name) => name.endsWith('.sql') && name < '0022')
      .sort();
    app = await testApp({ migrations });
    const users = (await app.env.DB.prepare('SELECT * FROM users').all()).results;
    const projects = (await app.env.DB.prepare('SELECT * FROM projects').all()).results;
    await applyMigration(app.env.DB, '0022_account_deletion.sql');
    expect((await app.env.DB.prepare('SELECT * FROM users').all()).results).toEqual(users);
    expect((await app.env.DB.prepare('SELECT * FROM projects').all()).results).toEqual(projects);
    expect((await app.env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });
});
