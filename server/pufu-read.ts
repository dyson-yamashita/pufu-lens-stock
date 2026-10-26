import { HTTPException } from 'hono/http-exception';
import { pufuScoreSchema, type PufuScore } from '../shared/pufu';
import type { Env, Principal } from './env';

// 既存の保存APIと同じ256KiB。切り詰めや、エディターによる補完は行わない。
const maxScoreBytes = 262144;

async function readQuestionPufuRecord(
  env: Env,
  principal: Principal,
  questionId: string | null | undefined,
  pufuId?: string,
) {
  const projectId = principal.tokenProjectId ?? null;
  const selectedId = pufuId ?? null;
  if (!questionId && !pufuId)
    throw new HTTPException(400, { message: 'pufu_idまたはquestion_idを指定してください。' });
  // 問い・保存先の権限と選択する局面を同じ読み取りで確定する。
  const query = questionId
    ? env.DB.prepare(
        `SELECT q.id AS question_id,q.project_id,pf.id AS pufu_id,pf.current_phase,
      pf.score_json,ph.score_json AS phase_score_json,pf.updated_at,pf.revision,pf.status AS pufu_status
    FROM questions q JOIN projects p ON p.id=q.project_id
    LEFT JOIN pufu_scores pf ON pf.id=(
      SELECT id FROM pufu_scores WHERE question_id=q.id AND user_id=p.user_id
        AND (? IS NOT NULL OR status='ready') AND (? IS NULL OR id=?)
      ORDER BY created_at DESC,id DESC LIMIT 1
    )
    LEFT JOIN pufu_phases ph ON ph.pufu_id=pf.id AND ph.number=pf.current_phase
    WHERE q.id=? AND p.user_id=? AND (? IS NULL OR q.project_id=?)`,
      ).bind(
        selectedId,
        selectedId,
        selectedId,
        questionId,
        principal.user.id,
        projectId,
        projectId,
      )
    : env.DB.prepare(
        `SELECT pf.question_id,pf.project_id,pf.id AS pufu_id,pf.current_phase,
      pf.score_json,ph.score_json AS phase_score_json,pf.updated_at,pf.revision,pf.status AS pufu_status
      FROM pufu_scores pf JOIN projects p ON p.id=pf.project_id
      LEFT JOIN pufu_phases ph ON ph.pufu_id=pf.id AND ph.number=pf.current_phase
      WHERE pf.id=? AND pf.user_id=? AND p.user_id=? AND (? IS NULL OR p.id=?)`,
      ).bind(pufuId, principal.user.id, principal.user.id, projectId, projectId);
  const row = await query.first<{
    question_id: string | null;
    project_id: string;
    pufu_id: string | null;
    current_phase: number | null;
    score_json: string | null;
    phase_score_json: string | null;
    updated_at: string | null;
    revision: number | null;
    pufu_status: string | null;
  }>();
  if (!row) throw new HTTPException(404, { message: '問い・気づきが見つかりません。' });
  if (pufuId !== undefined && !row.pufu_id)
    throw new HTTPException(404, { message: 'プ譜が見つかりません。' });
  if (row.pufu_id && row.pufu_status !== 'ready')
    throw new HTTPException(409, {
      message: 'プ譜の作成が完了していません。問い・気づきの詳細で処理状態を確認してください。',
    });
  return row;
}
export async function readQuestionPufuSnapshot(
  env: Env,
  principal: Principal,
  questionId: string | null | undefined,
  pufuId?: string,
) {
  const row = await readQuestionPufuRecord(env, principal, questionId, pufuId);
  let projectScore: PufuScore | null = null;
  if (row.pufu_id) {
    // 第1局面は旧データの移行処理と同じく本体を参照し、局面行を作成・更新しない。
    const json = row.current_phase === 1 ? row.score_json : row.phase_score_json;
    if (json && new TextEncoder().encode(json).byteLength > maxScoreBytes)
      throw new HTTPException(413, { message: 'プ譜が取得上限（256KiB）を超えています。' });
    try {
      const value: unknown = json === null ? null : JSON.parse(json);
      if (!pufuScoreSchema.safeParse(value).success) throw new Error('invalid_score');
      // 検証結果で置き換えず、保存済みの値・任意項目・配列順序をそのまま返す。
      projectScore = value as PufuScore;
    } catch {
      throw new HTTPException(500, {
        message: '保存済みプ譜の形式が正しくないため取得できません。',
      });
    }
  }
  return {
    pufuId: row.pufu_id,
    phase: row.current_phase,
    revision: row.revision,
    pufu: {
      question_id: row.question_id,
      project_id: row.project_id,
      updated_at:
        row.pufu_id && row.updated_at && Number.isFinite(Date.parse(row.updated_at))
          ? row.updated_at
          : null,
      projectScore,
    },
  };
}
export async function readQuestionPufu(
  env: Env,
  principal: Principal,
  questionId: string | null | undefined,
  pufuId?: string,
) {
  const snapshot = await readQuestionPufuSnapshot(env, principal, questionId, pufuId);
  return pufuId === undefined
    ? snapshot.pufu
    : {
        pufu_id: snapshot.pufuId,
        revision: snapshot.revision,
        phase: snapshot.phase,
        ...snapshot.pufu,
      };
}
