# Miniflareの同期RPC修正

`miniflare@4.20260730.0.patch` は、Cloudflare公式の[修正 #15552](https://github.com/cloudflare/workers-sdk/pull/15552)を安定版Miniflare 4へ適用します。

上流のマージコミットは `6f3d7b58b1f6cd036aca3e5946807bba37776065` です。このパッチに含む上流由来のコードにはMIT Licenseが適用されます。同コミットの [LICENSE-MIT](https://github.com/cloudflare/workers-sdk/blob/6f3d7b58b1f6cd036aca3e5946807bba37776065/LICENSE-MIT) を [LICENSE-MIT](LICENSE-MIT) に変更せず同梱しています。再配布時も著作権表示と許諾文を保持してください。

古い実装では、前リクエストの遅延した通知で次の待機が解除されると、応答を受け取る前に `message?.id === id` の検証が失敗します。CIではD1の初期化中に発生しました。通知の値をリクエストごとの世代番号にし、対象の応答が届くまで待機する、上流と同じ修正です。

`pnpm-workspace.yaml` の `patchedDependencies` とロックファイルで登録しているため、通常の `pnpm install --frozen-lockfile` で適用されます。テストのスキップ・再試行・並列数の削減は行いません。

`tests/miniflare-sync.test.ts` は待機が早く解除される状態を再現し、実際のD1呼び出しと後続の呼び出しが成功することを確認します。パッチ適用前はCIと同じ検証エラーで失敗します。

修正を含む安定版に更新する際は、このパッチと登録を削除し、回帰テストの成功を確認してください。

## OAuthエラーログの個人情報保護

`@cloudflare__workers-oauth-provider@1.2.3.patch` は、OAuth SDKが直接出力する認可失効・クライアント登録更新・CIMDメタデータ取得の失敗ログを、入力値や例外を含まない固定コードに置き換えます。SDKの標準エラー応答はアプリ側の `onError` で同様に処理します。認証・認可の動作は変更しません。

バージョンは1.2.3のまま、`patchedDependencies` とロックファイルで適用します。元パッケージのMITライセンスを [workers-oauth-provider-LICENSE](workers-oauth-provider-LICENSE) に保持しています。`tests/onboarding.test.ts` はメールアドレス入りの不正パラメーター・CIMD URL・例外で、ログへ出力されないことを検証します。上流でログ出力が修正された場合はパッチの撤去を検討してください。
