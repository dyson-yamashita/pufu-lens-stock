import { Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { vi } from 'vitest';
import { serialize } from 'node:v8';
import { createApp } from '../server/api';
import { hash } from '../server/security';
import type { Env } from '../server/env';

const migrationCache = new Map<string, Promise<string[]>>();
function migrationStatements(filename: string) {
  let statements = migrationCache.get(filename);
  if (!statements) {
    statements = readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8').then(
      (schema) =>
        schema
          .split(schema.includes('-- statement-breakpoint') ? '-- statement-breakpoint' : ';')
          .map((sql) => sql.trim())
          .filter(Boolean),
    );
    migrationCache.set(filename, statements);
  }
  return statements;
}
export async function applyMigration(DB: D1Database, filename: string) {
  await DB.batch((await migrationStatements(filename)).map((sql) => DB.prepare(sql)));
}

export async function testApp(
  options: {
    migrations?: string[];
    quotaDefaults?: boolean;
    usageMigration?: boolean;
    projectMemoryMigration?: boolean;
    projectListVisibilityMigration?: boolean;
    pufuImageLinksMigration?: boolean;
    projectQuestionSettingsMigration?: boolean;
  } = {},
) {
  const runtime = new Miniflare({
    modules: true,
    // DB初期化とRateLimitは実際のWorker内で実行する。
    script: `export default { async fetch(request, env) {
      if (new URL(request.url).pathname === '/__test/migrations') {
        for (const [filename, statements] of await request.json()) {
          try {
            await env.DB.batch(statements.map(sql => env.DB.prepare(sql)));
          } catch (error) {
            return new Response(filename + ': ' + String(error), { status: 500 });
          }
        }
        return new Response(null, { status: 204 });
      }
      return Response.json(await env.OAUTH_REGISTRATION_RATE_LIMITER.limit(await request.json()));
    } }`,
    compatibilityDate: '2026-07-30',
    d1Databases: { DB: 'test-database' },
    r2Buckets: { CONTENT: 'test-content' },
    kvNamespaces: { OAUTH_KV: 'test-oauth' },
    ratelimits: {
      OAUTH_REGISTRATION_RATE_LIMITER: {
        namespace_id: '1001',
        simple: { limit: 10, period: 60 },
      },
    },
  });
  const DB = (await runtime.getD1Database('DB')) as unknown as D1Database;
  const CONTENT = (await runtime.getR2Bucket('CONTENT')) as unknown as R2Bucket;
  const OAUTH_KV = (await runtime.getKVNamespace('OAUTH_KV')) as unknown as KVNamespace;
  const migrations = [
    ...(options.migrations ??
      (await readdir(new URL('../migrations/', import.meta.url)))
        .filter((filename) => filename.endsWith('.sql'))
        .sort()),
  ];
  // 旧スキーマからの移行テストでも、現在のAPIの利用制限基盤は有効にする。
  if (options.usageMigration !== false && !migrations.includes('0013_usage_limits.sql'))
    migrations.push('0013_usage_limits.sql');
  if (options.usageMigration !== false && !migrations.includes('0014_job_retry_limits.sql'))
    migrations.push('0014_job_retry_limits.sql');
  // 旧スキーマの機能移行テストでも、現在のAPIが参照するプロジェクト設定を用意する。
  if (
    options.projectMemoryMigration !== false &&
    !migrations.includes('0018_project_user_memory.sql')
  )
    migrations.push('0018_project_user_memory.sql');
  // 旧スキーマの移行テストでも、現在のAPIが参照する表示用タイトル列を用意する。
  if (!migrations.includes('0021_stock_titles.sql')) migrations.push('0021_stock_titles.sql');
  if (
    options.projectListVisibilityMigration !== false &&
    !migrations.includes('0024_project_list_visibility.sql')
  )
    migrations.push('0024_project_list_visibility.sql');
  if (
    options.pufuImageLinksMigration !== false &&
    !migrations.includes('0025_pufu_image_links.sql')
  )
    migrations.push('0025_pufu_image_links.sql');
  if (
    options.projectQuestionSettingsMigration !== false &&
    !migrations.includes('0027_project_question_settings.sql')
  )
    migrations.push('0027_project_question_settings.sql');
  try {
    // 各ファイルのトランザクションは維持し、各SQLのprepareを同期RPCで往復させない。
    const plan = await Promise.all(
      migrations.map(async (filename) => [filename, await migrationStatements(filename)]),
    );
    const response = await runtime.dispatchFetch('http://localhost/__test/migrations', {
      method: 'POST',
      body: JSON.stringify(plan),
    });
    if (!response.ok) throw new Error(`Test migrations failed: ${await response.text()}`);
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
  const binding = {
    create: vi.fn(async () => ({ id: 'instance' })),
    get: vi.fn(async () => ({ status: async () => ({ status: 'running' }) })),
  } as unknown as Env['ARTICLE_WORKFLOW'];
  const env: Env = {
    DB,
    CONTENT,
    OAUTH_KV,
    OAUTH_REGISTRATION_RATE_LIMITER: {
      async limit(options: RateLimitOptions): Promise<RateLimitOutcome> {
        const response = await runtime.dispatchFetch('http://localhost/', {
          method: 'POST',
          body: JSON.stringify(options),
        });
        return response.json() as Promise<RateLimitOutcome>;
      },
    },
    APP_URL: 'http://localhost:5173',
    LOCAL_DEMO_ENABLED: 'false',
    AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
    // Workflowスタブは自動完了しない。上限制御のテストだけ本番の既定同時数を使う。
    AI_CONCURRENT_JOBS: options.quotaDefaults ? undefined : '100',
    ARTICLE_WORKFLOW: binding,
    MEMORY_WORKFLOW: binding,
  };
  const background: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      background.push(promise);
    },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  await DB.batch([
    DB.prepare(
      "INSERT INTO users (id, google_sub, name, email) VALUES ('alice', 'google-alice', 'Alice', 'alice@example.com'), ('bob', 'google-bob', 'Bob', 'bob@example.com')",
    ),
    DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(
      await hash('alice-session'),
      'alice',
      new Date(Date.now() + 86400000).toISOString(),
    ),
    DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(
      await hash('bob-session'),
      'bob',
      new Date(Date.now() + 86400000).toISOString(),
    ),
    DB.prepare(
      "INSERT INTO projects (id, user_id, name) VALUES ('alice-project', 'alice', 'Alice project'), ('alice-second', 'alice', 'Second project'), ('bob-project', 'bob', 'Bob project')",
    ),
  ]);
  const app = createApp();
  const drain = async () => {
    while (background.length) await Promise.all(background.splice(0));
  };
  const request = async (
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      user?: string;
      host?: string;
    } = {},
  ) => {
    const response = await app.request(
      `${options.host ?? env.APP_URL}${path}`,
      {
        method: options.method ?? 'GET',
        headers: {
          Cookie: `stock_session=${options.user ?? 'alice'}-session`,
          Origin: env.APP_URL,
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      env,
      ctx,
    );
    await drain();
    return response;
  };
  return {
    env,
    ctx,
    request,
    dispose: async () => {
      await drain();
      await runtime.dispose();
    },
  };
}
export const mockStep = (maxResultBytes?: number) => {
  const names = new Set<string>();
  return {
    do: async (name: string, configOrOperation: unknown, operation?: () => Promise<unknown>) => {
      if (names.has(name)) throw new Error(`Duplicate step: ${name}`);
      names.add(name);
      const result = await (
        typeof configOrOperation === 'function'
          ? (configOrOperation as () => Promise<unknown>)
          : operation!
      )();
      if (maxResultBytes && serialize(result).byteLength > maxResultBytes)
        throw new Error('Workflow step result exceeds 1 MiB');
      return result;
    },
    sleep: vi.fn(async () => undefined),
  } as unknown as import('cloudflare:workers').WorkflowStep;
};
export const mockEvent = (jobId: string) =>
  ({
    payload: { jobId },
    timestamp: new Date(),
    instanceId: jobId,
  }) as import('cloudflare:workers').WorkflowEvent<{ jobId: string }>;

// 過去の移行そのものを検証した後、現在のAPIを呼ぶテスト用に後続の関連スキーマを適用する。
export async function upgradeRelationsSchema(DB: D1Database) {
  const columns = async (table: string) =>
    (await DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map(
      (row) => row.name,
    );
  if (!(await columns('questions')).includes('note'))
    await applyMigration(DB, '0028_question_notes.sql');
  if (!(await columns('comments')).length) await applyMigration(DB, '0026_comments.sql');
  if (!(await columns('pufu_scores')).includes('project_id'))
    await applyMigration(DB, '0029_independent_pufus.sql');
  if (!(await columns('questions')).includes('request_json'))
    await applyMigration(DB, '0030_multiple_relations.sql');
}
