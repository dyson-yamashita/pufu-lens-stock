import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import prefixSelector from 'postcss-prefix-selector';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { productionAppUrl } from './scripts/production-app-url';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    cloudflare({
      config: (config) => {
        if (command === 'build' && process.env.CLOUDFLARE_ENV === 'production')
          return { vars: { ...config.vars, APP_URL: productionAppUrl(process.env.APP_URL) } };
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
