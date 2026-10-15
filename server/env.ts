import type { User } from '../shared/domain';
import ipaddr from 'ipaddr.js';

export interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
  ARTICLE_WORKFLOW: Workflow<{ jobId: string }>;
  MEMORY_WORKFLOW: Workflow<{ jobId: string }>;
  AI?: {
    run(
      model: string,
      input: {
        messages: { role: string; content: string }[];
        max_tokens: number;
        temperature: number;
        response_format?: { type: 'json_schema'; json_schema: unknown };
      },
    ): Promise<unknown>;
  };
  BROWSER?: Fetcher;
  APP_URL: string;
  LOCAL_DEMO_ENABLED?: string;
  LOCAL_DEMO_LAN_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AI_MODEL: string;
  AI_PUFU_DAILY_LIMIT?: string;
  AI_MEMORY_DAILY_LIMIT?: string;
  AI_ARTICLE_DAILY_LIMIT?: string;
  AI_QUESTION_DAILY_LIMIT?: string;
  AI_CONCURRENT_JOBS?: string;
  AI_CALL_DAILY_LIMIT?: string;
  AI_CONCURRENT_CALLS?: string;
}
export type Principal = { user: User; kind: 'session' | 'token'; tokenProjectId: string | null };
export type AppEnv = { Bindings: Env; Variables: { principal: Principal } };
export type Job = {
  id: string;
  user_id: string;
  kind: 'article' | 'project_memory' | 'user_memory' | 'cleanup' | 'question' | 'pufu';
  target_id: string;
  revision: number;
  memory_mode?: 'incremental' | 'full';
  status: string;
};
export type JobStateGuard = { status?: string; attempts?: number; updatedAt?: string };
export const isDemo = (env: Env) =>
  env.LOCAL_DEMO_ENABLED === 'true' &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.APP_URL).hostname);
export function isDemoOrigin(env: Env, origin: string): boolean {
  if (!isDemo(env)) return false;
  let target: URL;
  try {
    target = new URL(origin);
  } catch {
    return false;
  }
  const app = new URL(env.APP_URL);
  if (target.origin !== origin || target.protocol !== app.protocol || target.port !== app.port)
    return false;
  if (['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) return true;
  return (
    env.LOCAL_DEMO_LAN_ORIGIN === target.origin &&
    ipaddr.isValid(target.hostname) &&
    ipaddr.parse(target.hostname).range() === 'private'
  );
}
