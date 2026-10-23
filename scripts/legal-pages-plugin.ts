import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Plugin } from 'vite';
import LegalPage from '../src/LegalPage';

export function legalPagesPlugin(): Plugin {
  return {
    name: 'pufu-legal-pages',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const index = bundle['index.html'];
      // CloudflareのWorkerビルドではなく、クライアントのHTMLだけを対象にする。
      if (index?.type !== 'asset') return;
      const template = String(index.source);
      for (const page of ['privacy', 'terms'] as const) {
        const title = page === 'privacy' ? 'プライバシーポリシー' : '利用規約';
        const source = template
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${title} | Pufu Lens</title>`)
          .replace(/<!--app-html-->[\s\S]*?<!--\/app-html-->/, () =>
            renderToStaticMarkup(createElement(LegalPage, { page })),
          )
          // 静的な本文と通常のリンクだけで読める。テーマ用スクリプトは維持する。
          .replace(/<script\b[^>]*\btype="module"[^>]*>[\s\S]*?<\/script>/g, '');
        this.emitFile({ type: 'asset', fileName: `${page}/index.html`, source });
      }
    },
  };
}
