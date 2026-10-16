import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import prefixSelector from 'postcss-prefix-selector';
import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// OCRの実行コードと言語データを同一オリジンから配信する（CDNへ送信しない）。
const require = createRequire(import.meta.url);
const tesseractRoot = dirname(require.resolve('tesseract.js/package.json'));
const coreRoot = dirname(
  createRequire(join(tesseractRoot, 'package.json')).resolve('tesseract.js-core/package.json'),
);
for (const directory of ['public/ocr/core', 'public/ocr/lang'])
  mkdirSync(directory, { recursive: true });
copyFileSync(join(tesseractRoot, 'dist/worker.min.js'), 'public/ocr/worker.min.js');
for (const variant of ['lstm', 'simd-lstm']) {
  for (const extension of ['wasm.js', 'wasm']) {
    const file = `tesseract-core-${variant}.${extension}`;
    copyFileSync(join(coreRoot, file), join('public/ocr/core', file));
  }
}
for (const lang of ['jpn', 'eng']) {
  const root = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
  copyFileSync(
    join(root, '4.0.0_best_int', `${lang}.traineddata.gz`),
    `public/ocr/lang/${lang}.traineddata.gz`,
  );
}
copyFileSync(join(tesseractRoot, 'LICENSE.md'), 'public/ocr/LICENSE-tesseract.txt');
copyFileSync(join(coreRoot, 'LICENSE'), 'public/ocr/LICENSE-core.txt');
import { parseEnv } from 'node:util';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    cloudflare({
      config: (config) => {
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
