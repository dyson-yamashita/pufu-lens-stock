import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
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
      for (const language of ['ja', 'en'] as const) {
        for (const page of ['privacy', 'terms'] as const) {
          const title =
            page === 'privacy'
              ? language === 'en'
                ? 'Privacy Policy'
                : 'プライバシーポリシー'
              : language === 'en'
                ? 'Terms of Service'
                : '利用規約';
          const { document } = parseHTML(template);
          document.title = `${title} | Pufu Lens`;
          document.documentElement.lang = language;
          document.documentElement.dir = 'ltr';
          document
            .querySelector('meta[name="description"]')
            ?.setAttribute(
              'content',
              language === 'en'
                ? `${title} for Pufu Lens. English translation; the Japanese original governs.`
                : `Pufu Lensの${title}。`,
            );
          document.getElementById('root')!.innerHTML = renderToStaticMarkup(
            createElement(LegalPage, { page, language }),
          );
          // 要素としてmodule scriptを除去し、テーマ用スクリプトは維持する。
          for (const script of document.querySelectorAll('script')) {
            // linkedomはTYPEのような属性名も保持するため、大文字小文字を正規化する。
            const type = [...script.attributes].find(
              (attribute) => attribute.name.toLowerCase() === 'type',
            )?.value;
            if (type?.toLowerCase() === 'module') script.remove();
          }
          this.emitFile({
            type: 'asset',
            fileName: `${language === 'en' ? 'en/' : ''}${page}/index.html`,
            source: document.toString(),
          });
        }
      }
    },
  };
}
