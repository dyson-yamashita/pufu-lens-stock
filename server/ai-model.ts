import { z } from 'zod';

const deepseek = '@cf/deepseek-ai/deepseek-v4.1-flash-1017';
const gemma = '@cf/google/gemma-4-26b-a4b-it';

// Exact IDs: do not infer API compatibility from a provider or model prefix.
export function structuredOutput(model: string, schema: z.ZodType, name: string) {
  const chat = [deepseek, gemma].includes(model);
  return {
    type: 'json_schema' as const,
    json_schema: chat
      ? { name, schema: z.toJSONSchema(schema), strict: true }
      : z.toJSONSchema(schema),
  };
}

export function reasoningOptions(model: string) {
  // With the current stage budgets, DeepSeek low exhausted 6,000 tokens in
  // reasoning and returned no final answer. Disable it for these stage budgets.
  if (model === deepseek) return { reasoning_effort: 'none' as const };
  if (model === gemma) return { chat_template_kwargs: { enable_thinking: false } };
  return {};
}

export function pufuSourceByteLimit(model: string) {
  // Application byte budget, not the provider's token context window.
  return model === deepseek ? 40000 : 24000;
}
