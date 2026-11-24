import {
  reflectionPeriodEnd,
  reflectionPeriods,
  type Reflection,
  type ReflectionList,
} from '../../../shared/reflections';
import type { Env } from '../../env';
import { projectListFilter } from '../projects/project-access';
import { firstPhaseTaskColumn } from '../pufu/pufu-title';

// 要約前のテキストや、メモだけがあるURLも振り返りの資料にできる。
export const usableReflectionStock = `a.user_id=s.user_id AND (
  TRIM(s.note,char(9,10,13,32,160,12288))<>'' OR (a.status='ready' AND json_valid(a.summary_json))
  OR TRIM(a.input_text,char(9,10,13,32,160,12288))<>''
)`;
export const reflectionRegenerationJobPrefix = 'reflection-regeneration-';

export function reflectionJobStatement(env: Env, reflectionId: string | null) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO processing_jobs (id,user_id,kind,purpose,target_id,revision)
    SELECT (CASE WHEN r.generation>1 THEN '${reflectionRegenerationJobPrefix}' ELSE 'reflection-' END)
      ||r.id||'-'||r.generation,p.user_id,'question','reflection',r.id,r.generation
    FROM reflections r JOIN projects p ON p.id=r.project_id
    WHERE r.status='queued' AND (?1 IS NULL OR r.id=?1)`,
  ).bind(reflectionId);
}

export async function queueDueReflections(env: Env, at: number) {
  const ends = Object.fromEntries(
    reflectionPeriods.map((period) => [
      period,
      new Date(reflectionPeriodEnd(at, period)).toISOString(),
    ]),
  );
  const previous = `SELECT MAX(r.end_at) FROM reflections r
    WHERE r.project_id=p.id`;
  await env.DB.batch([
    env.DB.prepare(
      `WITH due AS (
        SELECT p.id,p.user_id,period.value AS cutoff,
          COALESCE((${previous} AND r.text IS NOT NULL),'') AS since,
          COALESCE((${previous} AND r.status='empty' AND r.text IS NULL
            AND r.source_revision=p.memory_revision),'') AS last_empty
        FROM projects p JOIN users u ON u.id=p.user_id
        JOIN json_each(?1) period ON period.key=p.reflection_period
        WHERE p.auto_generate_questions=1 AND u.onboarding_completed_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM reflections r WHERE r.project_id=p.id
            AND (r.status='queued' OR r.end_at>=period.value)
          )
      )
      INSERT OR IGNORE INTO reflections(id,project_id,start_at,end_at)
      SELECT lower(hex(randomblob(16))),d.id,
        COALESCE(NULLIF(d.since,''),(
          SELECT MIN(s.created_at) FROM stocks s WHERE s.project_id=d.id AND s.user_id=d.user_id
        )),d.cutoff
      FROM due d
      WHERE EXISTS (
        SELECT 1 FROM stocks s JOIN articles a ON a.id=s.article_id
        WHERE s.project_id=d.id AND s.user_id=d.user_id AND s.created_at>=d.since
          AND s.created_at<d.cutoff AND ${usableReflectionStock}
        LIMIT 1 OFFSET 2
      ) AND EXISTS (
        SELECT 1 FROM stocks s JOIN articles a ON a.id=s.article_id
        WHERE s.project_id=d.id AND s.user_id=d.user_id AND s.created_at>=d.since AND s.created_at<d.cutoff
          AND s.created_at>=d.last_empty
          AND ${usableReflectionStock}
      )
      ORDER BY d.id LIMIT 20`,
    ).bind(JSON.stringify(ends)),
    reflectionJobStatement(env, null),
  ]);
}

export async function listReflections(
  env: Env,
  userId: string,
  projectId: string | null,
  page: number,
): Promise<ReflectionList> {
  const scope = projectListFilter(projectId, null);
  const limit = 8;
  const rows = await env.DB.prepare(
    `SELECT r.id,r.project_id,p.name AS project_name,r.start_at,r.end_at,r.generation,
      r.status,r.text,r.answer,
      (SELECT json_group_array(json_object('id',s.id,'title',COALESCE(s.title,a.title),'created_at',s.created_at))
        FROM json_each(r.stock_ids) ref JOIN stocks s ON s.id=ref.value
        JOIN articles a ON a.id=s.article_id AND a.user_id=p.user_id
        WHERE s.project_id=p.id AND s.user_id=p.user_id) AS stocks_json,
      (SELECT json_group_array(json_object('id',id,'title',COALESCE(NULLIF(title,''),first_phase_task)))
        FROM (
          SELECT pf.id,pf.title,${firstPhaseTaskColumn('pf')}
          FROM json_each(r.pufu_ids) ref JOIN pufu_scores pf ON pf.id=ref.value
          WHERE pf.project_id=p.id AND pf.user_id=p.user_id AND pf.status='ready'
        )) AS pufus_json
    FROM reflections r JOIN projects p ON p.id=r.project_id
    WHERE p.user_id=? AND ${scope.sql} AND r.dismissed_at IS NULL AND r.text IS NOT NULL
    ORDER BY (r.answer IS NOT NULL),r.created_at DESC,r.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(userId, ...scope.params, limit + 1, (page - 1) * limit)
    .all<Omit<Reflection, 'stocks' | 'pufus'> & { stocks_json: string; pufus_json: string }>();
  return {
    reflections: rows.results.slice(0, limit).map(({ stocks_json, pufus_json, ...row }) => ({
      ...row,
      stocks: JSON.parse(stocks_json) as Reflection['stocks'],
      pufus: JSON.parse(pufus_json) as Reflection['pufus'],
    })),
    has_more: rows.results.length > limit,
  };
}
