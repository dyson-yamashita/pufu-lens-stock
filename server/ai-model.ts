import { z } from 'zod';

const deepseek = '@cf/deepseek-ai/deepseek-v4.1-flash-1017';
const gemma = '@cf/google/gemma-4-26b-a4b-it';

// Exact IDs: do not infer API compatibility from a provider or model prefix.
export function structuredOutput(model: string, schema: z.ZodType, name: string) {
  const chat = [
    '@cf/zai-org/glm-4.7-flash',
    '@cf/zai-org/glm-5.3-flash',
    '@cf/moonshotai/kimi-k2.6',
    deepseek,
    gemma,
  ].includes(model);
  return {
    type: 'json_schema' as const,
    json_schema: chat
      ? { name, schema: z.toJSONSchema(schema), strict: true }
      : z.toJSONSchema(schema),
  };
}

export function reasoningOptions(model: string, effort: 'none' | 'low' | 'high') {
  // With the current stage budgets, DeepSeek low exhausted 6,000 tokens in
  // reasoning and returned no final answer. Disable it for these stage budgets.
  if (model === deepseek) return { reasoning_effort: 'none' as const };
  if (model === '@cf/zai-org/glm-5.3-flash')
    return { reasoning_effort: effort === 'none' ? ('low' as const) : effort };
  if (model === '@cf/moonshotai/kimi-k2.6')
    return { reasoning_effort: 'none' as const, chat_template_kwargs: { enable_thinking: false } };
  if (model === gemma || model === '@cf/zai-org/glm-4.7-flash')
    return { chat_template_kwargs: { enable_thinking: false } };
  return {};
}

export function pufuSourceByteLimit(model: string) {
  // Application byte budget, not the provider's token context window.
  // Preserve the extraction coverage after migrating from GLM to DeepSeek.
  return model === deepseek || /^@cf\/zai-org\/glm-(?:4\.7|5\.3)-flash$/.test(model)
    ? 40000
    : 24000;
}
