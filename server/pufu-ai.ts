import { z } from 'zod';
import { parseAiJson } from './ai';
import { invokeAi } from './usage';
import type { Env } from './env';

export const pufuModel = (env: Env) => env.AI_PUFU_MODEL || env.AI_MODEL;
export const pufuPlanModel = (env: Env) => env.AI_PUFU_PLAN_MODEL || pufuModel(env);
export const pufuModelLabel = (env: Env) =>
  [...new Set([pufuModel(env), pufuPlanModel(env)])].join(' + ');
export const pufuInputLimit = (env: Env) =>
  /^@cf\/zai-org\/glm-(?:4\.7|5\.3)-flash$/.test(pufuModel(env)) ? 40000 : 24000;
export const inputBytes = (value: string) => new TextEncoder().encode(value).length;
const chatAnswerSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

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
  const latest = model === '@cf/zai-org/glm-5.3-flash';
  const kimi = model === '@cf/moonshotai/kimi-k2.6';
  const chat = latest || kimi || model === '@cf/zai-org/glm-4.7-flash';
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
      temperature: 0.2,
      ...(kimi
        ? { reasoning_effort: 'none' as const, chat_template_kwargs: { enable_thinking: false } }
        : latest
          ? { reasoning_effort: reasoningEffort }
          : chat
            ? { chat_template_kwargs: { enable_thinking: false } }
            : {}),
      response_format: {
        type: 'json_schema',
        json_schema: chat
          ? { name: 'pufu', schema: z.toJSONSchema(schema), strict: true }
          : z.toJSONSchema(schema),
      },
    },
  );
  const answer = chatAnswerSchema.safeParse(response);
  // 推論文は保存せず、最終回答だけを受け取る。
  return parseAiJson(
    answer.success ? { response: answer.data.choices[0].message.content } : response,
    schema,
  );
}
