import { readFileSync, readdirSync } from 'node:fs';
import type { Plugin } from 'vite';

// 補助WorkerはASSETS非対応のため、CMapだけをPDF専用バンドルへ同梱する。
export function pdfCmapsSource(): string {
  const directory = new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url);
  const cmaps = Object.fromEntries(
    readdirSync(directory)
      .filter((name) => name.endsWith('.bcmap'))
      .map((name) => [name, readFileSync(new URL(name, directory)).toString('base64')]),
  );
  const license = readFileSync(new URL('LICENSE', directory), 'utf8');
  return `/*! PDF.js CMaps\n${license} */\nexport default ${JSON.stringify(cmaps)};`;
}

export function pdfCmapsPlugin(): Plugin {
  return {
    name: 'pdf-cmaps',
    resolveId(id) {
      if (id === 'virtual:pdf-cmaps') return '\0virtual:pdf-cmaps';
    },
    generateBundle(_options, bundle) {
      const license = readFileSync(
        new URL('../node_modules/pdfjs-dist/cmaps/LICENSE', import.meta.url),
        'utf8',
      );
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && '\0virtual:pdf-cmaps' in output.modules)
          output.code = `/*! PDF.js CMaps\n${license} */\n${output.code}`;
      }
    },
    load(id) {
      if (id === '\0virtual:pdf-cmaps') return pdfCmapsSource();
    },
  };
}
