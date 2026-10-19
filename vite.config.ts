import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import prefixSelector from 'postcss-prefix-selector';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { productionAppUrl, productionResourceIds } from './scripts/production-config';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    cloudflare({
      config: (config) => {
        if (command === 'build' && process.env.CLOUDFLARE_ENV === 'production') {
          const appUrl = productionAppUrl(process.env.APP_URL);
          const { databaseId, oauthKvId } = productionResourceIds(process.env);
          config.vars = { ...config.vars, APP_URL: appUrl };
          // Returned arrays are concatenated by the plugin; update existing bindings in place.
          for (const database of config.d1_databases ?? []) {
            if (database.binding === 'DB') database.database_id = databaseId;
          }
          for (const namespace of config.kv_namespaces ?? []) {
            if (namespace.binding === 'OAUTH_KV') namespace.id = oauthKvId;
          }
          return;
        }
        if (command !== 'serve' || config.ai) return;
        const envFile = process.env.CLOUDFLARE_ENV
          ? `.dev.vars.${process.env.CLOUDFLARE_ENV}`
          : '.dev.vars';
        const path = existsSync(envFile) ? envFile : '.dev.vars';
        const vars = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
        if ((process.env.WORKERS_AI_ENABLED ?? vars.WORKERS_AI_ENABLED) === 'true')
          return { ai: { binding: 'AI', remote: true } };
      },
    }),
  ],
  resolve: { dedupe: ['react', 'react-dom'] },
  css: {
    postcss: {
      plugins: [
        prefixSelector({
          prefix: '.pufu-editor-root',
          includeFiles: [/node_modules\/@goto-lab\/pufu-editor\/dist\/index\.css$/],
          transform: (prefix, selector, prefixed) =>
            ['html', 'body', ':root', ':host'].includes(selector) ? prefix : prefixed,
        }),
      ],
    },
  },
  server: { port: 5173, strictPort: true },
}));
