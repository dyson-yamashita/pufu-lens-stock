import { z } from 'zod';
import { parseAiJson } from './ai';
import { invokeAi } from './usage';
import type { Env } from './env';
import { pufuSourceByteLimit, reasoningOptions, structuredOutput } from './ai-model';

export const pufuModel = (env: Env) => env.AI_PUFU_MODEL || env.AI_MODEL;
export const pufuPlanModel = (env: Env) => env.AI_PUFU_PLAN_MODEL || pufuModel(env);
export const pufuModelLabel = (env: Env) =>
  [...new Set([pufuModel(env), pufuPlanModel(env)])].join(' + ');
export const pufuInputLimit = (env: Env) => pufuSourceByteLimit(pufuModel(env));
export const inputBytes = (value: string) => new TextEncoder().encode(value).length;

export async function callPufuModel<T>(
  env: Env,
  system: string,
  input: object,
  schema: z.ZodType<T>,
  maxTokens: number,
  byteLimit: number,
  reasoningEffort: 'low' | 'high' = 'low',
): Promise<T> {
  if (!env.AI) throw new Error('Workers AIが未設定です。');
  const model = pufuModel(env);
  const content = JSON.stringify(input);
  if (inputBytes(system + content) > byteLimit)
    throw new Error('プ譜の入力上限を超えています。補足を短くしてください。');
  const response = await invokeAi(
    { ...env, AI_MODEL: model },
    {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      max_tokens: maxTokens,
      temperature: 0,
      ...reasoningOptions(model, reasoningEffort),
      response_format: structuredOutput(model, schema, 'pufu'),
    },
  );
  // 推論文は保存せず、最終回答だけを受け取る。
  return parseAiJson(response, schema);
}
