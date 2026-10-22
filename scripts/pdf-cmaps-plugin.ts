import { readFileSync, readdirSync } from 'node:fs';
import type { Plugin } from 'vite';

// CMapは静的資産に置き、Worker本体のサイズを増やさず外部通信も不要にする。
export function pdfCmapsPlugin(): Plugin {
  const directory = new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url);
  const names = readdirSync(directory).filter(
    (name) => name.endsWith('.bcmap') || name === 'LICENSE',
  );
  return {
    name: 'pdf-cmaps',
    configureServer(server) {
      server.middlewares.use('/pdf-cmaps', (request, response, next) => {
        const name = new URL(request.url ?? '/', 'http://localhost').pathname.slice(1);
        if (!names.includes(name)) return next();
        response.setHeader('Content-Type', 'application/octet-stream');
        response.end(readFileSync(new URL(name, directory)));
      });
    },
    generateBundle() {
      if (this.environment.name !== 'client') return;
      for (const name of names)
        this.emitFile({
          type: 'asset',
          fileName: `pdf-cmaps/${name}`,
          source: readFileSync(new URL(name, directory)),
        });
    },
  };
}
