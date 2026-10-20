import { HTTPException } from 'hono/http-exception';
import { PufuImageError, imageLimits } from '@pufu-lens/pufu-image';
import type { Env, Principal } from './env';
import { renderSavedPufu, pufuImageVersion } from './pufu-renderer';
import { readQuestionPufu, readQuestionPufuRecord } from './pufu-read';

type Entry = {
  id: string;
  pufu_id: string;
  user_id: string;
  revision: number;
  phase: number;
  current: number;
  ready: number;
  failed: number;
  error: string | null;
  attempts: number;
  touched: number;
  write_pending: number;
  width: number | null;
  height: number | null;
  byte_length: number | null;
};
const now = () => new Date().toISOString();
const key = (entry: Entry) => `${entry.user_id}/pufu-images/${entry.id}.png`;
async function settleWrite(env: Env, entry: Entry) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO pufu_image_entries
    (id,pufu_id,user_id,revision,phase,current,touched) VALUES(?,?,?,?,?,0,1)`,
  )
    .bind(entry.id, entry.pufu_id, entry.user_id, entry.revision, entry.phase)
    .run();
  await env.DB.prepare(
    `UPDATE pufu_image_entries SET write_pending=0,
    next_attempt_at=CASE WHEN current=0 THEN ? ELSE next_attempt_at END WHERE id=?`,
  )
    .bind(now(), entry.id)
    .run();
}
async function replaceUncertain(env: Env, entry: Entry, lease: string) {
  await env.DB.batch([
    env.DB.prepare('UPDATE pufu_image_entries SET current=0 WHERE id=? AND lease_until=?').bind(
      entry.id,
      lease,
    ),
    env.DB.prepare(
      `INSERT INTO pufu_image_entries(pufu_id,user_id,revision,phase,attempts,failed,error)
      SELECT id,user_id,revision,current_phase,?,?,? FROM pufu_scores WHERE id=? AND status='ready'
      AND NOT EXISTS(SELECT 1 FROM pufu_image_entries WHERE pufu_id=? AND current=1)`,
    ).bind(
      entry.attempts,
      entry.attempts >= 3 ? 1 : 0,
      entry.attempts >= 3 ? 'RENDER_UNCERTAIN' : null,
      entry.pufu_id,
      entry.pufu_id,
    ),
  ]);
}
export async function syncPufuImages(env: Env, pufuId?: string): Promise<void> {
  const at = now();
  await env.DB.prepare(
    `DELETE FROM pufu_image_entries WHERE current=0 AND touched=0
    AND (lease_until IS NULL OR lease_until<=?)`,
  )
    .bind(at)
    .run();
  const entries = await env.DB.prepare(
    `SELECT * FROM pufu_image_entries
    WHERE (current=0 OR (ready=0 AND failed=0)) AND next_attempt_at<=?
    AND (lease_until IS NULL OR lease_until<=?) AND (? IS NULL OR pufu_id=?)
    AND (current=0 OR ?=1)
    ORDER BY current,created_at,id LIMIT 2`,
  )
    .bind(at, at, pufuId ?? null, pufuId ?? null, env.ASSETS ? 1 : 0)
    .all<Entry>();
  for (const entry of entries.results) {
    const lease = new Date(Date.now() + 120000).toISOString();
    const claim = await env.DB.prepare(
      `UPDATE pufu_image_entries SET lease_until=? WHERE id=?
      AND (current=0 OR (ready=0 AND failed=0)) AND next_attempt_at<=?
      AND (lease_until IS NULL OR lease_until<=?) RETURNING current,touched,write_pending`,
    )
      .bind(lease, entry.id, at, at)
      .first<Pick<Entry, 'current' | 'touched' | 'write_pending'>>();
    if (!claim) continue;
    try {
      if (!claim.current) {
        if (claim.touched) await env.CONTENT.delete(key(entry));
        if (!claim.write_pending)
          await env.DB.prepare(
            `DELETE FROM pufu_image_entries
          WHERE id=? AND current=0 AND lease_until=? AND write_pending=0`,
          )
            .bind(entry.id, lease)
            .run();
        await env.DB.prepare(
          `UPDATE pufu_image_entries SET next_attempt_at=? WHERE id=? AND lease_until=?`,
        )
          .bind(new Date(Date.now() + 3600000).toISOString(), entry.id, lease)
          .run();
        continue;
      }
      if (claim.touched) {
        await replaceUncertain(env, entry, lease);
        continue;
      }
      const source = await env.DB.prepare(
        `SELECT CASE WHEN p.current_phase=1 THEN p.score_json ELSE ph.score_json END AS score_json
        FROM pufu_scores p JOIN pufu_image_entries e ON e.pufu_id=p.id AND e.user_id=p.user_id
        LEFT JOIN pufu_phases ph ON ph.pufu_id=p.id AND ph.number=p.current_phase
        WHERE e.id=? AND e.current=1 AND p.status='ready' AND p.revision=e.revision AND p.current_phase=e.phase`,
      )
        .bind(entry.id)
        .first<{ score_json: string | null }>();
      if (!source) continue;
      if (new TextEncoder().encode(source.score_json ?? '').byteLength > 262144)
        throw new PufuImageError('INPUT_TOO_LARGE', '保存済みJSONが上限を超えています。');
      let score: unknown;
      try {
        score = JSON.parse(source.score_json ?? 'null');
      } catch {
        throw new PufuImageError('INVALID_INPUT', '保存済みJSONが不正です。');
      }
      const image = await renderSavedPufu(env, score);
      const touched = await env.DB.prepare(
        `UPDATE pufu_image_entries SET touched=1,write_pending=1,
        attempts=attempts+1 WHERE id=? AND current=1 AND lease_until=?`,
      )
        .bind(entry.id, lease)
        .run();
      if (!touched.meta.changes) continue;
      await env.CONTENT.put(key(entry), image.png, {
        httpMetadata: { contentType: 'image/png' },
      }).then(
        async (result) => {
          await settleWrite(env, entry);
          return result;
        },
        async (error) => {
          await settleWrite(env, entry);
          throw error;
        },
      );
      await env.DB.prepare(
        `UPDATE pufu_image_entries SET ready=1,error=NULL,width=?,height=?,byte_length=?
        WHERE id=? AND current=1 AND lease_until=?`,
      )
        .bind(image.width, image.height, image.png.byteLength, entry.id, lease)
        .run();
    } catch (error) {
      const permanent =
        error instanceof PufuImageError &&
        !['FONT_UNAVAILABLE', 'WASM_UNAVAILABLE', 'RENDER_FAILED'].includes(error.code);
      await env.DB.prepare(
        `UPDATE pufu_image_entries SET attempts=attempts+CASE WHEN touched=1 THEN 0 ELSE 1 END,
        failed=CASE WHEN ? OR attempts+CASE WHEN touched=1 THEN 0 ELSE 1 END>=3 THEN 1 ELSE 0 END,error=?,next_attempt_at=? WHERE id=? AND lease_until=?`,
      )
        .bind(
          permanent ? 1 : 0,
          error instanceof PufuImageError ? error.code : 'RENDER_FAILED',
          new Date(Date.now() + 60000).toISOString(),
          entry.id,
          lease,
        )
        .run();
      console.error('pufu_image_generation_pending');
    } finally {
      await env.DB.prepare(
        'UPDATE pufu_image_entries SET lease_until=NULL WHERE id=? AND lease_until=?',
      )
        .bind(entry.id, lease)
        .run();
    }
  }
}

export async function readPufuImage(env: Env, principal: Principal, questionId: string) {
  // 破損JSONを未作成と扱わず、既存取得と同じ条件で所有権を確認する。
  const pufu = await readQuestionPufu(env, principal, questionId);
  const row = await readQuestionPufuRecord(env, principal, questionId);
  const entry = row.pufu_id
    ? await env.DB.prepare(
        `SELECT * FROM pufu_image_entries
    WHERE pufu_id=? AND user_id=? AND revision=? AND phase=? AND current=1 AND render_version=?`,
      )
        .bind(row.pufu_id, principal.user.id, row.revision, row.current_phase, pufuImageVersion)
        .first<Entry>()
    : null;
  const status = !row.pufu_id
    ? 'not_created'
    : entry?.failed
      ? 'failed'
      : entry?.ready
        ? 'ready'
        : 'pending';
  return {
    entry,
    metadata: {
      question_id: questionId,
      project_id: pufu.project_id,
      updated_at: pufu.updated_at,
      status,
      phase: row.current_phase,
      revision: row.revision,
      ...(entry?.ready
        ? {
            image_id: entry.id,
            mime_type: 'image/png',
            width: entry.width,
            height: entry.height,
            byte_length: entry.byte_length,
          }
        : {}),
      ...(entry?.failed ? { error: entry.error } : {}),
    },
  };
}
export async function readPufuImageContent(
  env: Env,
  principal: Principal,
  questionId: string,
  etag?: string,
) {
  const result = await readPufuImage(env, principal, questionId);
  const entry = result.entry;
  if (!entry?.ready || result.metadata.status !== 'ready')
    throw new HTTPException(409, { message: 'プ譜画像はまだ取得できません。' });
  if (etag && etag !== `"${entry.id}"`)
    throw new HTTPException(412, { message: '画像が更新されています。再取得してください。' });
  const object = await env.CONTENT.get(key(entry));
  if (!object) throw new HTTPException(500, { message: '保存済みのプ譜画像が見つかりません。' });
  if (object.size > imageLimits.maxPngBytes)
    throw new HTTPException(413, { message: '画像の取得上限を超えています。' });
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (
    bytes.length !== entry.byte_length ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  )
    throw new HTTPException(500, { message: '保存済みのプ譜画像が破損しています。' });
  const latest = await readPufuImage(env, principal, questionId);
  if (latest.entry?.id !== entry.id || latest.metadata.status !== 'ready')
    throw new HTTPException(409, { message: '画像が更新されています。再取得してください。' });
  return { bytes, imageId: entry.id };
}
