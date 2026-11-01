import type { Env } from './env';

/** @deprecated Legal pages are served by publicPagesApp via language URLs; no Accept-Language negotiation. */
export async function legalLanguageResponse(
  _request: Request,
  _env: Env,
): Promise<Response | null> {
  return null;
}
