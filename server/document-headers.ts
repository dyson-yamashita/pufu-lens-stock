import { secureHeaders } from 'hono/secure-headers';

/**
 * Public HTML/text documents reuse the same Hono secureHeaders() stack as
 * `/p/*` (HSTS, X-Frame-Options, CORP/COOP, etc.). CSP is not set by that
 * default stack; do not invent a parallel header layer here.
 */
export function documentSecureHeaders() {
  return secureHeaders();
}
