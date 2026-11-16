import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { onboardingSchema, profileSchema, type User } from '../../../shared/domain';
import type { AppEnv } from '../../env';
import { isDemoOrigin } from '../../env';
import { cleanupAccount, requestAccountDeletion } from '../../features/auth/account';
import { clearSessionCookies, logout } from '../../features/auth/auth';
import { profileUsage } from '../../features/usage/profile-usage';
import { now } from '../../infrastructure/db';
import { observeOperation } from '../../infrastructure/diagnostics';
import { dispatchJobs } from '../../infrastructure/jobs/jobs';
import { consumeMcpLogin } from '../../mcp/login';
import { body } from '../validation';

export function registerAccountRoutes(app: Hono<AppEnv>) {
  app.get('/api/v1/me', (c) =>
    c.json({ user: c.get('principal').user, demo: isDemoOrigin(c.env, new URL(c.req.url).origin) }),
  );

  app.get('/api/v1/me/usage', async (c) => {
    const principal = c.get('principal');
    if (principal.kind !== 'session') throw new HTTPException(403);
    c.header('Cache-Control', 'no-store');
    return c.json(await profileUsage(c.env, principal.user.id));
  });

  app.post('/api/v1/onboarding', async (c) => {
    const principal = c.get('principal');
    if (principal.kind !== 'session') throw new HTTPException(403);
    const input = await body(c, onboardingSchema);
    const registered = await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE users SET name=?,language=COALESCE(?,language),onboarding_completed_at=?,terms_version=?,privacy_version=?,memory_revision=memory_revision+1 WHERE id=? AND onboarding_completed_at IS NULL',
      ).bind(
        input.name,
        input.language ?? null,
        now(),
        input.terms_version,
        input.privacy_version,
        principal.user.id,
      ),
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO processing_jobs(id,user_id,kind,target_id,revision) SELECT 'um-'||id||'-'||memory_revision,id,'user_memory',id,memory_revision FROM users WHERE id=? AND changes()=1 AND EXISTS(SELECT 1 FROM stocks WHERE user_id=users.id)",
      ).bind(principal.user.id),
    ]);
    const user = await c.env.DB.prepare(
      'SELECT id,name,bio,language,avatar_url,onboarding_completed_at FROM users WHERE id=?',
    )
      .bind(principal.user.id)
      .first<User>();
    if (!user) throw new HTTPException(401);
    if (registered[1].meta.changes)
      c.executionCtx.waitUntil(
        observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
      );
    return c.json({ user, redirect_to: await consumeMcpLogin(c) });
  });

  app.patch('/api/v1/me', async (c) => {
    const data = await body(c, profileSchema);
    const userId = c.get('principal').user.id;
    // 更新前の自己紹介を比較し、処理要求とプロフィール・世代を同時に確定する。
    const [queued, updated] = await c.env.DB.batch<User>([
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO processing_jobs (id, user_id, kind, target_id, revision, language) SELECT 'um-' || id || '-' || (memory_revision + 1), id, 'user_memory', id, memory_revision + 1, COALESCE(?,language) FROM users WHERE id = ? AND bio <> ?",
      ).bind(data.language ?? null, userId, data.bio),
      c.env.DB.prepare(
        'UPDATE users SET name = ?, language = COALESCE(?,language), memory_revision = memory_revision + CASE WHEN bio <> ? THEN 1 ELSE 0 END, bio = ? WHERE id = ? RETURNING id, name, bio, language, onboarding_completed_at, avatar_url',
      ).bind(data.name, data.language ?? null, data.bio, data.bio, userId),
    ]);
    const user = updated.results[0];
    if (!user) throw new HTTPException(401, { message: 'ログインが必要です。' });
    if (queued.meta.changes)
      c.executionCtx.waitUntil(
        observeOperation('background', 'dispatch_jobs', () => dispatchJobs(c.env)),
      );
    return c.json({ user });
  });

  app.post('/api/v1/logout', logout);

  app.delete('/api/v1/me', async (c) => {
    const userId = c.get('principal').user.id;
    await requestAccountDeletion(c.env, userId);
    clearSessionCookies(c);
    const complete = await cleanupAccount(c.env, userId);
    return c.json({ ok: true, cleanup_pending: !complete }, complete ? 200 : 202);
  });
}
