import type {
  FootprintDetail,
  FootprintPoint,
  FootprintPublication,
  OwnedFootprintDetail,
  PublicFootprint,
  SharedFootprint,
} from '../../../shared/footprints';
import type { Env, Job } from '../../env';
import { publicPufuWhere, publicQuestionWhere } from '../public-projects/public-sources';

export const footprintJobPrefix = 'footprint-';
const reanalysisJobPrefix = `${footprintJobPrefix}reanalysis-`;
export const isFootprintReanalysis = (jobId: string) => jobId.startsWith(reanalysisJobPrefix);
export type FootprintRow = {
  project_id: string;
  revision: number;
  previous_revision: number | null;
  revisions: string;
  start_at: string;
  end_at: string;
  update_count: number;
  is_public: number;
};
export type Dependency = { kind: string; id: string; version: string };

// The same project and version checks apply to generation, publication and reads.
function sourcesForProject(
  project: string,
  dependency?: { kind: string; id: string },
  publicOnly = false,
) {
  const match = (kind: string, id: string) =>
    dependency ? ` AND ${dependency.kind}='${kind}' AND ${id}=${dependency.id}` : '';
  const phaseId = dependency && `CASE WHEN json_valid(${dependency.id}) THEN ${dependency.id} END`;
  const matchPhase = dependency
    ? ` AND ${dependency.kind}='phase' AND ph.pufu_id=json_extract(${phaseId},'$[0]')
        AND ph.number=json_extract(${phaseId},'$[1]')`
    : '';
  return `
WITH parents AS ${dependency ? 'NOT MATERIALIZED' : 'MATERIALIZED'} (
  SELECT 'stock' AS kind,id,project_id,footprint_edited_at AS moved_at FROM stocks WHERE project_id=${project}
  UNION ALL SELECT 'question',id,project_id,footprint_moved_at FROM questions WHERE project_id=${project}
  UNION ALL SELECT 'pufu',id,project_id,footprint_moved_at FROM pufu_scores WHERE project_id=${project}
)
SELECT s.project_id,'stock' AS kind,s.id,
  json_array(s.article_id,s.${publicOnly ? 'footprint_public_at' : 'footprint_edited_at'},a.updated_at) AS version
FROM stocks s JOIN articles a ON a.id=s.article_id AND a.user_id=s.user_id
WHERE s.project_id=${project}${match('stock', 's.id')}${publicOnly ? " AND a.status='ready'" : ''}
UNION ALL SELECT q.project_id,'question',q.id,json_array(q.${publicOnly ? 'footprint_public_at' : 'updated_at'},q.footprint_moved_at)
FROM questions q WHERE q.project_id=${project} AND ${publicOnly ? publicQuestionWhere : "q.status='ready'"}${match('question', 'q.id')}
UNION ALL SELECT pf.project_id,'phase',json_array(ph.pufu_id,ph.number),json_array(ph.updated_at,pf.footprint_moved_at)
FROM pufu_phases ph JOIN pufu_scores pf ON pf.id=ph.pufu_id
${publicOnly ? 'JOIN projects p ON p.id=pf.project_id' : ''}
WHERE pf.project_id=${project} AND pf.status='ready'${matchPhase}
${
  publicOnly
    ? ` AND ph.number<=pf.current_phase AND ${publicPufuWhere}`
    : `
UNION ALL SELECT project_id,'reflection',id,COALESCE(footprint_edited_at,created_at)
FROM reflections WHERE project_id=${project} AND dismissed_at IS NULL AND status='ready'${match('reflection', 'id')}
UNION ALL SELECT q.project_id,'comment',c.id,json_array(c.target_type,c.target_id,c.phase,c.created_at,q.moved_at)
FROM ${dependency ? 'comments c CROSS JOIN parents q' : 'parents q JOIN comments c'}
ON c.target_type=q.kind AND c.target_id=q.id WHERE 1${match('comment', 'c.id')}`
}
`;
}
export const footprintSources = sourcesForProject('?1');
export const publicFootprintSources = sourcesForProject('?1', undefined, true);
const publicationEnabled = 'p.is_public=1 AND p.include_in_user_memory=1';
const dependencyKind = "json_extract(d.value,'$.kind')";
const dependencyId = "json_extract(d.value,'$.id')";
const sourcesForDependency = `(${sourcesForProject('f.project_id', {
  kind: dependencyKind,
  id: dependencyId,
})})`;
const publicSourcesForDependency = `(${sourcesForProject(
  'f.project_id',
  {
    kind: dependencyKind,
    id: dependencyId,
  },
  true,
)})`;

const dependenciesPresent = (json: string, sources = 'sources') => `NOT EXISTS (
 SELECT 1 FROM json_each(${json}) d
 WHERE NOT EXISTS (
   SELECT 1 FROM ${sources} s WHERE s.project_id=f.project_id
   AND s.kind=${dependencyKind} AND s.id=${dependencyId}
   AND s.version=json_extract(d.value,'$.version')
 )
)`;

const matchingMemoryVersion = `v.memory_id='project-'||f.project_id AND v.revision=f.revision
  AND v.user_id=p.user_id`;
const activeJob = "j.status IN ('pending','dispatched','running')";
const currentAnalysis = (alias: 'f' | 'r', privateSources = 'sources') => `CASE
  WHEN ${alias}.public_id IS NOT NULL THEN ${dependenciesPresent(`${alias}.dependencies`, publicSourcesForDependency)}
  ELSE ${dependenciesPresent(`${alias}.dependencies`, privateSources)}
END`;
const currentOriginal = currentAnalysis('f');
const currentReanalysis = `p.include_in_user_memory=1 AND r.result_json IS NOT NULL
  AND (${currentAnalysis('r')})`;
const legacyApprovalJoin = `a.project_id=f.project_id AND a.revision=f.revision
  AND (${currentAnalysis('f', sourcesForDependency)})`;
const reanalysisAllowed = `p.include_in_user_memory=1 AND f.result_json IS NOT NULL
  AND json_extract(f.result_json,'$.analysis.kind')<>'continuing'
  AND ((${currentAnalysis('f', sourcesForDependency)})
    OR (r.result_json IS NOT NULL AND (${currentAnalysis('r', sourcesForDependency)})))`;

// Existing analyses have no public ID. Only results produced from public inputs can acquire one.
const sharedResult = `CASE
  WHEN r.public_id IS NOT NULL AND ${dependenciesPresent('r.dependencies', publicSourcesForDependency)} THEN r.result_json
  WHEN f.public_id IS NOT NULL AND ${dependenciesPresent('f.dependencies', publicSourcesForDependency)} THEN f.result_json
END`;
type SharedRow = Pick<FootprintDetail, 'start_at' | 'end_at' | 'kind'> & {
  shared_result: string | null;
  public_title: string | null;
  public_summary: string | null;
};

function sharedFootprint(row: SharedRow): SharedFootprint | null {
  const { start_at, end_at, kind, shared_result, public_title, public_summary } = row;
  if (shared_result) {
    const { analysis, links } = JSON.parse(shared_result) as Pick<
      FootprintDetail,
      'analysis' | 'links'
    >;
    return analysis.kind === 'continuing'
      ? { kind: analysis.kind, end_at }
      : { kind: analysis.kind, start_at, end_at, analysis, links };
  }
  if (public_title === null || public_summary === null) return null;
  return kind === 'continuing'
    ? { kind, end_at }
    : { kind, start_at, end_at, title: public_title, summary: public_summary };
}

function footprintStatusQuery(env: Env, userId: string, projectId: string) {
  return env.DB.prepare(
    `SELECT EXISTS(SELECT 1 FROM footprint_backfills b WHERE b.project_id=p.id AND b.active=1)
     OR EXISTS(SELECT 1 FROM project_footprints f LEFT JOIN processing_jobs j ON j.id=f.job_id
       WHERE f.project_id=p.id AND f.created_at IS NULL
       AND (j.id IS NULL OR j.status IN ('pending','dispatched','running'))) AS pending
     FROM projects p WHERE p.id=? AND p.user_id=?`,
  ).bind(projectId, userId);
}

export async function readFootprintStatus(env: Env, userId: string, projectId: string) {
  const pending = await footprintStatusQuery(env, userId, projectId).first<number>('pending');
  return { pending: Boolean(pending) };
}

export async function listFootprints(env: Env, userId: string, projectId: string) {
  const [list, state] = await env.DB.batch<FootprintPoint | { pending: number }>([
    env.DB.prepare(
      `WITH sources AS MATERIALIZED (${footprintSources})
       SELECT f.revision,f.end_at,COALESCE(
         CASE WHEN (${publicationEnabled}) THEN json_extract((${sharedResult}),'$.analysis.kind') END,
         CASE WHEN ${currentOriginal} THEN json_extract(f.result_json,'$.analysis.kind')
           ELSE json_extract(r.result_json,'$.analysis.kind') END) AS kind
       FROM project_footprints f JOIN projects p ON p.id=f.project_id
       LEFT JOIN project_footprint_reanalyses r ON r.project_id=f.project_id AND r.revision=f.revision
       WHERE p.user_id=?2 AND f.project_id=?1 AND f.result_json IS NOT NULL
         AND ((${currentOriginal}) OR (${currentReanalysis}))
       ORDER BY f.end_at,f.revision`,
    ).bind(projectId, userId),
    footprintStatusQuery(env, userId, projectId),
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
  forOwner = false,
) {
  const row = await env.DB.prepare(
    `WITH sources AS MATERIALIZED (${footprintSources})
     SELECT f.revision,f.start_at,f.end_at,f.dependencies,f.public_id,
       CASE WHEN ${currentOriginal} THEN f.result_json END AS result_json,
       json_extract(f.result_json,'$.analysis.kind') AS kind,
       (${publicationEnabled}) AS publication_enabled, a.title AS public_title,a.summary AS public_summary,
       CASE WHEN ?4 AND (${publicationEnabled}) THEN (${sharedResult}) END AS shared_result,
       CASE WHEN ?4 AND p.include_in_user_memory=1 AND v.memory_id IS NOT NULL
         THEN COALESCE(r.generation,0) END AS reanalysis_generation,
       r.completed_generation, (${activeJob}) AS reanalysis_pending,
       CASE WHEN ${currentReanalysis} THEN r.result_json END AS reanalysis_result
     FROM project_footprints f JOIN projects p ON p.id=f.project_id
     LEFT JOIN project_footprint_publications a ON ?4 AND ${legacyApprovalJoin}
     LEFT JOIN memory_versions v ON ?4 AND ${matchingMemoryVersion}
     LEFT JOIN project_footprint_reanalyses r ON ?4 AND r.project_id=f.project_id AND r.revision=f.revision
     LEFT JOIN processing_jobs j ON j.id=r.job_id
     WHERE p.user_id=?2 AND f.project_id=?1 AND f.revision=?3 AND f.result_json IS NOT NULL
       AND ((${currentOriginal}) OR (?4 AND (${currentReanalysis})))`,
  )
    .bind(projectId, userId, revision, Number(forOwner))
    .first<
      SharedRow & {
        revision: number;
        start_at: string;
        end_at: string;
        result_json: string | null;
        dependencies: string;
        public_id: string | null;
        publication_enabled: number;
        reanalysis_generation: number | null;
        completed_generation: number | null;
        reanalysis_pending: number | null;
        reanalysis_result: string | null;
      }
    >();
  if (!row) return null;
  const point = { revision: row.revision, start_at: row.start_at, end_at: row.end_at };
  const decode = (result: string): FootprintDetail => {
    const detail = JSON.parse(result) as Pick<FootprintDetail, 'analysis' | 'links'>;
    return { ...point, ...detail, kind: detail.analysis.kind };
  };
  const { reanalysis_generation: generation, reanalysis_result: reanalyzed } = row;
  const newDetail = reanalyzed ? decode(reanalyzed) : null;
  const original = row.result_json ? decode(row.result_json) : null;
  const detail = original ?? newDetail;
  if (!detail) return null;
  const reanalysis: OwnedFootprintDetail['reanalysis'] =
    generation === null
      ? null
      : {
          generation,
          status: row.reanalysis_pending
            ? 'pending'
            : generation === 0
              ? 'idle'
              : generation === row.completed_generation
                ? 'ready'
                : 'failed',
          result:
            newDetail?.kind === 'continuing'
              ? { kind: 'continuing' }
              : newDetail && { ...newDetail, kind: newDetail.kind },
          ...(reanalyzed && reanalyzed === row.shared_result ? { shared: true } : {}),
        };
  return {
    detail,
    original_available: original !== null,
    public_analysis: row.public_id !== null,
    dependencies: original ? (JSON.parse(row.dependencies) as Dependency[]) : [],
    publication_enabled: Boolean(row.publication_enabled),
    publication:
      row.public_title === null || row.public_summary === null
        ? null
        : { title: row.public_title, summary: row.public_summary },
    reanalysis,
    shared: row.publication_enabled && forOwner ? sharedFootprint(row) : null,
  };
}

export async function readFootprint(
  env: Env,
  userId: string,
  projectId: string,
  revision: number,
): Promise<OwnedFootprintDetail | null> {
  const record = await readFootprintRecord(env, userId, projectId, revision, true);
  if (!record || record.detail.kind === 'continuing') return null;
  const { detail, publication_enabled, publication, reanalysis, shared, original_available } =
    record;
  return { ...detail, publication_enabled, publication, reanalysis, shared, original_available };
}

export async function startFootprintReanalysis(
  env: Env,
  userId: string,
  projectId: string,
  revision: number,
  generation: number,
) {
  const jobId = `${reanalysisJobPrefix}${crypto.randomUUID()}`;
  const [reservation] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO project_footprint_reanalyses(project_id,revision,generation,job_id)
       SELECT f.project_id,f.revision,?4+1,?5
       FROM project_footprints f JOIN projects p ON p.id=f.project_id
       JOIN memory_versions v ON ${matchingMemoryVersion}
       LEFT JOIN project_footprint_reanalyses r ON r.project_id=f.project_id AND r.revision=f.revision
       WHERE f.project_id=?1 AND p.user_id=?2 AND f.revision=?3 AND ${reanalysisAllowed}
         AND COALESCE(r.generation,0)=?4
         AND NOT EXISTS(SELECT 1 FROM processing_jobs j WHERE j.id=r.job_id AND ${activeJob})
       ON CONFLICT(project_id,revision) DO UPDATE SET generation=excluded.generation,job_id=excluded.job_id`,
    ).bind(projectId, userId, revision, generation, jobId),
    env.DB.prepare(
      `INSERT INTO processing_jobs(id,user_id,kind,target_id,revision,language)
       SELECT r.job_id,p.user_id,'question',f.project_id,f.revision,v.language
       FROM project_footprint_reanalyses r JOIN project_footprints f
         ON f.project_id=r.project_id AND f.revision=r.revision
       JOIN projects p ON p.id=f.project_id JOIN memory_versions v ON ${matchingMemoryVersion}
       WHERE r.job_id=?`,
    ).bind(jobId),
  ]);
  return reservation.meta.changes > 0;
}

export function publishFootprint(
  env: Env,
  userId: string,
  projectId: string,
  revision: number,
  publication: FootprintPublication,
) {
  return env.DB.prepare(
    `INSERT INTO project_footprint_publications(project_id,revision,id,title,summary)
     SELECT f.project_id,f.revision,?4,?5,?6
     FROM project_footprints f JOIN projects p ON p.id=f.project_id
     WHERE f.project_id=?1 AND p.user_id=?2 AND f.revision=?3 AND (${publicationEnabled})
       AND f.result_json IS NOT NULL AND (${currentAnalysis('f', sourcesForDependency)})
     ON CONFLICT(project_id,revision) DO UPDATE SET title=excluded.title,summary=excluded.summary
     RETURNING title,summary`,
  )
    .bind(projectId, userId, revision, crypto.randomUUID(), publication.title, publication.summary)
    .first<FootprintPublication>();
}

export function unpublishFootprint(env: Env, userId: string, projectId: string, revision: number) {
  return env.DB.prepare(
    `DELETE FROM project_footprint_publications WHERE project_id=?1 AND revision=?2
     AND EXISTS(SELECT 1 FROM projects p WHERE p.id=?1 AND p.user_id=?3)`,
  )
    .bind(projectId, revision, userId)
    .run();
}

export async function listPublicFootprints(env: Env, key: string, limit: number, offset: number) {
  // The project gate, source versions and approved copy share one D1 read snapshot.
  // Anonymous reads look up the referenced IDs without materializing unrelated sources.
  const { results } = await env.DB.prepare(
    `WITH public_project AS MATERIALIZED (
       SELECT p.id,(${publicationEnabled}) AS enabled FROM projects p WHERE p.public_id=?1 AND p.is_public=1
     ), candidates AS (
       SELECT COALESCE(f.public_id,r.public_id,a.id) AS id,f.revision,f.start_at,f.end_at,
         json_extract(f.result_json,'$.analysis.kind') AS kind,a.title AS public_title,a.summary AS public_summary,
         (${sharedResult}) AS shared_result
       FROM project_footprints f
       LEFT JOIN project_footprint_reanalyses r ON f.project_id=r.project_id AND f.revision=r.revision
       LEFT JOIN project_footprint_publications a ON ${legacyApprovalJoin}
       WHERE f.project_id=(SELECT id FROM public_project WHERE enabled=1) AND f.result_json IS NOT NULL
         AND (a.id IS NOT NULL OR f.public_id IS NOT NULL OR r.public_id IS NOT NULL)
     )
     SELECT r.id,r.start_at,r.end_at,r.kind,r.public_title,r.public_summary,r.shared_result FROM public_project
     LEFT JOIN (
       SELECT * FROM candidates WHERE shared_result IS NOT NULL OR public_title IS NOT NULL
       ORDER BY end_at DESC,revision DESC LIMIT ?2 OFFSET ?3
     ) r ON 1=1
     ORDER BY r.end_at DESC,r.revision DESC`,
  )
    .bind(key, limit, offset)
    .all<(SharedRow & { id: string }) | { id: null }>();
  if (!results.length) return null;
  return results.flatMap<PublicFootprint>((row) => {
    if (row.id === null) return [];
    const item = sharedFootprint(row);
    return item ? [{ id: row.id, ...item }] : [];
  });
}

function footprintJobTarget(jobId: string) {
  const reanalysis = isFootprintReanalysis(jobId);
  return {
    from: `project_footprints f JOIN projects p ON p.id=f.project_id
      ${reanalysis ? 'JOIN project_footprint_reanalyses r ON r.project_id=f.project_id AND r.revision=f.revision' : ''}`,
    jobId: reanalysis ? 'r.job_id' : 'f.job_id',
    available: reanalysis
      ? `r.completed_generation IS NOT r.generation AND ${reanalysisAllowed}`
      : 'f.result_json IS NULL',
  };
}

export function footprintJobCacheGuard(jobId: string, publicInputs?: boolean) {
  const target = footprintJobTarget(jobId);
  return `SELECT 1 FROM ${target.from}
    WHERE ${target.jobId}=? AND p.user_id=? AND ${target.available}
    ${publicInputs === undefined ? '' : `AND ${dependenciesPresent('?', publicInputs ? publicSourcesForDependency : sourcesForDependency)}`}`;
}

export function readFootprintTarget(
  env: Env,
  job: Job,
  dependencies?: Dependency[],
  publicOnly = false,
) {
  const target = footprintJobTarget(job.id);
  return env.DB.prepare(
    `${dependencies ? `WITH sources AS MATERIALIZED (${publicOnly ? publicFootprintSources : footprintSources})` : ''}
     SELECT f.project_id,f.revision,f.previous_revision,f.revisions,f.start_at,f.end_at,f.update_count,p.is_public
     FROM ${target.from} JOIN processing_jobs j ON j.id=${target.jobId} AND j.status='running'
     WHERE f.project_id=?1 AND p.user_id=?2 AND j.id=?3 AND f.revision=?4 AND ${target.available}
       ${dependencies ? `AND ${dependenciesPresent('?5')}` : ''}`,
  )
    .bind(
      job.target_id,
      job.user_id,
      job.id,
      job.revision,
      ...(dependencies ? [JSON.stringify(dependencies)] : []),
    )
    .first<FootprintRow>();
}

export function saveFootprint(
  env: Env,
  job: Job,
  result: {
    analysis: FootprintDetail['analysis'];
    links: FootprintDetail['links'];
    dependencies: Dependency[];
    evidenceIds: { kind: string; id: string }[];
    publicOnly?: boolean;
  },
  model: string,
  promptVersion: number,
) {
  const { dependencies, evidenceIds, analysis, links } = result;
  const publicId = result.publicOnly ? crypto.randomUUID() : null;
  const sources = result.publicOnly ? publicFootprintSources : footprintSources;
  const values = [
    job.target_id,
    JSON.stringify({ analysis, links }),
    JSON.stringify(dependencies),
    JSON.stringify(evidenceIds),
    model,
    promptVersion,
    job.id,
    publicId,
  ];
  if (isFootprintReanalysis(job.id))
    return env.DB.prepare(
      `WITH sources AS MATERIALIZED (${sources})
       UPDATE project_footprint_reanalyses AS r
       SET result_json=?2,dependencies=?3,evidence_ids=?4,model=?5,prompt_version=?6,
         analyzed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),completed_generation=r.generation,
         public_id=CASE WHEN ?8 IS NOT NULL THEN COALESCE(r.public_id,?8) END
       WHERE r.project_id=?1 AND r.job_id=?7 AND r.completed_generation IS NOT r.generation
         AND EXISTS (SELECT 1 FROM processing_jobs j WHERE j.id=r.job_id AND j.status='running')
         AND EXISTS (SELECT 1 FROM project_footprints f JOIN projects p ON p.id=f.project_id
           WHERE f.project_id=r.project_id AND f.revision=r.revision AND p.user_id=?9
             AND ${reanalysisAllowed} AND ${dependenciesPresent('?3')})`,
    ).bind(...values, job.user_id);
  return env.DB.prepare(
    `WITH sources AS MATERIALIZED (${sources})
     UPDATE project_footprints AS f SET result_json=?2,dependencies=?3,evidence_ids=?4,model=?5,prompt_version=?6,
       created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),public_id=?8
     WHERE f.project_id=?1 AND f.job_id=?7 AND f.result_json IS NULL
       AND EXISTS (SELECT 1 FROM processing_jobs j WHERE j.id=f.job_id AND j.status='running')
       AND ${dependenciesPresent('?3')}`,
  ).bind(...values);
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
