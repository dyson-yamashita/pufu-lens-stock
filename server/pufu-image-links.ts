import { projectScopeJson } from './project-access';
import { HTTPException } from 'hono/http-exception';
import type { Env, Principal } from './env';
import type { generateQuestionPufuImage } from './pufu-images';
import { cleanupIfAccountDeleted } from './account';
import { hash, randomSecret } from './security';
import { readQuestionPufuSnapshot } from './pufu-read';

const lifetimeSeconds = 3600;
const activeLimit = 50;
type Image = Awaited<ReturnType<typeof generateQuestionPufuImage>>;
const currentPufu = `SELECT 1 FROM pufu_scores pf
  JOIN projects p ON p.id=pf.project_id
  WHERE pf.id=l.pufu_id AND (l.question_id IS NULL OR EXISTS (SELECT 1 FROM pufu_questions pq WHERE pq.pufu_id=pf.id AND pq.question_id=l.question_id)) AND p.id=l.project_id
  AND pf.user_id=l.user_id AND p.user_id=l.user_id AND pf.status='ready'
  AND pf.current_phase=l.phase AND pf.revision=l.revision`;
const usableLink = `SELECT l.content_key,l.expires_at FROM pufu_image_links l
  WHERE l.token_hash=? AND l.ready=1 AND l.expires_at>? AND EXISTS(${currentPufu})`;

async function assertImageCurrent(env: Env, principal: Principal, image: Image) {
  try {
    const metadata = image.metadata;
    const latest = await readQuestionPufuSnapshot(
      env,
      principal,
      metadata.question_id,
      metadata.pufu_id ?? undefined,
    );
    if (
      latest.pufuId !== metadata.pufu_id ||
      latest.phase !== metadata.phase ||
      latest.revision !== metadata.revision ||
      latest.pufu.project_id !== metadata.project_id
    )
      throw new HTTPException(409, { message: 'プ譜が更新されています。再取得してください。' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(503, { message: 'プ譜の状態を確認できません。再取得してください。' });
  }
}

// 外部の画像プロキシも読める、推測困難な期限付きの閲覧権限を発行する。
// 画像はユーザー配下に置き、退会時の既存R2削除にも含める。
export async function issuePufuImageLink(env: Env, principal: Principal, image: Image) {
  if (!image.png || !image.metadata.pufu_id) return {};
  const token = randomSecret();
  const tokenHash = await hash(token);
  const contentKey = `${principal.user.id}/mcp-pufu-images/${tokenHash}.png`;
  const expiresAt = new Date(Date.now() + lifetimeSeconds * 1000).toISOString();
  const metadata = image.metadata;
  try {
    const inserted = await env.DB.prepare(
      `INSERT INTO pufu_image_links(token_hash,user_id,question_id,pufu_id,project_id,phase,revision,content_key,expires_at)
      SELECT ?,p.user_id,?,pf.id,p.id,pf.current_phase,pf.revision,?,?
      FROM pufu_scores pf JOIN projects p ON p.id=pf.project_id
      WHERE pf.id=? AND (? IS NULL OR EXISTS (SELECT 1 FROM pufu_questions pq WHERE pq.pufu_id=pf.id AND pq.question_id=?)) AND p.id=? AND p.user_id=? AND pf.user_id=p.user_id
      AND pf.status='ready' AND pf.current_phase=? AND pf.revision=?
      AND (? IS NULL OR p.id IN (SELECT value FROM json_each(?)))
      AND (SELECT COUNT(*) FROM pufu_image_links WHERE user_id=p.user_id AND expires_at>?)<?`,
    )
      .bind(
        tokenHash,
        metadata.question_id,
        contentKey,
        expiresAt,
        metadata.pufu_id,
        metadata.question_id,
        metadata.question_id,
        metadata.project_id,
        principal.user.id,
        metadata.phase,
        metadata.revision,
        projectScopeJson(principal),
        projectScopeJson(principal),
        new Date().toISOString(),
        activeLimit,
      )
      .run();
    if (!inserted.meta.changes) {
      // 上限到達時も、更新・移動・削除済みのBase64を成功として返さない。
      await assertImageCurrent(env, principal, image);
      return {
        image_url_error:
          '画像リンクの発行上限に達しました。既存リンクの期限後に再取得してください。',
      };
    }
    // pending行を先に記録し、保存失敗や中断でも期限後の削除対象を失わない。
    await env.CONTENT.put(contentKey, new Uint8Array(image.png), {
      httpMetadata: { contentType: 'image/png', cacheControl: 'no-store' },
    });
    const published = await env.DB.prepare(
      `UPDATE pufu_image_links AS l SET ready=1 WHERE token_hash=? AND expires_at>?
       AND EXISTS(${currentPufu})`,
    )
      .bind(tokenHash, new Date().toISOString())
      .run();
    if (!published.meta.changes)
      throw new HTTPException(409, {
        message: 'プ譜が更新または削除されています。再取得してください。',
      });
    const imageUrl = new URL(`/api/pufu-images/${token}.png`, env.APP_URL);
    const downloadUrl = new URL(imageUrl);
    downloadUrl.searchParams.set('download', '1');
    return { image_url: imageUrl.href, download_url: downloadUrl.href, expires_at: expiresAt };
  } catch (error) {
    await env.CONTENT.delete(contentKey).catch(() => undefined);
    // 退会と並行した遅延putも、本人配下のR2削除を再要求して回収する。
    await cleanupIfAccountDeleted(env, principal.user.id).catch(() => undefined);
    if (error instanceof HTTPException) throw error;
    await assertImageCurrent(env, principal, image);
    console.error('pufu_image_link_unavailable');
    return {
      image_url_error:
        '画像リンクを発行できませんでした。Base64のPNGを表示するか、再取得してください。',
    };
  }
}

export async function readPufuImageLink(env: Env, tokenFilename: string, head = false) {
  const match = /^([A-Za-z0-9_-]{43})\.png$/.exec(tokenFilename);
  if (!match)
    throw new HTTPException(404, { message: '画像リンクが無効、期限切れ、または更新済みです。' });
  let object: R2ObjectBody | null = null;
  try {
    const tokenHash = await hash(match[1]);
    const lookup = () =>
      env.DB.prepare(usableLink)
        .bind(tokenHash, new Date().toISOString())
        .first<{ content_key: string; expires_at: string }>();
    const link = await lookup();
    if (!link)
      throw new HTTPException(404, { message: '画像リンクが無効、期限切れ、または更新済みです。' });
    if (head) {
      const metadata = await env.CONTENT.head(link.content_key);
      if (!metadata || !(await lookup())) throw new HTTPException(404);
      return { body: null, size: metadata.size };
    }
    object = await env.CONTENT.get(link.content_key);
    if (!object || !(await lookup())) throw new HTTPException(404);
    return { body: object.body, size: object.size };
  } catch (error) {
    await object?.body.cancel().catch(() => undefined);
    if (error instanceof HTTPException) throw error;
    // URLの秘密部分やR2キーをエラーログへ渡さない。
    throw new HTTPException(503, {
      message: '画像を取得できませんでした。しばらくしてから再試行してください。',
    });
  }
}

export async function cleanupExpiredPufuImageLinks(env: Env) {
  const expired = await env.DB.prepare(
    'SELECT token_hash,content_key FROM pufu_image_links WHERE expires_at<=? ORDER BY expires_at LIMIT 100',
  )
    .bind(new Date().toISOString())
    .all<{ token_hash: string; content_key: string }>();
  if (!expired.results.length) return;
  await env.CONTENT.delete(expired.results.map((link) => link.content_key));
  await env.DB.prepare(
    `DELETE FROM pufu_image_links WHERE token_hash IN (${expired.results.map(() => '?').join(',')})`,
  )
    .bind(...expired.results.map((link) => link.token_hash))
    .run();
}
