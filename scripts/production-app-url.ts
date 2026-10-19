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
