import type { Env } from './env';

/**
 * Legal documents are static language URLs (`/privacy`, `/en/privacy`, …).
 * Accept-Language negotiation and temporary redirects were removed so crawlers
 * are not bounced between locales. Prefer Worker `publicPagesApp` asset serving
 * (same secureHeaders stack as other public HTML).
 */
export async function legalLanguageResponse(
  _request: Request,
  _env: Env,
): Promise<Response | null> {
  return null;
}
