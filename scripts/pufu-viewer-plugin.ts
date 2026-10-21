import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export function pufuViewerPlugin(): Plugin {
  const root = new URL('../src/mcp-pufu-viewer/', import.meta.url);
  return {
    name: 'pufu-mcp-app-html',
    resolveId: (id) => (id === 'virtual:pufu-viewer-html' ? '\0pufu-viewer-html' : undefined),
    load(id) {
      if (id !== '\0pufu-viewer-html') return;
      for (const name of ['index.html', 'main.ts', 'controller.ts', 'style.css'])
        this.addWatchFile(fileURLToPath(new URL(name, root)));
      const bundle = buildSync({
        entryPoints: [fileURLToPath(new URL('main.ts', root))],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'es2022',
        minify: true,
        legalComments: 'inline',
      }).outputFiles[0].text;
      const html = readFileSync(new URL('index.html', root), 'utf8')
        .replace('/* VIEWER_STYLE */', () => readFileSync(new URL('style.css', root), 'utf8'))
        .replace('/* VIEWER_SCRIPT */', () => bundle.replace(/<\/script/gi, '<\\/script'));
      return `export default ${JSON.stringify(html)}`;
    },
  };
}
