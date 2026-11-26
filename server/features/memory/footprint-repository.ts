import type { FootprintDetail, FootprintPoint } from '../../../shared/footprints';
import type { Env, Job } from '../../env';

export const footprintJobPrefix = 'footprint-';
export type FootprintRow = {
  project_id: string;
  revision: number;
  previous_revision: number | null;
  revisions: string;
  start_at: string;
  end_at: string;
  update_count: number;
};
export type Dependency = { kind: string; id: string; version: string };

// The same ownership and version checks apply to generation, publication and reads.
export const footprintSources = `
WITH parents AS MATERIALIZED (
  SELECT 'stock' AS kind,id,project_id,footprint_edited_at AS moved_at FROM stocks WHERE project_id=?1
  UNION ALL SELECT 'question',id,project_id,footprint_moved_at FROM questions WHERE project_id=?1
  UNION ALL SELECT 'pufu',id,project_id,footprint_moved_at FROM pufu_scores WHERE project_id=?1
)
SELECT s.project_id,'stock' AS kind,s.id,
  json_array(s.article_id,s.footprint_edited_at,a.updated_at) AS version
FROM stocks s JOIN articles a ON a.id=s.article_id AND a.user_id=s.user_id
WHERE s.project_id=?1
UNION ALL SELECT project_id,'question',id,json_array(updated_at,footprint_moved_at) FROM questions WHERE project_id=?1 AND status='ready'
UNION ALL SELECT project_id,'reflection',id,COALESCE(footprint_edited_at,created_at)
FROM reflections WHERE project_id=?1 AND dismissed_at IS NULL AND status='ready'
UNION ALL SELECT p.project_id,'phase',json_array(ph.pufu_id,ph.number),json_array(ph.updated_at,p.footprint_moved_at)
FROM pufu_phases ph JOIN pufu_scores p ON p.id=ph.pufu_id
WHERE p.project_id=?1 AND p.status='ready'
UNION ALL SELECT p.project_id,'comment',c.id,json_array(c.target_type,c.target_id,c.phase,c.created_at,p.moved_at)
FROM parents p JOIN comments c ON c.target_type=p.kind AND c.target_id=p.id
`;

const dependenciesPresent = (json: string) => `NOT EXISTS (
 SELECT 1 FROM json_each(${json}) d
 WHERE NOT EXISTS (
   SELECT 1 FROM sources s WHERE s.project_id=f.project_id
   AND s.kind=json_extract(d.value,'$.kind') AND s.id=json_extract(d.value,'$.id')
   AND s.version=json_extract(d.value,'$.version')
 )
)`;

export async function listFootprints(env: Env, userId: string, projectId: string) {
  const [list, state] = await env.DB.batch<FootprintPoint | { pending: number }>([
    env.DB.prepare(
      `WITH sources AS MATERIALIZED (${footprintSources})
       SELECT f.revision,f.end_at,json_extract(f.result_json,'$.analysis.kind') AS kind
       FROM project_footprints f JOIN projects p ON p.id=f.project_id
       WHERE p.user_id=?2 AND f.project_id=?1 AND f.result_json IS NOT NULL AND ${dependenciesPresent('f.dependencies')}
       ORDER BY f.end_at,f.revision`,
    ).bind(projectId, userId),
    env.DB.prepare(
      `SELECT EXISTS(SELECT 1 FROM footprint_backfills b WHERE b.project_id=p.id AND b.active=1)
       OR EXISTS(SELECT 1 FROM project_footprints f LEFT JOIN processing_jobs j ON j.id=f.job_id
         WHERE f.project_id=p.id AND f.created_at IS NULL
         AND (j.id IS NULL OR j.status IN ('pending','dispatched','running'))) AS pending
       FROM projects p WHERE p.id=? AND p.user_id=?`,
    ).bind(projectId, userId),
  ]);
  return {
    points: list.results as FootprintPoint[],
    pending: Boolean((state.results[0] as { pending: number } | undefined)?.pending),
  };
}

export async function readFootprintRecord(
  env: Env,
  userId: string,
  projectId: string,
  revision: number,
) {
  const row = await env.DB.prepare(
    `WITH sources AS MATERIALIZED (${footprintSources})
     SELECT f.revision,f.start_at,f.end_at,f.result_json,f.dependencies
     FROM project_footprints f JOIN projects p ON p.id=f.project_id
     WHERE p.user_id=?2 AND f.project_id=?1 AND f.revision=?3 AND f.result_json IS NOT NULL
       AND ${dependenciesPresent('f.dependencies')}`,
  )
    .bind(projectId, userId, revision)
    .first<{
      revision: number;
      start_at: string;
      end_at: string;
      result_json: string;
      dependencies: string;
    }>();
  if (!row) return null;
  const { result_json, dependencies, ...point } = row;
  const detail = JSON.parse(result_json) as Pick<FootprintDetail, 'analysis' | 'links'>;
  return {
    detail: { ...point, ...detail, kind: detail.analysis.kind },
    dependencies: JSON.parse(dependencies) as Dependency[],
  };
}

export async function readFootprint(env: Env, userId: string, projectId: string, revision: number) {
  return (await readFootprintRecord(env, userId, projectId, revision))?.detail ?? null;
}

export async function footprintIsCurrent(env: Env, job: Job, dependencies: Dependency[]) {
  return Boolean(
    await env.DB.prepare(
      `WITH sources AS MATERIALIZED (${footprintSources})
     SELECT 1 FROM project_footprints f JOIN projects p ON p.id=f.project_id
     JOIN processing_jobs j ON j.id=f.job_id AND j.status='running'
     WHERE f.project_id=?1 AND j.id=?2 AND p.user_id=?3 AND ${dependenciesPresent('?4')}`,
    )
      .bind(job.target_id, job.id, job.user_id, JSON.stringify(dependencies))
      .first(),
  );
}

export function saveFootprint(
  env: Env,
  job: Job,
  result: {
    analysis: FootprintDetail['analysis'];
    links: FootprintDetail['links'];
    dependencies: Dependency[];
    evidenceIds: { kind: string; id: string }[];
  },
  model: string,
  promptVersion: number,
) {
  const { dependencies, evidenceIds, analysis, links } = result;
  return env.DB.prepare(
    `WITH sources AS MATERIALIZED (${footprintSources})
     UPDATE project_footprints AS f SET result_json=?2,dependencies=?3,evidence_ids=?4,model=?5,prompt_version=?6,
       created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE f.project_id=?1 AND f.job_id=?7 AND f.result_json IS NULL
       AND EXISTS (SELECT 1 FROM processing_jobs j WHERE j.id=f.job_id AND j.status='running')
       AND ${dependenciesPresent('?3')}`,
  ).bind(
    job.target_id,
    JSON.stringify({ analysis, links }),
    JSON.stringify(dependencies),
    JSON.stringify(evidenceIds),
    model,
    promptVersion,
    job.id,
  );
}

export async function startFootprintBackfill(env: Env, userId: string, projectId: string) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO footprint_backfills(project_id,max_revision,interval)
       SELECT p.id,COALESCE((SELECT MAX(v.revision) FROM memory_versions v WHERE v.project_id=p.id),-1),
         p.footprint_interval
       FROM projects p WHERE p.id=? AND p.user_id=?
       ON CONFLICT(project_id) DO UPDATE SET active=1,max_revision=excluded.max_revision,interval=excluded.interval
       WHERE footprint_backfills.active=0`,
    ).bind(projectId, userId),
    // An explicit request can retry failed reservations. Their comparison remains pinned.
    env.DB.prepare(
      `UPDATE project_footprints AS f SET job_id='${footprintJobPrefix}retry-'||lower(hex(randomblob(16)))
       WHERE f.project_id=? AND f.result_json IS NULL AND f.created_at IS NULL
         AND EXISTS (SELECT 1 FROM projects p WHERE p.id=f.project_id AND p.user_id=?)
         AND EXISTS (SELECT 1 FROM processing_jobs j WHERE j.id=f.job_id AND j.status='failed')`,
    ).bind(projectId, userId),
  ]);
}

async function advanceBackfills(env: Env) {
  const active = await env.DB.prepare(
    `SELECT b.* FROM footprint_backfills b WHERE b.active=1 AND NOT EXISTS (
      SELECT 1 FROM project_footprints f LEFT JOIN processing_jobs j ON j.id=f.job_id
      WHERE f.project_id=b.project_id AND f.result_json IS NULL AND f.created_at IS NULL
        AND (j.id IS NULL OR j.status IN ('pending','dispatched','running'))
    ) ORDER BY b.cursor_at,b.project_id LIMIT 10`,
  ).all<{
    project_id: string;
    max_revision: number;
    interval: number;
    cursor_at: string | null;
    cursor_revision: number | null;
  }>();

  for (const backfill of active.results) {
    const { project_id, max_revision, interval, cursor_at, cursor_revision } = backfill;
    const needed = cursor_revision === null ? 1 : interval;
    const { results } = await env.DB.prepare(
      `SELECT v.revision,v.saved_at,f.revision IS NOT NULL AS reserved
       FROM memory_versions v LEFT JOIN project_footprints f
         ON f.project_id=v.project_id AND f.revision=v.revision
       WHERE v.project_id=?1 AND v.revision<=?2
         AND (?3 IS NULL OR (v.saved_at,v.revision)>(?3,?4))
       ORDER BY v.saved_at,v.revision LIMIT ?5`,
    )
      .bind(project_id, max_revision, cursor_at, cursor_revision, needed)
      .all<{ revision: number; saved_at: string; reserved: number }>();
    const reserved = results.find((version) => version.reserved);
    const next = reserved ?? (results.length === needed ? results.at(-1)! : null);
    const guard =
      'project_id=? AND cursor_revision IS ? AND max_revision=? AND interval=? AND active=1';
    const guardValues = [project_id, cursor_revision, max_revision, interval] as const;
    if (!next) {
      await env.DB.prepare(`UPDATE footprint_backfills SET active=0 WHERE ${guard}`)
        .bind(...guardValues)
        .run();
      continue;
    }
    await env.DB.batch([
      ...(reserved
        ? []
        : [
            env.DB.prepare(
              `INSERT OR IGNORE INTO project_footprints
          (project_id,revision,previous_revision,revisions,start_at,end_at,update_count,job_id)
         SELECT project_id,?,cursor_revision,?,COALESCE(cursor_at,?),?,?,?
         FROM footprint_backfills WHERE ${guard}`,
            ).bind(
              next.revision,
              JSON.stringify(results.map((version) => version.revision)),
              next.saved_at,
              next.saved_at,
              needed,
              `${footprintJobPrefix}${project_id}-${next.revision}`,
              ...guardValues,
            ),
          ]),
      env.DB.prepare(
        `UPDATE footprint_cursors AS c SET previous_revision=?1,updates=(
           SELECT COUNT(*) FROM memory_versions v
           WHERE v.project_id=c.project_id AND v.revision>?1
         )
         WHERE c.project_id=?2 AND COALESCE(c.previous_revision,-1)<?1
           AND EXISTS (SELECT 1 FROM footprint_backfills WHERE ${guard})`,
      ).bind(next.revision, project_id, ...guardValues),
      env.DB.prepare(
        `UPDATE footprint_backfills SET cursor_at=?,cursor_revision=? WHERE ${guard}`,
      ).bind(next.saved_at, next.revision, ...guardValues),
    ]);
  }
}

export async function queueFootprintJobs(env: Env) {
  await advanceBackfills(env);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO processing_jobs(id,user_id,kind,target_id,revision,language)
     SELECT f.job_id,p.user_id,'question',f.project_id,f.revision,v.language
     FROM project_footprints f JOIN projects p ON p.id=f.project_id
     JOIN memory_versions v ON v.project_id=f.project_id AND v.revision=f.revision
     WHERE f.result_json IS NULL AND f.created_at IS NULL
       AND NOT EXISTS(SELECT 1 FROM processing_jobs j WHERE j.id=f.job_id)
       AND NOT EXISTS(
         SELECT 1 FROM project_footprints prior LEFT JOIN processing_jobs j ON prior.job_id=j.id
         WHERE prior.project_id=f.project_id AND prior.revision=f.previous_revision
           AND prior.created_at IS NULL AND (j.id IS NULL OR j.status IN ('pending','dispatched','running'))
       )
     ORDER BY v.footprint_live DESC,f.end_at,f.revision LIMIT 10`,
  ).run();
}
