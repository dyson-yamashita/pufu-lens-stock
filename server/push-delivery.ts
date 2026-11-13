import { encryptNotification, vapidHeaders } from '@block65/webcrypto-web-push';
import { announcementHref } from '../shared/announcements';
import { notificationAnnouncements, readAnnouncement, type AnnouncementRow } from './announcements';
import { resolveLanguage } from '../shared/locale';
import type { Env } from './env';
import { allowedPushEndpoint, pushConfigured } from './push';

// Only fixed labels may cross the exception -> log boundary. Never stringify errors,
// inspect messages/stacks/causes, or trust a custom name (including throwing getters).
function safeErrorClass(error: unknown): string {
  try {
    const name = error && typeof error === 'object' && 'name' in error ? error.name : undefined;
    switch (name) {
      case 'Error':
      case 'TypeError':
      case 'RangeError':
      case 'SyntaxError':
      case 'InvalidCharacterError':
      case 'DataError':
      case 'InvalidAccessError':
      case 'NotSupportedError':
      case 'OperationError':
      case 'AbortError':
      case 'TimeoutError':
        return name;
      default:
        return 'UnknownError';
    }
  } catch {
    return 'UnknownError';
  }
}

type PushFailureStage =
  | 'endpoint_validation'
  | 'vapid_signing'
  | 'payload_encryption'
  | 'subscription_recheck'
  | 'fetch'
  | 'response_cleanup';

/** Bound fan-out and send work so existing maintenance retains its time budget. */
export async function deliverAnnouncements(env: Env): Promise<void> {
  if (!pushConfigured(env)) return;
  const at = new Date().toISOString();
  const active = await notificationAnnouncements(env);
  await env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE session_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=?)',
  )
    .bind(at)
    .run();
  for (const item of active.slice(0, 10)) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO push_deliveries(announcement_id,subscription_id,next_attempt_at)
      SELECT ?,p.id,? FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash
      WHERE p.created_at<=? AND s.expires_at>? AND NOT EXISTS(
        SELECT 1 FROM push_deliveries d WHERE d.announcement_id=? AND d.subscription_id=p.id
      ) ORDER BY p.created_at,p.id LIMIT 100`,
    )
      .bind(item.id, at, item.notifyAt, at, item.id)
      .run();
  }
  // An expired lease is retried with the same notification tag; at most five attempts.
  await env.DB.prepare(
    "UPDATE push_deliveries SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,lease=NULL WHERE status='sending' AND next_attempt_at<=?",
  )
    .bind(at)
    .run();
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT d.announcement_id,d.subscription_id,p.endpoint,p.p256dh,p.auth,u.language,
    a.id,a.category,a.published_at,a.notify,a.notify_at,a.ja_json,a.en_json
    FROM push_deliveries d JOIN push_subscriptions p ON p.id=d.subscription_id
    JOIN users u ON u.id=p.user_id JOIN sessions s ON s.token_hash=p.session_hash
    JOIN announcements a ON a.id=d.announcement_id
    WHERE d.status='pending' AND d.next_attempt_at<=? AND s.expires_at>?
      AND a.published_at<=? AND a.notify=1 AND a.notify_at<=? AND a.notify_at>=?
    ORDER BY d.next_attempt_at,d.announcement_id LIMIT 20`,
  )
    .bind(at, at, at, at, cutoff)
    .all<
      AnnouncementRow & {
        announcement_id: string;
        subscription_id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
        language: string;
      }
    >();
  await Promise.all(
    rows.results.map(async (row) => {
      const item = readAnnouncement(row);
      const lease = crypto.randomUUID();
      const claim = await env.DB.prepare(
        `UPDATE push_deliveries SET status='sending',attempts=attempts+1,lease=?,next_attempt_at=?
      WHERE announcement_id=? AND subscription_id=? AND status='pending' AND next_attempt_at<=? RETURNING attempts`,
      )
        .bind(
          lease,
          new Date(Date.now() + 120000).toISOString(),
          row.announcement_id,
          row.subscription_id,
          at,
        )
        .first<{ attempts: number }>();
      if (!claim) return;
      let status = 0;
      let stage: PushFailureStage = 'endpoint_validation';
      try {
        if (!allowedPushEndpoint(row.endpoint)) throw new Error('Invalid endpoint');
        const subscription = {
          endpoint: row.endpoint,
          expirationTime: null,
          keys: { p256dh: row.p256dh, auth: row.auth },
        };
        // Use the library's public primitives in the same order as buildPushPayload,
        // so signing and encryption failures can be distinguished without exposing data.
        stage = 'vapid_signing';
        const { headers } = await vapidHeaders(subscription, {
          publicKey: env.VAPID_PUBLIC_KEY!,
          privateKey: env.VAPID_PRIVATE_KEY!,
          subject: env.VAPID_SUBJECT!,
        });
        stage = 'payload_encryption';
        const text = item[resolveLanguage(row.language)];
        const body = await encryptNotification(
          subscription,
          new TextEncoder().encode(
            JSON.stringify({
              title: text.title,
              body: text.summary,
              tag: `announcement-${item.id}`,
              url: announcementHref(item.id),
            }),
          ),
        );
        const payload = {
          method: 'post',
          headers: {
            ...headers,
            ttl: '86400',
            'content-encoding': 'aes128gcm',
            'content-length': body.byteLength.toString(),
            'content-type': 'application/octet-stream',
          },
          body,
        };
        stage = 'subscription_recheck';
        // Check consent again immediately before the external request (unsubscribe/logout may have raced).
        const valid = await env.DB.prepare(
          'SELECT p.id FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash JOIN announcements a ON a.id=? WHERE p.id=? AND s.expires_at>? AND a.notify=1 AND a.notify_at=? AND a.published_at<=?',
        )
          .bind(
            item.id,
            row.subscription_id,
            new Date().toISOString(),
            item.notifyAt,
            new Date().toISOString(),
          )
          .first();
        if (!valid) return;
        stage = 'fetch';
        const response = await fetch(row.endpoint, {
          ...payload,
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        });
        status = response.status;
        stage = 'response_cleanup';
        await response.body?.cancel();
      } catch (error) {
        // Preserve status (including a response received before cleanup failed) and retry semantics.
        // Never log endpoint, user/subscription IDs, credentials, provider body or payload.
        console.warn(
          JSON.stringify({
            event: 'announcement_push_transport_failed',
            stage,
            error_class: safeErrorClass(error),
            status,
            attempt: claim.attempts,
          }),
        );
      }
      if (status === 404 || status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?')
          .bind(row.subscription_id)
          .run();
        return;
      }
      const sent = status >= 200 && status < 300;
      const retry =
        !sent && (status === 0 || status === 429 || status >= 500) && claim.attempts < 5;
      await env.DB.prepare(
        'UPDATE push_deliveries SET status=?,last_status=?,lease=NULL,next_attempt_at=? WHERE announcement_id=? AND subscription_id=? AND lease=?',
      )
        .bind(
          sent ? 'sent' : retry ? 'pending' : 'failed',
          status,
          new Date(Date.now() + Math.min(3600000, 60000 * 2 ** claim.attempts)).toISOString(),
          row.announcement_id,
          row.subscription_id,
          lease,
        )
        .run();
      console.log(
        JSON.stringify({
          event: 'announcement_push_delivery',
          announcement_id: item.id,
          status,
          attempt: claim.attempts,
        }),
      );
    }),
  );
}
