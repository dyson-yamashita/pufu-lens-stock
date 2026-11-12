import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import type { Env } from './env';

// Neurons per million tokens, from the official pricing table on 2026-11-12.
// https://developers.cloudflare.com/workers-ai/platform/pricing/
// Values are converted once at invocation time; tariff changes never reprice history.
const rates: Record<string, { input: number; output: number; cached?: number; embedding?: true }> =
  {
    '@cf/google/gemma-4-26b-a4b-it': { input: 9091, output: 27273 },
    '@cf/deepseek-ai/deepseek-v4.1-flash-1017': { input: 27273, output: 109091, cached: 545 },
    '@cf/zai-org/glm-4.7-flash': { input: 5500, output: 36400 },
    '@cf/zai-org/glm-5.3-flash': { input: 13636, output: 45455, cached: 2727 },
    '@cf/moonshotai/kimi-k2.6': { input: 86364, output: 363636, cached: 14545 },
    '@cf/baai/bge-m3': { input: 1075, output: 0, embedding: true },
  };
const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const responseUsage = z.object({
  usage: z.object({
    prompt_tokens: tokens.optional(),
    completion_tokens: tokens.optional(),
    total_tokens: tokens.optional(),
    prompt_tokens_details: z.object({ cached_tokens: tokens.optional() }).nullish(),
    prompt_cache_hit_tokens: tokens.optional(),
  }),
});
export function neuronMicros(model: string, response: unknown): number | null {
  const rate = rates[model];
  const parsed = responseUsage.safeParse(response);
  if (!rate || !parsed.success) return null;
  const usage = parsed.data.usage;
  const input = usage.prompt_tokens ?? (rate.embedding ? usage.total_tokens : undefined);
  const output = rate.embedding ? 0 : usage.completion_tokens;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
  if (input === undefined || output === undefined || cached > input) return null;
  // completion_tokens already includes reasoning tokens. Do not count them twice.
  const micros =
    (input - cached) * rate.input + cached * (rate.cached ?? rate.input) + output * rate.output;
  return Number.isSafeInteger(micros) ? micros : null;
}

type Meter = { micros: number; complete: boolean; models: Set<string> };
// AsyncLocalStorage isolates concurrent users and Workflow attempts; never enterWith().
const meters = new AsyncLocalStorage<Meter>();
export function observeAiUsage(model: string, response: unknown) {
  const meter = meters.getStore();
  if (!meter) return;
  meter.models.add(model);
  const micros = neuronMicros(model, response);
  if (micros === null || !Number.isSafeInteger(meter.micros + micros)) meter.complete = false;
  else meter.micros += micros;
}
export async function saveAiUsage(
  env: Env,
  userId: string,
  attempt: string,
  model: string,
  micros: number | null,
  complete: boolean,
) {
  try {
    await env.DB.prepare(
      `UPDATE ai_attempts SET usage_model=?, neurons_micros=?, usage_complete=?
       WHERE id=? AND user_id=? AND usage_model IS NULL`,
    )
      .bind(model, micros, complete ? 1 : 0, attempt, userId)
      .run();
  } catch {
    // Metering failures must not reissue an already completed inference. The
    // existing daily call remains explicitly unmeasured and can be investigated.
    console.error('ai_usage_persistence_failed', { attempt });
  }
}
export function meteredOperation<T>(
  env: Env,
  userId: string,
  attempt: string,
  operation: () => Promise<T>,
): Promise<T> {
  const meter: Meter = { micros: 0, complete: true, models: new Set() };
  return meters.run(meter, async () => {
    try {
      return await operation();
    } finally {
      await saveAiUsage(
        env,
        userId,
        attempt,
        [...meter.models].join(' + '),
        meter.micros,
        meter.complete,
      );
    }
  });
}
