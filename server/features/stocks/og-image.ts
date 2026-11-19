import { HTTPException } from 'hono/http-exception';
import { stockImageMaxBytes, stockImageTypes } from '../../../shared/stock-images';
import type { Env } from '../../env';
import { limitedBytes } from '../../infrastructure/limited-bytes';
import { imageType } from './image-type';
import { fetchPublic } from './ingest';

// The preview shares the body's generation and cleanup lifecycle.
export const ogImageKey = (contentKey: string) => `${contentKey}.ogp`;

export async function storeOgImage(env: Env, contentKey: string, url?: string): Promise<boolean> {
  if (!url) return false;
  try {
    const { response } = await fetchPublic(url, {
      deadline: Date.now() + 8000,
      accept: stockImageTypes.join(','),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    const bytes = await limitedBytes(response, stockImageMaxBytes, 'Preview image is too large');
    const contentType = imageType(bytes);
    if (!contentType) return false;
    await env.CONTENT.put(ogImageKey(contentKey), bytes, { httpMetadata: { contentType } });
    return true;
  } catch {
    // Optional metadata never blocks saving the article or generating its summary.
    return false;
  }
}

export async function ogImageResponse(env: Env, contentKey: string | null) {
  const object = contentKey ? await env.CONTENT.get(ogImageKey(contentKey)) : null;
  const contentType = object?.httpMetadata?.contentType;
  if (!object || !stockImageTypes.some((type) => type === contentType))
    throw new HTTPException(404);
  return new Response(object.body, {
    headers: {
      'Content-Type': contentType!,
      'Content-Length': String(object.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
