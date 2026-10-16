import { HTTPException } from 'hono/http-exception';
import type { Env } from './env';
import { limitedText } from './ingest';

export function xPostId(value: string): string | null {
  const url = new URL(value);
  if (
    ![
      'x.com',
      'www.x.com',
      'twitter.com',
      'www.twitter.com',
      'mobile.twitter.com',
      'mobile.x.com',
    ].includes(url.hostname)
  )
    return null;
  return (
    /^\/(?:[A-Za-z0-9_]+|i\/web)\/status\/([0-9]{1,25})(?:\/|$)/.exec(url.pathname)?.[1] ?? null
  );
}

async function encryptionKey(env: Env) {
  if (!env.INTEGRATION_ENCRYPTION_KEY || !/^[a-f0-9]{64}$/i.test(env.INTEGRATION_ENCRYPTION_KEY))
    throw new HTTPException(503, {
      message: '外部連携の暗号化キーを管理者が設定する必要があります。',
    });
  const bytes = Uint8Array.from(env.INTEGRATION_ENCRYPTION_KEY.match(/../g)!, (value) =>
    parseInt(value, 16),
  );
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptToken(env: Env, userId: string, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`x:${userId}`) },
    await encryptionKey(env),
    new TextEncoder().encode(token),
  );
  return `v1.${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(cipher)))}`;
}
export async function xToken(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT encrypted_token FROM external_integrations WHERE user_id = ? AND provider = 'x'",
  )
    .bind(userId)
    .first<{ encrypted_token: string }>();
  if (!row)
    throw new Error(
      '外部連携でXのBearer Tokenを登録するか、投稿本文・画像OCRで本文を補完してください。',
    );
  try {
    const [version, iv, cipher] = row.encrypted_token.split('.');
    if (version !== 'v1') throw new Error();
    const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(iv), additionalData: new TextEncoder().encode(`x:${userId}`) },
      await encryptionKey(env),
      decode(cipher),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Xの認証情報を読み出せません。外部連携の設定を確認してください。');
  }
}
class XFetchError extends Error {}

export async function fetchXPost(env: Env, userId: string, id: string) {
  const token = await xToken(env, userId);
  try {
    const response = await fetch(`https://api.x.com/2/tweets/${id}?tweet.fields=note_tweet`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      // Workersはerror未対応。追跡せず、リダイレクトも下のHTTP判定で拒否する。
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const reason =
        response.status === 429
          ? '利用上限に達しています'
          : response.status === 401 || response.status === 403
            ? '認証情報・閲覧権限を確認してください'
            : response.status === 402
              ? 'APIの利用料金・残高を確認してください'
              : '投稿が削除済み、非公開、または取得できない状態です';
      throw new XFetchError(`Xの本文を取得できません（HTTP ${response.status}）。${reason}。`);
    }
    const json = JSON.parse(await limitedText(response)) as {
      data?: { id?: string; text?: string; note_tweet?: { text?: string } };
    };
    const text = json.data?.note_tweet?.text ?? json.data?.text;
    if (json.data?.id !== id || typeof text !== 'string' || !text.trim() || text.length > 120000)
      throw new Error();
    return { title: text.trim().split('\n')[0].slice(0, 80), text: text.trim() };
  } catch (error) {
    // Fetch例外・API応答には秘密情報が含まれ得るため、既知の固定メッセージだけを公開する。
    if (error instanceof XFetchError) throw error;
    throw new Error(
      'Xの本文を取得できませんでした。時間をおくか、投稿本文・画像OCRで本文を補完してください。',
    );
  }
}
