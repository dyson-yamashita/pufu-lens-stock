import { projectScopeJson } from './project-access';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import { appendSavedPufuPhaseSchema, pufuScoreSchema, type PufuScore } from '../shared/pufu';
import type { Env, Principal } from './env';
import { hash } from './security';
import { now } from './db';

type Receipt = {
  pufu_id: string;
  request_hash: string;
  phase: number;
  revision: number;
  updated_at: string;
  comment_id: string | null;
};

// Webの「現在局面を保存して複製」と異なり、MCPでは既存局面を変更しない。
export async function appendSavedPufuPhase(
  env: Env,
  principal: Principal,
  data: z.infer<typeof appendSavedPufuPhaseSchema>,
) {
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 262144)
    throw new HTTPException(413, { message: '送信内容が大きすぎます。' });
  const owner =
    'pf.id=? AND pf.user_id=? AND EXISTS (SELECT 1 FROM projects p WHERE p.id=pf.project_id AND p.user_id=pf.user_id) AND (? IS NULL OR pf.project_id IN (SELECT value FROM json_each(?)))';
  const ownerValues = [
    data.pufu_id,
    principal.user.id,
    projectScopeJson(principal),
    projectScopeJson(principal),
  ];
  const pufu = await env.DB.prepare(
    `SELECT pf.project_id,pf.status,pf.current_phase,pf.revision,
      CASE WHEN pf.current_phase=1 THEN pf.score_json ELSE ph.score_json END AS score_json
     FROM pufu_scores pf LEFT JOIN pufu_phases ph ON ph.pufu_id=pf.id AND ph.number=pf.current_phase
     WHERE ${owner}`,
  )
    .bind(...ownerValues)
    .first<{
      project_id: string;
      status: string;
      current_phase: number;
      revision: number;
      score_json: string | null;
    }>();
  if (!pufu) throw new HTTPException(404, { message: 'プ譜が見つかりません。' });
  const requestHash = await hash(
    JSON.stringify({
      revision: data.revision,
      projectScore: data.projectScore ?? null,
      reason: data.reason ?? null,
    }),
  );
  const loadReceipt = () =>
    env.DB.prepare(
      `SELECT pufu_id,request_hash,phase,revision,updated_at,comment_id FROM pufu_phase_requests
       WHERE user_id=? AND request_id=? AND EXISTS (SELECT 1 FROM pufu_scores pf WHERE ${owner})`,
    )
      .bind(principal.user.id, data.request_id, ...ownerValues)
      .first<Receipt>();
  const response = (receipt: Receipt, created: boolean) => {
    if (receipt.pufu_id !== data.pufu_id || receipt.request_hash !== requestHash)
      throw new HTTPException(409, {
        message: '同じリクエストIDで異なる局面追加が送信されました。',
      });
    return {
      pufu_id: receipt.pufu_id,
      phase: receipt.phase,
      current_phase: receipt.phase,
      revision: receipt.revision,
      updated_at: receipt.updated_at,
      created,
      ...(receipt.comment_id ? { comment_id: receipt.comment_id } : {}),
    };
  };
  const previous = await loadReceipt();
  if (previous) return response(previous, false);
  if (pufu.status !== 'ready' || pufu.revision !== data.revision)
    throw new HTTPException(409, {
      message: '最新の完成済みプ譜とrevisionを取得してから追加してください。',
    });
  let source: PufuScore;
  if (pufu.score_json && new TextEncoder().encode(pufu.score_json).byteLength > 262144)
    throw new HTTPException(413, { message: 'プ譜が保存上限（256KiB）を超えています。' });
  try {
    const value: unknown = JSON.parse(pufu.score_json ?? 'null');
    if (!pufuScoreSchema.safeParse(value).success) throw new Error('invalid_score');
    source = value as PufuScore;
  } catch {
    throw new HTTPException(500, {
      message: '保存済みプ譜の形式が正しくないため局面を追加できません。',
    });
  }
  const score = data.projectScore ?? source;
  const json = JSON.stringify(score);
  if (new TextEncoder().encode(json).byteLength > 262144)
    throw new HTTPException(413, { message: 'プ譜が保存上限（256KiB）を超えています。' });
  const timestamp = now();
  const operationId = crypto.randomUUID();
  const commentId = data.reason ? `phase-comment-${principal.user.id}-${data.request_id}` : null;
  const guard = `${owner} AND pf.project_id=? AND pf.status='ready' AND pf.revision=? AND pf.current_phase=?`;
  const guardValues = [...ownerValues, pufu.project_id, data.revision, pufu.current_phase];
  const receiptGuard =
    'SELECT 1 FROM pufu_phase_requests WHERE user_id=? AND request_id=? AND operation_id=?';
  const receiptValues = [principal.user.id, data.request_id, operationId];
  // 今回のINSERTだけが発行したoperation_idで後続を制限する。再送では書込みを行わない。
  const statements = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO pufu_phase_requests
       (user_id,request_id,pufu_id,request_hash,operation_id,phase,revision,updated_at,comment_id)
       SELECT pf.user_id,?,pf.id,?,?,pf.current_phase+1,pf.revision+1,?,? FROM pufu_scores pf WHERE ${guard}`,
    ).bind(data.request_id, requestHash, operationId, timestamp, commentId, ...guardValues),
    env.DB.prepare(
      `INSERT OR IGNORE INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at)
       SELECT pf.id,1,pf.score_json,pf.created_at,pf.updated_at FROM pufu_scores pf
       WHERE ${guard} AND pf.current_phase=1 AND EXISTS (${receiptGuard})`,
    ).bind(...guardValues, ...receiptValues),
    env.DB.prepare(
      `INSERT INTO pufu_phases(pufu_id,number,score_json,created_at,updated_at)
       SELECT pf.id,pf.current_phase+1,?,?,? FROM pufu_scores pf WHERE ${guard} AND EXISTS (${receiptGuard})`,
    ).bind(json, timestamp, timestamp, ...guardValues, ...receiptValues),
  ];
  if (data.reason)
    statements.push(
      env.DB.prepare(
        `INSERT INTO comments(id,target_type,target_id,phase,body,author_id,author_kind,created_at)
       SELECT ?,'pufu',pf.id,pf.current_phase+1,?,?,?,? FROM pufu_scores pf
       WHERE ${guard} AND EXISTS (${receiptGuard})`,
      ).bind(
        commentId,
        data.reason,
        principal.user.id,
        principal.kind === 'mcp' ? 'agent' : 'user',
        timestamp,
        ...guardValues,
        ...receiptValues,
      ),
    );
  statements.push(
    env.DB.prepare(
      `UPDATE pufu_scores AS pf SET score_json=?,task=?,current_phase=current_phase+1,revision=revision+1,updated_at=?
     WHERE ${guard} AND EXISTS (${receiptGuard})`,
    ).bind(json, score.gainingGoal.text, timestamp, ...guardValues, ...receiptValues),
  );
  const results = await env.DB.batch(statements);
  const receipt = await loadReceipt();
  if (!receipt)
    throw new HTTPException(409, {
      message: '別の画面で更新されています。最新のプ譜を取得してください。',
    });
  return response(receipt, Boolean(results[0].meta.changes));
}
