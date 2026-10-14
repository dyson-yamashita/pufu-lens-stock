import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(new URL('./tests/workflow-runtime.ts', import.meta.url)),
    },
  },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
