import type { Language } from './locale';
import {
  absoluteUrl,
  homePath,
  legalPath,
  manualPath,
  siteOrigin,
  type LegalPage,
} from './site-paths';

export function jsonLdScript(data: unknown): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

export function hreflangLinks(
  variants: ReadonlyArray<{ language: Language | 'x-default'; path: string }>,
  origin?: string | null,
): string {
  return variants
    .map(
      ({ language, path }) =>
        `<link rel="alternate" hreflang="${language}" href="${escapeAttr(absoluteUrl(path, origin))}">`,
    )
    .join('');
}

export function homeHreflang(origin?: string | null): string {
  return hreflangLinks(
    [
      { language: 'ja', path: homePath('ja') },
      { language: 'en', path: homePath('en') },
      { language: 'x-default', path: homePath('ja') },
    ],
    origin,
  );
}

export function manualHreflang(origin?: string | null): string {
  return hreflangLinks(
    [
      { language: 'ja', path: manualPath('ja') },
      { language: 'en', path: manualPath('en') },
      { language: 'x-default', path: manualPath('ja') },
    ],
    origin,
  );
}

export function legalHreflang(page: LegalPage, origin?: string | null): string {
  return hreflangLinks(
    [
      { language: 'ja', path: legalPath(page, 'ja') },
      { language: 'en', path: legalPath(page, 'en') },
      { language: 'x-default', path: legalPath(page, 'ja') },
    ],
    origin,
  );
}

export function homeJsonLd(language: Language, origin?: string | null) {
  const root = siteOrigin(origin);
  const url = absoluteUrl(homePath(language), root);
  const description =
    language === 'en'
      ? 'Collect articles, explore questions and develop your next idea. Pufu Lens connects your interests and knowledge into memory.'
      : '記事をプロジェクトにストック。集めた知識と関心を、あなたのメモリに。';
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${root}/#organization`,
        name: 'Pufu Lens',
        url: `${root}/`,
        logo: `${root}/pufu-lens-logo.png`,
      },
      {
        '@type': 'WebSite',
        '@id': `${root}/#website`,
        name: 'Pufu Lens',
        url: `${root}/`,
        publisher: { '@id': `${root}/#organization` },
        inLanguage: ['ja', 'en'],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${root}/#software`,
        name: 'Pufu Lens',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url,
        description,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'JPY',
        },
        publisher: { '@id': `${root}/#organization` },
        inLanguage: language,
      },
    ],
  };
}

export function manualJsonLd(language: Language, origin?: string | null) {
  const root = siteOrigin(origin);
  const url = absoluteUrl(manualPath(language), root);
  if (language === 'en') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'HowTo',
          name: 'Get started with Pufu Lens',
          url,
          inLanguage: 'en',
          step: [
            {
              '@type': 'HowToStep',
              position: 1,
              name: 'Review terms and privacy',
              text: 'Sign in with Google, review the Terms of Service and Privacy Policy, check both consent boxes and press OK.',
            },
            {
              '@type': 'HowToStep',
              position: 2,
              name: 'Set your profile',
              text: 'Enter a nickname and choose your display language during registration.',
            },
            {
              '@type': 'HowToStep',
              position: 3,
              name: 'Save stocks',
              text: 'Save interesting article URLs or your own text as stocks in a project.',
            },
            {
              '@type': 'HowToStep',
              position: 4,
              name: 'Explore with Pufu',
              text: 'Choose a question and explore solutions with Pufu.',
            },
          ],
        },
        {
          '@type': 'FAQPage',
          url,
          inLanguage: 'en',
          mainEntity: [
            {
              '@type': 'Question',
              name: 'An article could not be retrieved.',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Open the stock details and use Retry retrieval under Other actions, or paste the article text.',
              },
            },
            {
              '@type': 'Question',
              name: 'A summary or Pufu has not appeared yet.',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Processing after a save can take time. Check the status on the detail screen and wait for completion.',
              },
            },
          ],
        },
      ],
    };
  }
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'HowTo',
        name: 'Pufu Lensのはじめ方',
        url,
        inLanguage: 'ja',
        step: [
          {
            '@type': 'HowToStep',
            position: 1,
            name: '利用規約とプライバシーポリシーを確認',
            text: 'Googleでログインし、利用規約とプライバシーポリシーを確認して同意にチェックを入れ、OKを押します。',
          },
          {
            '@type': 'HowToStep',
            position: 2,
            name: 'プロフィールを設定',
            text: 'ニックネームと表示言語を登録します。',
          },
          {
            '@type': 'HowToStep',
            position: 3,
            name: 'ストックを保存',
            text: '気になった記事のURLやテキストをプロジェクトへストックします。',
          },
          {
            '@type': 'HowToStep',
            position: 4,
            name: 'プ譜で考える',
            text: '問いを選び、プ譜で解決の仮説を育てます。',
          },
        ],
      },
      {
        '@type': 'FAQPage',
        url,
        inLanguage: 'ja',
        mainEntity: [
          {
            '@type': 'Question',
            name: '記事を取得できませんでした。',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'ストック詳細の「その他の操作」から再取得するか、本文を貼り付けて補完してください。',
            },
          },
          {
            '@type': 'Question',
            name: '要約やプ譜がまだ表示されません。',
            acceptedAnswer: {
              '@type': 'Answer',
              text: '保存直後は処理に時間がかかることがあります。詳細画面の状態を確認し、完了を待ってください。',
            },
          },
        ],
      },
    ],
  };
}

export function articleJsonLd(input: {
  url: string;
  title: string;
  description: string;
  datePublished?: string | null;
  dateModified?: string | null;
  origin?: string | null;
}) {
  const root = siteOrigin(input.origin);
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description: input.description,
    mainEntityOfPage: input.url,
    url: input.url,
    isPartOf: { '@id': `${root}/#website` },
    publisher: {
      '@type': 'Organization',
      name: 'Pufu Lens',
      logo: {
        '@type': 'ImageObject',
        url: `${root}/pufu-lens-logo.png`,
      },
    },
    ...(input.datePublished ? { datePublished: input.datePublished } : {}),
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
  };
}

function escapeAttr(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
}
