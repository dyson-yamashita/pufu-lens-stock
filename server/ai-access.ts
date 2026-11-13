import type { Env } from './env';

export async function requireRegisteredAiUser(env: Env, userId: string): Promise<void> {
  const user = await env.DB.prepare(
    'SELECT id FROM users WHERE id=? AND onboarding_completed_at IS NOT NULL',
  )
    .bind(userId)
    .first();
  if (!user) throw new Error('AIの利用にはニックネームの登録と規約への同意が必要です。');
}
