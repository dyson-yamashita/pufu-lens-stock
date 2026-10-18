# Miniflareの同期RPC修正

`miniflare@4.20260730.0.patch` は、Cloudflare公式の[修正 #15552](https://github.com/cloudflare/workers-sdk/pull/15552)を安定版Miniflare 4へ適用します。

古い実装では、前リクエストの遅延した通知で次の待機が解除されると、応答を受け取る前に `message?.id === id` の検証が失敗します。CIではD1の初期化中に発生しました。通知の値をリクエストごとの世代番号にし、対象の応答が届くまで待機する、上流と同じ修正です。

`pnpm-workspace.yaml` の `patchedDependencies` とロックファイルで登録しているため、通常の `pnpm install --frozen-lockfile` で適用されます。テストのスキップ・再試行・並列数の削減は行いません。

`tests/miniflare-sync.test.ts` は待機が早く解除される状態を再現し、実際のD1呼び出しと後続の呼び出しが成功することを確認します。パッチ適用前はCIと同じ検証エラーで失敗します。

修正を含む安定版に更新する際は、このパッチと登録を削除し、回帰テストの成功を確認してください。
