import { AsyncLocalStorage } from 'node:async_hooks';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env';

type DiagnosticContext = { request_id: string; route: string; method?: string };
const context = new AsyncLocalStorage<DiagnosticContext>();
type Phase = 'd1' | 'background' | 'scheduled';
export type Operation =
  | 'stocks_keyword'
  | 'questions_list'
  | 'dispatch_jobs'
  | 'cleanup_stock_images'
  | 'scheduled_maintenance'
  | 'dispatch_superseded'
  | 'dispatch_expired'
  | 'dispatch_pending'
  | 'workflow_dispatch'
  | 'search_index_maintenance'
  | 'pufu_image_link_cleanup'
  | 'api_request'
  | 'worker_request'
  | 'mcp_tool';

// Only fixed route templates leave this module. Never copy query strings, IDs or tokens.
export function diagnosticRoute(url: string): string {
  const path = new URL(url).pathname;
  if (
    [
      '/api/config',
      '/mcp',
      '/api/auth/google',
      '/api/auth/google/callback',
      '/api/auth/demo',
    ].includes(path)
  )
    return path;
  const match =
    /^\/api\/v1\/(stocks|questions|projects|pufus|memory|comments|me|tokens|articles)(?:\/([^/]+))?(?:\/(content|images|retry|pufus|history|phases))?$/.exec(
      path,
    );
  if (match) return `/api/v1/${match[1]}${match[2] ? '/:id' : ''}${match[3] ? `/${match[3]}` : ''}`;
  return '/other';
}

// Arbitrary messages, names, filenames and function names can contain customer data.
// Keep only known classifications and numeric stack coordinates, not raw error text.
export function diagnosticError(error: unknown, depth = 0): object {
  if (depth >= 3) return { kind: 'truncated' };
  try {
    if (!(error instanceof Error)) return { kind: 'non_error' };
    const message = error.message;
    const kind =
      message === 'Network connection lost.'
        ? 'network_connection_lost'
        : message === 'D1_ERROR: Network connection lost.'
          ? 'd1_network_connection_lost'
          : message.startsWith('D1_ERROR:')
            ? 'd1_error'
            : 'redacted';
    const rawName = error.name;
    const name = ['Error', 'TypeError', 'RangeError', 'AbortError', 'TimeoutError'].includes(
      rawName,
    )
      ? rawName
      : 'Error';
    const stack =
      typeof error.stack === 'string'
        ? error.stack
            .slice(0, 8192)
            .split('\n')
            .slice(1, 9)
            .flatMap((line) => {
              const match = /^\s+at .+:(\d{1,7}):(\d{1,7})\)?$/.exec(line);
              return match ? [{ line: Number(match[1]), column: Number(match[2]) }] : [];
            })
        : [];
    return {
      name,
      kind,
      stack,
      ...(error.cause !== undefined ? { cause: diagnosticError(error.cause, depth + 1) } : {}),
    };
  } catch {
    return { kind: 'unreadable' };
  }
}

function emit(event: string, fields: object, failed = false) {
  // Logging must never replace the original response or exception.
  try {
    const record = { event, ...context.getStore(), ...fields };
    if (failed) console.error(record);
    else console.info(record);
  } catch {
    /* Preserve application behavior if the logging sink fails. */
  }
}
export function logDiagnosticError(operation: Operation, error: unknown) {
  emit('operation_failed', { operation, error: diagnosticError(error) }, true);
}

export function requestDiagnostics(layer: 'worker' | 'api'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const parent = context.getStore();
    const state = {
      request_id: parent?.request_id ?? crypto.randomUUID(),
      route: diagnosticRoute(c.req.url),
      method: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'].includes(c.req.method)
        ? c.req.method
        : 'OTHER',
    };
    await context.run(state, async () => {
      const started = Date.now();
      try {
        await next();
        // This means response headers were produced, not that the body reached the client.
        emit('http_response_ready', {
          layer,
          status: c.res.status,
          duration_ms: Date.now() - started,
        });
      } catch (error) {
        logDiagnosticError(layer === 'api' ? 'api_request' : 'worker_request', error);
        throw error;
      }
    });
  };
}

function attempts(result: unknown): number[] {
  try {
    return readAttempts(result);
  } catch {
    return [];
  }
}
function readAttempts(result: unknown): number[] {
  const rows = Array.isArray(result) ? result : [result];
  return rows.slice(0, 32).flatMap((row: unknown) => {
    if (!row || typeof row !== 'object' || !('meta' in row)) return [];
    const meta = row.meta;
    if (!meta || typeof meta !== 'object' || !('total_attempts' in meta)) return [];
    const count = meta.total_attempts;
    return typeof count === 'number' && Number.isSafeInteger(count) && count > 0 ? [count] : [];
  });
}
export async function observeOperation<T>(
  phase: Phase,
  operation: Operation,
  work: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await work();
    emit('operation_completed', {
      phase,
      operation,
      duration_ms: Date.now() - started,
      ...(phase === 'd1' ? { total_attempts: attempts(result) } : {}),
    });
    return result;
  } catch (error) {
    emit(
      'operation_failed',
      { phase, operation, duration_ms: Date.now() - started, error: diagnosticError(error) },
      true,
    );
    throw error;
  }
}
export function scheduledDiagnostics<T>(work: () => Promise<T>): Promise<T> {
  return context.run({ request_id: crypto.randomUUID(), route: 'scheduled' }, () =>
    observeOperation('scheduled', 'scheduled_maintenance', work),
  );
}
