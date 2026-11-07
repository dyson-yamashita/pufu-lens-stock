import { normalizeGeneratedScore } from './pufu-output';
import { extractPufuFacts } from './pufu-source-facts';
import { arrangePufu } from './pufu-plan';
import { integratePufuWin } from './pufu-win';
import { reviewPufuWin } from './pufu-win-review';
import { pufuModelLabel } from './pufu-ai';
import type { Env, Job } from './env';
import { isDemo } from './env';
import { now, jobFailureStatements } from './db';
import { aiStep, deferLimitedJob } from './usage';
import {
  elementKeys,
  pufuScoreSchema,
  type PufuContext,
  type PufuGenerationProgress,
  type PufuScore,
} from '../shared/pufu';
import type { WorkflowStep } from 'cloudflare:workers';
import { defaultLanguage, resolveLanguage, translate, type Language } from '../shared/locale';

export type PufuStageRunner = <T extends object>(
  name: string,
  operation: (context: PufuContext) => Promise<T>,
) => Promise<T>;
class PufuSuperseded extends Error {}

// 順番は詳細画面の現在工程にも使う。同じ形式の永続化キーは変更しない。
// 条件保持・意味検証の契約を更新し、旧形式の段階キャッシュによる迂回を防ぐ。
const stages = {
  extract: 'extract-pufu-facts-v2',
  arrange: 'arrange-pufu-v3',
  integrate: 'integrate-pufu-win-v3',
  review: 'review-pufu-win-v2',
  repair: 'repair-pufu-win-v2',
  review_repaired: 'review-repaired-pufu-win-v2',
} satisfies Record<PufuGenerationProgress['stage'], string>;

export function pufuProgressQuery(env: Env, id: string, userId: string): D1PreparedStatement {
  // 固定の工程キーを先に展開し、ai_callsは工程ごとに主キーで検索する。
  return env.DB.prepare(
    `SELECT json_extract(step.value, '$[0]') AS stage, c.attempts AS attempt, c.status
     FROM pufu_scores p JOIN json_each(?) step
     CROSS JOIN ai_calls c ON c.id = 'pufu-job-' || p.id || '-' || p.generation || ':' || json_extract(step.value, '$[1]')
       AND c.user_id = p.user_id
     WHERE p.id = ? AND p.user_id = ? AND p.status = 'generating'
     ORDER BY step.key DESC LIMIT 1`,
  ).bind(JSON.stringify(Object.entries(stages)), id, userId);
}

export async function generatePufu(
  env: Env,
  context: PufuContext,
  language: Language = defaultLanguage,
  stage: PufuStageRunner = (_name, operation) => operation(context),
): Promise<PufuScore> {
  if (isDemo(env) && !env.AI)
    return stage(stages.arrange, async (fresh) => {
      const reference = (
        fresh.question?.text ||
        fresh.stocks?.[0]?.title ||
        fresh.stock?.title ||
        fresh.project.name
      ).slice(0, 100);
      const node = (text: string) => ({
        uuid: crypto.randomUUID(),
        text,
        comment: { color: 'blue' as const, text: '' },
      });
      return normalizeGeneratedScore(
        pufuScoreSchema.parse({
          gainingGoal: node(
            fresh.task || translate(language, 'pufu.inferredGoal', { reference }).slice(0, 200),
          ),
          winCondition: node(
            translate(language, 'pufu.winCondition', {
              task: (fresh.task || reference).slice(0, 100),
            }).slice(0, 240),
          ),
          purposes: [{ ...node(translate(language, 'pufu.purpose.examine')), measures: [] }],
          elements: Object.fromEntries(elementKeys.map((key) => [key, node('')])),
        }),
        fresh,
        language,
      );
    });
  const facts = await stage(stages.extract, (fresh) => extractPufuFacts(env, fresh, language));
  const score = await stage(stages.arrange, (fresh) => arrangePufu(env, fresh, facts, language));
  if (!score.purposes.length) return score;
  let candidate = await stage(stages.integrate, (fresh) =>
    integratePufuWin(env, fresh, facts, score, language),
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    candidate = normalizeGeneratedScore(candidate, context, language, facts.conditions);
    const review = await stage(attempt ? stages.review_repaired : stages.review, (fresh) =>
      reviewPufuWin(env, fresh, facts, candidate, language),
    );
    if (review.winCondition !== candidate.winCondition.text)
      throw new Error('勝利条件と検証対象が一致しません。再試行してください。');
    if (!review.issues.length) return candidate;
    if (!attempt)
      candidate = await stage(stages.repair, (fresh) =>
        integratePufuWin(env, fresh, facts, score, language, {
          winCondition: candidate.winCondition.text,
          issues: review.issues,
        }),
      );
  }
  throw new Error('中間目的と条件を統合した勝利条件を確認できませんでした。再試行してください。');
}

export function queuePufuJob(env: Env, id: string): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT OR IGNORE INTO processing_jobs (id,user_id,kind,target_id,revision) SELECT 'pufu-job-' || id || '-' || generation,user_id,'pufu',id,generation FROM pufu_scores WHERE id = ? AND status = 'queued'",
  ).bind(id);
}
// DB移行後、旧Workerが第1局面の編集・生成を完了した場合も最新のJSONを引き継ぐ。
export function initialPufuPhase(env: Env, id: string, userId: string): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO pufu_phases (pufu_id, number, score_json, created_at, updated_at) SELECT id, 1, score_json, created_at, updated_at FROM pufu_scores WHERE id = ? AND user_id = ? AND status = 'ready' AND current_phase = 1 AND score_json IS NOT NULL ON CONFLICT (pufu_id, number) DO UPDATE SET score_json = excluded.score_json, updated_at = excluded.updated_at WHERE pufu_phases.score_json <> excluded.score_json",
  ).bind(id, userId);
}
export async function runPufu(env: Env, job: Job, step: WorkflowStep) {
  try {
    const context = await step.do('load-pufu-context', async () => {
      const row = await env.DB.prepare(
        "SELECT input_json FROM pufu_scores WHERE id = ? AND user_id = ? AND generation = ? AND status IN ('queued','generating')",
      )
        .bind(job.target_id, job.user_id, job.revision)
        .first<{ input_json: string }>();
      if (!row) return null;
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE pufu_scores SET status = 'generating', error = NULL, updated_at = ? WHERE id = ? AND generation = ? AND status IN ('queued','generating')",
        ).bind(now(), job.target_id, job.revision),
        env.DB.prepare(
          "UPDATE processing_jobs SET status = 'running', updated_at = ? WHERE id = ? AND status != 'done'",
        ).bind(now(), job.id),
      ]);
      return JSON.parse(row.input_json) as PufuContext;
    });
    if (
      context &&
      (await env.DB.prepare(
        "SELECT id FROM pufu_scores WHERE id=? AND user_id=? AND generation=? AND status IN ('queued','generating') AND NOT EXISTS(SELECT 1 FROM privacy_cleanup_jobs WHERE id=?)",
      )
        .bind(job.target_id, job.user_id, job.revision, job.id)
        .first())
    ) {
      const active = () =>
        env.DB.prepare(
          "SELECT id FROM pufu_scores WHERE id=? AND user_id=? AND generation=? AND status IN ('queued','generating') AND NOT EXISTS(SELECT 1 FROM privacy_cleanup_jobs WHERE id=?)",
        )
          .bind(job.target_id, job.user_id, job.revision, job.id)
          .first();
      const stage: PufuStageRunner = async (name, operation) => {
        if (!(await active())) throw new PufuSuperseded();
        const result = await aiStep(env, job, step, name, async () => {
          // 各段階とその再試行で再確認する。旧Workflowの入力キャッシュも同じ扱い。
          if (!(await active())) return { value: null };
          // メモリを含む旧Workflow入力も、generationInputで送信対象から除く。
          return { value: await operation(context) };
        });
        // キャンセルはAIステップの外で扱い、Workflowに再試行させない。
        if (!result.value) throw new PufuSuperseded();
        return result.value;
      };
      const score = await generatePufu(env, context, resolveLanguage(job.language), stage);
      await step.do('save-pufu', async () => {
        // Save the reviewed score without another transformation of its elements.
        const normalized = pufuScoreSchema.parse(score);
        if (normalized.winCondition.text !== score.winCondition.text)
          throw new Error('検証後の勝利条件が変化しました。再試行してください。');
        const json = JSON.stringify(normalized);
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE pufu_scores SET generated_json = ?, score_json = ?, input_json = json_set(input_json, '$.userMemory', NULL, '$.projectMemory', NULL), task = ?, status = 'ready', error = NULL, model = ?, updated_at = ? WHERE id = ? AND user_id = ? AND generation = ? AND status IN ('queued','generating') AND NOT EXISTS(SELECT 1 FROM privacy_cleanup_jobs WHERE id=?)",
          ).bind(
            json,
            json,
            normalized.gainingGoal.text,
            isDemo(env) && !env.AI ? 'local-pufu-template' : pufuModelLabel(env),
            now(),
            job.target_id,
            job.user_id,
            job.revision,
            job.id,
          ),
          env.DB.prepare(
            "INSERT OR IGNORE INTO pufu_phases (pufu_id, number, score_json, created_at, updated_at) SELECT id, 1, score_json, created_at, updated_at FROM pufu_scores WHERE id = ? AND user_id = ? AND generation = ? AND status = 'ready' AND current_phase = 1",
          ).bind(job.target_id, job.user_id, job.revision),
        ]);
      });
    }
    await step.do('finish-pufu-job', async () => {
      await env.DB.prepare(
        "UPDATE processing_jobs SET status = 'done', updated_at = ? WHERE id = ?",
      )
        .bind(now(), job.id)
        .run();
    });
  } catch (error) {
    if (error instanceof PufuSuperseded) {
      await env.DB.prepare("UPDATE processing_jobs SET status='done', updated_at=? WHERE id=?")
        .bind(now(), job.id)
        .run();
      return;
    }
    if (await deferLimitedJob(env, job, error)) return;
    await step.do('record-pufu-failure', async () => {
      await env.DB.batch(
        jobFailureStatements(env, job, 'プ譜を生成できませんでした。再試行してください。'),
      );
    });
    throw error;
  }
}
