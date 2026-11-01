import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import type { Plugin } from 'vite';
import LegalPage from '../src/LegalPage';
import UserManual from '../src/UserManual';
import HomeShell from '../src/HomeShell';
import { setServerLanguage, translateUi } from '../src/i18n';
import {
  homeHreflang,
  homeJsonLd,
  jsonLdScript,
  legalHreflang,
  manualHreflang,
  manualJsonLd,
} from '../shared/seo';
import {
  absoluteUrl,
  homePath,
  legalPath,
  manualPath,
  siteOrigin,
  type LegalPage as LegalPageName,
} from '../shared/site-paths';
import type { Language } from '../shared/locale';

function origin(): string {
  return siteOrigin(process.env.APP_URL);
}

function removeModuleScripts(document: Document) {
  for (const script of document.querySelectorAll('script')) {
    const type = [...script.attributes].find(
      (attribute) => attribute.name.toLowerCase() === 'type',
    )?.value;
    if (type?.toLowerCase() === 'module') script.remove();
  }
}

function ensureCanonical(document: Document, path: string) {
  const href = absoluteUrl(path, origin());
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
}

function appendHeadHtml(document: Document, html: string) {
  const { document: fragment } = parseHTML(`<html><head>${html}</head></html>`);
  for (const node of [...fragment.head.childNodes]) {
    document.head.appendChild(node);
  }
}

function prepareDocument(
  template: string,
  options: {
    language: Language;
    title: string;
    description: string;
    path: string;
    hreflang: string;
    jsonLd: unknown;
    body: string;
    keepModule?: boolean;
  },
) {
  const { document } = parseHTML(template);
  document.title = options.title;
  document.documentElement.lang = options.language;
  document.documentElement.dir = 'ltr';
  document.querySelector('meta[name="description"]')?.setAttribute('content', options.description);
  ensureCanonical(document, options.path);
  appendHeadHtml(document, `${options.hreflang}${jsonLdScript(options.jsonLd)}`);
  // Keep the public-page SSR markers: Japanese home becomes ASSETS `/` and
  // server/public-pages.ts replaces only the marked region.
  document.getElementById('root')!.innerHTML =
    `<!--public-root-start-->${options.body}<!--public-root-end-->`;
  if (!options.keepModule) removeModuleScripts(document);
  return document.toString();
}

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
      const site = origin();

      for (const language of ['ja', 'en'] as const) {
        setServerLanguage(language);
        const homeBody = renderToStaticMarkup(createElement(HomeShell, { language }));
        const homeHtml = prepareDocument(template, {
          language,
          title: translateUi(language, 'site.title'),
          description: translateUi(language, 'site.description'),
          path: homePath(language),
          hreflang: homeHreflang(site),
          jsonLd: homeJsonLd(language, site),
          body: homeBody,
          keepModule: true,
        });
        if (language === 'ja') {
          index.source = homeHtml;
        } else {
          this.emitFile({ type: 'asset', fileName: 'en/index.html', source: homeHtml });
        }

        setServerLanguage(language);
        const manualBody = renderToStaticMarkup(createElement(UserManual, { language }));
        this.emitFile({
          type: 'asset',
          fileName: `${language === 'en' ? 'en/' : ''}manual/index.html`,
          source: prepareDocument(template, {
            language,
            title: translateUi(language, 'ui.user_manual.user_manual_pufu_lens'),
            description: translateUi(
              language,
              'ui.user_manual.a_basic_guide_to_collecting_articles_developing_questions_and',
            ),
            path: manualPath(language),
            hreflang: manualHreflang(site),
            jsonLd: manualJsonLd(language, site),
            body: manualBody,
          }),
        });

        for (const page of ['privacy', 'terms'] as const satisfies LegalPageName[]) {
          const title =
            page === 'privacy'
              ? language === 'en'
                ? 'Privacy Policy'
                : 'プライバシーポリシー'
              : language === 'en'
                ? 'Terms of Service'
                : '利用規約';
          const description =
            language === 'en'
              ? `${title} for Pufu Lens. English translation; the Japanese original governs.`
              : `Pufu Lensの${title}。`;
          this.emitFile({
            type: 'asset',
            fileName: `${language === 'en' ? 'en/' : ''}${page}/index.html`,
            source: prepareDocument(template, {
              language,
              title: `${title} | Pufu Lens`,
              description,
              path: legalPath(page, language),
              hreflang: legalHreflang(page, site),
              jsonLd: {
                '@context': 'https://schema.org',
                '@type': 'WebPage',
                name: title,
                url: absoluteUrl(legalPath(page, language), site),
                inLanguage: language,
                isPartOf: { '@id': `${site}/#website` },
              },
              body: renderToStaticMarkup(createElement(LegalPage, { page, language })),
            }),
          });
        }
      }

      // Hard 404 HTML is generated by the Worker (publicPagesApp notFound) so secureHeaders apply.
      // Do not emit Assets 404.html / not_found_handling=404-page; that would bypass the Worker.
    },
  };
}
