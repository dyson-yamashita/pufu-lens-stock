/** Paths that must hit the Worker first so documentSecureHeaders apply. Keep in sync with wrangler.jsonc run_worker_first. */
export const publicDocumentRoutes = [
  '/',
  '/en',
  '/en/',
  '/manual',
  '/manual/',
  '/en/manual',
  '/en/manual/',
  '/privacy',
  '/privacy/',
  '/terms',
  '/terms/',
  '/en/privacy',
  '/en/privacy/',
  '/en/terms',
  '/en/terms/',
  '/llms.txt',
] as const;

/** Asset directory paths served for the language document routes above. */
export const publicDocumentAssetPaths = {
  '/': '/',
  '/en': '/en/',
  '/en/': '/en/',
  '/manual': '/manual/',
  '/manual/': '/manual/',
  '/en/manual': '/en/manual/',
  '/en/manual/': '/en/manual/',
  '/privacy': '/privacy/',
  '/privacy/': '/privacy/',
  '/terms': '/terms/',
  '/terms/': '/terms/',
  '/en/privacy': '/en/privacy/',
  '/en/privacy/': '/en/privacy/',
  '/en/terms': '/en/terms/',
  '/en/terms/': '/en/terms/',
} as const;
