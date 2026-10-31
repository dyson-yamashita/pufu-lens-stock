import { browserLanguage, languages, resolveLanguage, type Language } from '../shared/locale';
import type { Env } from './env';

function primaryLanguage(header: string | null): Language {
  const preferences = (header ?? '')
    .split(',')
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(';');
      const parameter = parameters.find((value) => /^\s*q\s*=/i.test(value));
      const quality = parameter === undefined ? 1 : Number(parameter.split('=')[1]);
      return { tag: tag.trim(), quality, index };
    })
    .filter(
      ({ tag, quality }) =>
        /^(?:[a-z]{1,8}(?:-[a-z0-9]{1,8})*|\*)$/i.test(tag) &&
        Number.isFinite(quality) &&
        quality > 0 &&
        quality <= 1,
    )
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  return browserLanguage(preferences[0]?.tag);
}

// These are public, static documents. Resolve browser language without loading
// sessions or the database, and never cache a negotiated result across languages.
export async function legalLanguageResponse(request: Request, env: Env): Promise<Response | null> {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  const match = /^\/(privacy|terms)\/?$/.exec(url.pathname);
  if (!match) return null;
  const explicit = url.searchParams.get('lang');
  const language =
    typeof explicit === 'string' && Object.hasOwn(languages, explicit)
      ? resolveLanguage(explicit)
      : primaryLanguage(request.headers.get('Accept-Language'));
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Accept-Language' });
  if (language !== 'ja') {
    headers.set('Location', `/${language}/${match[1]}`);
    return new Response(null, { status: 302, headers });
  }
  if (!env.ASSETS) return new Response('Document unavailable.', { status: 503, headers });
  // A trailing slash prevents an asset canonicalization redirect from dropping
  // the explicit Japanese choice and returning to browser negotiation.
  const assetUrl = new URL(`/${match[1]}/`, url.origin);
  const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
  const response = new Response(request.method === 'HEAD' ? null : asset.body, asset);
  response.headers.set('Cache-Control', 'no-store');
  const vary = new Set(
    (response.headers.get('Vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  vary.add('Accept-Language');
  response.headers.set('Vary', [...vary].join(', '));
  return response;
}
