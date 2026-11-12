import type { ProfileUsage } from '../shared/profile-usage';
import type { Env } from './env';

export async function profileUsage(env: Env, userId: string): Promise<ProfileUsage> {
  const now = new Date();
  const offset = 9 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offset);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const week = new Date(midnight - ((local.getUTCDay() + 6) % 7) * 86400000 - offset).toISOString();
  const month = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - offset,
  ).toISOString();
  const asOf = now.toISOString();
  // Only fixed source SQL is interpolated. All ownership and date values are bound.
  // Aggregate in D1 so no individual activity or generated content leaves the database.
  const sources = [
    'SELECT created_at FROM stocks WHERE user_id=?',
    'SELECT q.created_at FROM questions q JOIN projects p ON p.id=q.project_id WHERE p.user_id=?',
    'SELECT created_at FROM pufu_scores WHERE user_id=?',
  ];
  const rows = await env.DB.batch<{ week: number; month: number; all: number }>(
    sources.map((source) =>
      env.DB.prepare(
        `SELECT COALESCE(SUM(created_at>=?),0) AS week,
          COALESCE(SUM(created_at>=?),0) AS month, COUNT(*) AS "all"
        FROM (${source}) WHERE created_at<=?`,
      ).bind(week, month, userId, asOf),
    ),
  );
  const ai = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN day>=?1 THEN neurons_micros ELSE 0 END),0) AS week,
      COALESCE(SUM(CASE WHEN day>=?2 THEN neurons_micros ELSE 0 END),0) AS month,
      COALESCE(SUM(neurons_micros),0) AS "all",
      COALESCE(SUM(CASE WHEN day>=?1 THEN calls-measured_calls ELSE 0 END),0) AS week_missing,
      COALESCE(SUM(CASE WHEN day>=?2 THEN calls-measured_calls ELSE 0 END),0) AS month_missing,
      COALESCE(SUM(calls-measured_calls),0) AS all_missing
    FROM ai_usage_daily WHERE user_id=?3 AND day<=?4`,
  )
    .bind(
      new Date(Date.parse(week) + offset).toISOString().slice(0, 10),
      new Date(Date.parse(month) + offset).toISOString().slice(0, 10),
      userId,
      local.toISOString().slice(0, 10),
    )
    .first<
      Record<'week' | 'month' | 'all' | 'week_missing' | 'month_missing' | 'all_missing', number>
    >();
  const counts = (period: 'week' | 'month' | 'all') => ({
    stocks: rows[0].results[0][period],
    questions: rows[1].results[0][period],
    pufus: rows[2].results[0][period],
    ai_neurons: ai![period] / 1_000_000,
    ai_unmeasured_calls: ai![`${period}_missing`],
  });
  return {
    timezone: 'Asia/Tokyo',
    as_of: asOf,
    periods: {
      week: { since: week, ...counts('week') },
      month: { since: month, ...counts('month') },
      all: { since: null, ...counts('all') },
    },
  };
}
