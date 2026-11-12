import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { pufuViewerPlugin } from './scripts/pufu-viewer-plugin';
import { socialImagePath } from './scripts/social-image';

export default defineConfig({
  define: { __PUFU_SOCIAL_IMAGE_PATH__: JSON.stringify(socialImagePath) },
  plugins: [pufuViewerPlugin()],
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
    maxWorkers: '100%',
    testTimeout: 20000,
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
});
