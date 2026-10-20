import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@resvg/resvg-wasm/index_bg.wasm?module': fileURLToPath(
        new URL('./tests/resvg-wasm.ts', import.meta.url),
      ),
      'cloudflare:workers': fileURLToPath(new URL('./tests/workflow-runtime.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
});
