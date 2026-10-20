export function productionAppUrl(value: string | undefined): string {
  const url = value ? URL.parse(value) : null;
  if (
    !url ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    /(^|\.)(localhost|invalid)\.?$/.test(url.hostname)
  ) {
    throw new Error(
      '本番ビルドには環境変数 APP_URL に実際のHTTPSオリジンを設定してください（パス・認証情報・クエリ・フラグメント不可）。',
    );
  }
  return url.origin;
}

export function searchIndexName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value))
    throw new Error(
      'VECTORIZE_INDEX_NAMEには64文字以内の英数字・ハイフン・アンダースコアでインデックス名を設定してください。',
    );
  return value;
}

export function productionResourceIds(env: NodeJS.ProcessEnv) {
  const databaseId = env.D1_DATABASE_ID;
  const oauthKvId = env.OAUTH_KV_ID;
  if (
    !databaseId ||
    !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(databaseId) ||
    databaseId === '00000000-0000-0000-0000-000000000000'
  )
    throw new Error('本番ビルドには環境変数 D1_DATABASE_ID に実際のD1 IDを設定してください。');
  if (!oauthKvId || !/^[\da-f]{32}$/i.test(oauthKvId) || /^0+$/.test(oauthKvId))
    throw new Error('本番ビルドには環境変数 OAUTH_KV_ID に実際のKV IDを設定してください。');
  return { databaseId, oauthKvId };
}
