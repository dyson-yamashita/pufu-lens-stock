import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';

export function documentSecureHeaders() {
  const applySecureHeaders = secureHeaders();
  return createMiddleware(async (c, next) => {
    await applySecureHeaders(c, next);
    // Vite injects an inline React Refresh preamble during development.
    if (import.meta.env.PUFU_VITE_DEV_SERVER === 'true') return;
    const mediaType = c.res.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'text/html') return;

    // The app starts on either home page and uses WebAssembly for PNG export.
    const appPage =
      c.res.ok && (c.req.path === '/' || c.req.path === '/en' || c.req.path === '/en/');
    const wasmSource = appPage ? " 'wasm-unsafe-eval'" : '';
    c.header(
      'Content-Security-Policy',
      `script-src 'self'${wasmSource}; object-src 'none'; base-uri 'none'; frame-ancestors 'self'`,
    );
  });
}
