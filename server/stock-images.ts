import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv, Env } from './env';
import { limitedBytes } from './limited-bytes';
import { canAccessProject, projectScopeJson } from './project-access';
import { stockImageLimit, stockImageMaxBytes, type StockImage } from '../shared/stock-images';

const columns = 'id, filename, content_type, size, created_at';
const scopeWhere =
  'EXISTS (SELECT 1 FROM stocks s WHERE s.id=stock_images.stock_id AND s.user_id=? AND (? IS NULL OR s.project_id IN (SELECT value FROM json_each(?))))';
export async function stockImageResponse(
  env: Env,
  image: Pick<StockImage, 'content_type' | 'size'> & { content_key: string },
) {
  const object = await env.CONTENT.get(image.content_key);
  if (!object) throw new HTTPException(404);
  return new Response(object.body, {
    headers: {
      'Content-Type': image.content_type,
      'Content-Length': String(image.size),
      'Content-Disposition': `inline; filename="image.${image.content_type === 'image/jpeg' ? 'jpg' : image.content_type.slice(6)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
function imageType(bytes: Uint8Array): StockImage['content_type'] | null {
  const starts = (signature: number[]) => signature.every((value, i) => bytes[i] === value);
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (starts([255, 216, 255])) return 'image/jpeg';
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function cleanupStockImages(env: Env, key?: string): Promise<void> {
  try {
    if (!key)
      await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO stock_image_cleanup(content_key) SELECT content_key FROM stock_image_writes WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour') ORDER BY last_checked_at,content_key LIMIT 50",
        ),
        env.DB.prepare(
          "DELETE FROM stock_images WHERE status='pending' AND content_key IN (SELECT content_key FROM stock_image_writes WHERE content_key IN (SELECT content_key FROM stock_image_cleanup) AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))",
        ),
        env.DB.prepare(
          "UPDATE stock_image_writes SET last_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE content_key IN (SELECT content_key FROM stock_image_cleanup) AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')",
        ),
      ]);
    const pending = await (
      key
        ? env.DB.prepare(
            "SELECT content_key, generation FROM stock_image_cleanup WHERE content_key=? AND NOT EXISTS (SELECT 1 FROM stock_image_writes w WHERE w.content_key=stock_image_cleanup.content_key AND w.created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))",
          ).bind(key)
        : env.DB.prepare(
            "SELECT content_key, generation FROM stock_image_cleanup WHERE NOT EXISTS (SELECT 1 FROM stock_image_writes w WHERE w.content_key=stock_image_cleanup.content_key AND w.created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) LIMIT 50",
          )
    ).all<{ content_key: string; generation: string }>();
    for (const row of pending.results) {
      await env.CONTENT.delete(row.content_key);
      await env.DB.prepare('DELETE FROM stock_image_cleanup WHERE content_key=? AND generation=?')
        .bind(row.content_key, row.generation)
        .run();
    }
  } catch {
    console.error('stock_image_cleanup_pending');
  }
}

export function stockImagesApp() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const principal = c.get('principal');
    if (principal.kind === 'token') throw new HTTPException(403);
    const stock = await c.env.DB.prepare(
      'SELECT id, project_id FROM stocks WHERE id=? AND user_id=?',
    )
      .bind(c.req.param('id'), principal.user.id)
      .first<{ id: string; project_id: string }>();
    if (!stock || !canAccessProject(principal, stock.project_id))
      throw new HTTPException(404, { message: '記事が見つかりません。' });
    await next();
  });
  app.get('/', async (c) => {
    const scope = projectScopeJson(c.get('principal'));
    const images = await c.env.DB.prepare(
      `SELECT ${columns} FROM stock_images WHERE stock_id=? AND status='ready' AND ${scopeWhere} ORDER BY created_at, id`,
    )
      .bind(c.req.param('id'), c.get('principal').user.id, scope, scope)
      .all<StockImage>();
    return c.json({ images: images.results });
  });
  app.post('/', async (c) => {
    const scope = projectScopeJson(c.get('principal'));
    let filename: string;
    try {
      filename = decodeURIComponent(c.req.header('X-File-Name') ?? '').trim();
    } catch {
      throw new HTTPException(400, { message: '画像のファイル名を確認してください。' });
    }
    if (
      !filename ||
      filename.length > 255 ||
      Array.from(filename).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new HTTPException(400, { message: '画像のファイル名を確認してください。' });
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await limitedBytes(
        new Response(c.req.raw.body, { headers: c.req.raw.headers }),
        stockImageMaxBytes,
        '画像は1枚5MBまでです。',
      );
    } catch {
      throw new HTTPException(413, { message: '画像は1枚5MBまでです。' });
    }
    const contentType = imageType(bytes);
    if (!contentType || c.req.header('Content-Type')?.split(';')[0].trim() !== contentType)
      throw new HTTPException(400, { message: 'PNG・JPEG・GIF・WebPの画像を選んでください。' });
    const requestId = c.req.header('Idempotency-Key');
    if (requestId && !z.uuid().safeParse(requestId).success)
      throw new HTTPException(400, { message: '画像のリクエストIDを確認してください。' });
    const id = requestId ?? crypto.randomUUID();
    const contentHash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    const replay = async () => {
      const existing = await c.env.DB.prepare(
        `SELECT ${columns}, status, content_hash FROM stock_images WHERE id=? AND stock_id=? AND ${scopeWhere}`,
      )
        .bind(id, c.req.param('id'), c.get('principal').user.id, scope, scope)
        .first<StockImage & { status: string; content_hash: string }>();
      if (!existing) return null;
      if (
        existing.status !== 'ready' ||
        existing.content_hash !== contentHash ||
        existing.filename !== filename ||
        existing.content_type !== contentType
      )
        throw new HTTPException(409, {
          message: '画像を保存中か、同じリクエストIDで異なる画像が送信されました。',
        });
      const image: StockImage = {
        id: existing.id,
        filename: existing.filename,
        content_type: existing.content_type,
        size: existing.size,
        created_at: existing.created_at,
      };
      return c.json({ image }, 200);
    };
    const previous = await replay();
    if (previous) return previous;
    // A retried upload after deletion must never reuse an object key pending cleanup.
    const key = `${c.get('principal').user.id}/stock-images/${crypto.randomUUID()}`;
    // Count pending writes too; the atomic insert prevents concurrent limit bypasses.
    const inserted = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO stock_images(id, stock_id, content_key, filename, content_type, size, content_hash, status)
       SELECT ?,id,?,?,?,?,?, 'pending' FROM stocks WHERE id=? AND user_id=?
       AND (? IS NULL OR project_id IN (SELECT value FROM json_each(?)))
       AND (SELECT COUNT(*) FROM stock_images WHERE stock_id=stocks.id) < ? RETURNING id`,
    )
      .bind(
        id,
        key,
        filename,
        contentType,
        bytes.length,
        contentHash,
        c.req.param('id'),
        c.get('principal').user.id,
        scope,
        scope,
        stockImageLimit,
      )
      .first();
    if (!inserted) {
      const concurrent = await replay();
      if (concurrent) return concurrent;
      throw new HTTPException(409, {
        message: '画像はストックごとに5枚までです。保存先も確認してください。',
      });
    }
    try {
      await c.env.CONTENT.put(key, bytes, { httpMetadata: { contentType } });
      const [updated] = await c.env.DB.batch<StockImage>([
        c.env.DB.prepare(
          `UPDATE stock_images SET status='ready' WHERE id=? AND content_key=? AND ${scopeWhere} RETURNING ${columns}`,
        ).bind(id, key, c.get('principal').user.id, scope, scope),
        c.env.DB.prepare(
          "INSERT INTO stock_image_cleanup(content_key) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM stock_images WHERE id=? AND content_key=? AND status='ready') ON CONFLICT(content_key) DO UPDATE SET generation=lower(hex(randomblob(16)))",
        ).bind(key, id, key),
        c.env.DB.prepare('DELETE FROM stock_image_writes WHERE content_key=?').bind(key),
      ]);
      const image = updated.results[0];
      if (!image) throw new HTTPException(409, { message: '記事が見つかりません。' });
      return c.json({ image }, 201);
    } catch (error) {
      // Also enqueue after a concurrent parent deletion completed before the R2 write.
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM stock_images WHERE id=? AND content_key=?').bind(id, key),
        c.env.DB.prepare(
          'INSERT INTO stock_image_cleanup(content_key) VALUES (?) ON CONFLICT(content_key) DO UPDATE SET generation=lower(hex(randomblob(16)))',
        ).bind(key),
        c.env.DB.prepare('DELETE FROM stock_image_writes WHERE content_key=?').bind(key),
      ]);
      c.executionCtx.waitUntil(cleanupStockImages(c.env, key));
      throw error;
    }
  });
  app.get('/:imageId', async (c) => {
    const image = await c.env.DB.prepare(
      "SELECT content_key, content_type, size FROM stock_images WHERE id=? AND stock_id=? AND status='ready'",
    )
      .bind(c.req.param('imageId'), c.req.param('id'))
      .first<StockImage & { content_key: string }>();
    if (!image) throw new HTTPException(404);
    return stockImageResponse(c.env, image);
  });
  app.delete('/:imageId', async (c) => {
    const image = await c.env.DB.prepare(
      'DELETE FROM stock_images WHERE id=? AND stock_id=? RETURNING content_key',
    )
      .bind(c.req.param('imageId'), c.req.param('id'))
      .first<{ content_key: string }>();
    if (!image) throw new HTTPException(404);
    c.executionCtx.waitUntil(cleanupStockImages(c.env, image.content_key));
    return c.json({ ok: true });
  });
  return app;
}
