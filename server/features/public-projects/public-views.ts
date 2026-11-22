import type { PublicViewTotals } from '../../../shared/public-project';

type ViewKind = keyof PublicViewTotals;

// Cron triggers use UTC. This processes completed Japan-time days at 00:05 JST.
export const publicViewsCron = '5 15 * * *';

export function japanDay(timestamp: number) {
  return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function recordPublicView(
  db: D1Database,
  request: Request,
  publicId: string,
  kind: ViewKind,
  itemId: string,
) {
  const headers = request.headers;
  const bot = request.cf?.botManagement;
  const verifiedBot =
    typeof bot === 'object' && bot !== null && 'verifiedBot' in bot && bot.verifiedBot === true;
  if (
    request.method !== 'GET' ||
    headers.get('Sec-Fetch-Dest') !== 'document' ||
    headers.get('Sec-Fetch-Mode') !== 'navigate' ||
    headers.has('Sec-Purpose') ||
    headers.has('Purpose') ||
    request.cf?.verifiedBotCategory ||
    verifiedBot
  )
    return;

  // Use the same public ID the server just rendered, and recheck publication at write time.
  await db
    .prepare(
      `INSERT INTO public_view_pending (day,project_id,kind,item_id,views)
       SELECT ?,id,?,?,1 FROM projects WHERE public_id=? AND is_public=1
       ON CONFLICT(day,project_id,kind,item_id) DO UPDATE SET views=views+1`,
    )
    .bind(japanDay(Date.now()), kind, itemId, publicId)
    .run();
}

export async function publishPublicViews(db: D1Database, scheduledTime: number) {
  const cutoff = japanDay(scheduledTime);
  // A D1 batch commits both totals, the cache revision and the consumed rows together.
  await db.batch([
    db
      .prepare(
        `INSERT INTO public_view_totals (project_id,kind,item_id,views)
         SELECT project_id,kind,item_id,SUM(views)
         FROM public_view_pending WHERE day<? GROUP BY project_id,kind,item_id
         ON CONFLICT(project_id,kind,item_id) DO UPDATE SET views=views+excluded.views`,
      )
      .bind(cutoff),
    db
      .prepare(
        `INSERT INTO public_view_daily (project_id,day,kind,item_id,views)
         SELECT project_id,day,kind,item_id,views FROM public_view_pending WHERE day<?
         ON CONFLICT(project_id,day,kind,item_id) DO UPDATE SET views=views+excluded.views`,
      )
      .bind(cutoff),
    db
      .prepare(
        `UPDATE public_directory_revision SET revision=lower(hex(randomblob(16))) WHERE id=1
         AND EXISTS (SELECT 1 FROM public_view_pending WHERE day<? AND kind='project')`,
      )
      .bind(cutoff),
    db.prepare('DELETE FROM public_view_pending WHERE day<?').bind(cutoff),
  ]);
}

// The SQL expressions passed by the public queries are fixed source-code column aliases.
export function publicViewColumn(kind: ViewKind, itemId = "''") {
  return `COALESCE((SELECT views FROM public_view_totals
    WHERE project_id=p.id AND kind='${kind}' AND item_id=${itemId}),0) AS view_count`;
}
