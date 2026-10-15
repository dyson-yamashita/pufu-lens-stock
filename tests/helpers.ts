import { Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { vi } from 'vitest';
import { serialize } from 'node:v8';
import { createApp } from '../server/api';
import { hash } from '../server/security';
import type { Env } from '../server/env';

export async function applyMigration(DB: D1Database, filename: string) {
  const schema = await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8');
  await DB.batch(
    schema
      .split(schema.includes('-- statement-breakpoint') ? '-- statement-breakpoint' : ';')
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => DB.prepare(sql)),
  );
}

export async function testApp(
  options: { migrations?: string[]; quotaDefaults?: boolean; usageMigration?: boolean } = {},
) {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("test"); } }',
    compatibilityDate: '2026-07-30',
    d1Databases: { DB: 'test-database' },
    r2Buckets: { CONTENT: 'test-content' },
    kvNamespaces: { OAUTH_KV: 'test-oauth' },
  });
  const DB = (await runtime.getD1Database('DB')) as unknown as D1Database;
  const CONTENT = (await runtime.getR2Bucket('CONTENT')) as unknown as R2Bucket;
  const OAUTH_KV = (await runtime.getKVNamespace('OAUTH_KV')) as unknown as KVNamespace;
  const migrations =
    options.migrations ??
    (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((filename) => filename.endsWith('.sql'))
      .sort();
  for (const filename of migrations) await applyMigration(DB, filename);
  // 旧スキーマからの移行テストでも、現在のAPIの利用制限基盤は有効にする。
  if (options.usageMigration !== false && !migrations.includes('0013_usage_limits.sql'))
    await applyMigration(DB, '0013_usage_limits.sql');
  if (options.usageMigration !== false && !migrations.includes('0014_job_retry_limits.sql'))
    await applyMigration(DB, '0014_job_retry_limits.sql');
  const binding = {
    create: vi.fn(async () => ({ id: 'instance' })),
    get: vi.fn(async () => ({ status: async () => ({ status: 'running' }) })),
  } as unknown as Env['ARTICLE_WORKFLOW'];
  const env: Env = {
    DB,
    CONTENT,
    OAUTH_KV,
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
