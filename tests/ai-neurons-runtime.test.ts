import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

it('実際のWorkersランタイムで非同期の計測コンテキストを隔離する', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: new URL('..', import.meta.url).pathname,
      contents: `import { meteredOperation, observeAiUsage } from './server/ai-neurons';
        export default { async fetch() {
          const rows = [];
          const env = { DB: { prepare: () => ({ bind: (...values) => ({ run: async () => rows.push(values) }) }) } };
          const model = '@cf/google/gemma-4-26b-a4b-it';
          const run = (id, tokens) => meteredOperation(env, id, id, async () => {
            await new Promise(resolve => setTimeout(resolve, id === 'alice' ? 5 : 1));
            observeAiUsage(model, { usage: { prompt_tokens: tokens, completion_tokens: 0 } });
            return {};
          });
          await Promise.all([run('alice',1000),run('bob',2000)]);
          return Response.json(rows);
        } };`,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    external: ['node:async_hooks'],
  });
  const runtime = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-30',
    compatibilityFlags: ['nodejs_compat'],
  });
  try {
    const response = await runtime.dispatchFetch('http://localhost/');
    const rows = (await response.json()) as [string, number, number, string, string][];
    expect(rows.map((row) => [row[3], row[1], row[2]]).sort()).toEqual([
      ['alice', 9_091_000, 1],
      ['bob', 18_182_000, 1],
    ]);
  } finally {
    await runtime.dispose();
  }
});
