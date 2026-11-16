import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../../env';
import { retryAt } from '../../features/usage/usage';
import { logDiagnosticError } from '../../infrastructure/diagnostics';

export function registerApiErrors(app: Hono<AppEnv>) {
  app.notFound((c) => c.json({ error: '見つかりません。' }, 404));

  app.onError(async (error, c) => {
    const errorDetail = `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}`;
    if (errorDetail.includes('linked_project_move'))
      return c.json(
        {
          error:
            '複数のデータと関連しているため移動できません。関連を解除してから移動してください。',
        },
        409,
      );
    const stockLimit = errorDetail.includes('stock_quota');
    if (stockLimit || errorDetail.includes('ai_quota')) {
      const at = await retryAt(
        c.env,
        c.get('principal').user.id,
        stockLimit
          ? 'stock'
          : c.req.path.includes('/pufus')
            ? 'pufu'
            : c.req.path.includes('/memory/')
              ? 'user_memory'
              : c.req.path.includes('/question/')
                ? 'question'
                : 'article',
      );
      c.header('Retry-After', String(Math.max(1, Math.ceil((Date.parse(at) - Date.now()) / 1000))));
      return c.json(
        {
          error: stockLimit
            ? '直近24時間の保存上限（200件）に達しました。ストックを削除しても利用件数は減りません。'
            : 'AI処理の利用上限または同時処理数に達しました。処理中の完了を待つか、再試行時刻以降にお試しください。',
          retry_at: at,
        },
        429,
      );
    }
    if (error instanceof HTTPException)
      return c.json({ error: error.message || 'リクエストを確認してください。' }, error.status);
    logDiagnosticError('api_request', error);
    return c.json({ error: '処理に失敗しました。時間をおいて再度お試しください。' }, 500);
  });
}
