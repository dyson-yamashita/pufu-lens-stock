import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import prefixSelector from 'postcss-prefix-selector';

export default defineConfig({
  plugins: [react(), cloudflare()],
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
});
