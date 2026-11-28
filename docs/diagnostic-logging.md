# 接続切断の診断ログ（Issue #205）

原因未確定の `Network connection lost.` を切り分けるためのアプリケーションログ。
リトライ・本番設定・HTTPエラー応答の仕様は変更しない。

## 確認方法

- `request_id` はサーバー生成UUID。同一Worker/API呼び出しと、その `waitUntil` のログを関連付ける。受信 `X-Request-ID` / `CF-Ray` は採用しない。プラットフォームのinvocation/Ray情報はWorkers Observability側で照合する。
- `http_response_ready` の `layer` は `worker` または `api`、`status` は生成されたHTTP応答のステータス。二層のログは同じ `request_id` を持つ。ストリームを読み取らないため、本文の送信完了・クライアントへの到達は証明しない。
- `operation_completed` / `operation_failed` の `phase` は `d1`、`background`、`scheduled`。ハンドラーや既存の回復可能エラーには `operation_failed` と固定の処理名を記録する。
- APIの `dispatch_jobs` / `cleanup_stock_images` の完了と失敗をHTTP応答と別に記録する。完了はdispatch関数の終了であり、全Workflowの完了ではない。既存の延期処理に入ったときは `workflow_dispatch` の失敗ログも残す。
- D1計測はキーワードのストック一覧、問い一覧、dispatch冒頭の世代整理・期限切れ検索・pending検索に限定。`total_attempts` はD1結果の数値だけ（最大32件）。空配列はメタデータ未取得で、再試行ゼロを意味しない。アプリ独自の再試行は追加しない。
- scheduled全体の失敗はログ後に同じ例外を再throwし、`waitUntil` に拒否が伝わる。元から回復可能として扱っていた保守処理のcatchは維持する。

## 記事URLの本文取得

Workers Observabilityで `event` が `article_fetch_failed` のログを確認する。本文取得の失敗を試行ごとに1件記録する。

- `stage` は失敗した段階。元ページへの接続、応答の読み取り、HTML抽出、ブラウザー描画、描画後の抽出、PDF解析、Xの取得を区別する。
- `reason` は固定の理由。たとえば `robots_disallowed` はルールによるクロール禁止、`robots_unavailable` はルールの取得や確認の失敗、`insufficient_text` は抽出後の本文が200文字未満だったことを表す。
- `http_status`、`browser_http_status`、`robots_http_status` は各取得経路で最後に確認できたHTTPステータス。順に元ページへの直接取得またはX API、ブラウザーのメイン文書、確認に失敗したrobots.txtを表す。リダイレクトを受信したあとに失敗したときは3xxが残ることがある。`content_type` は直接取得の応答形式を `html`、`text`、`pdf`、`unsupported` で示す。
- `initial_text_length` と `rendered_text_length` はHTML・テキスト取得で得られた描画前後の本文候補の長さ。取得判定と同じUTF-16の長さを使う。
- `browser_robots_disallowed` と `browser_robots_unavailable` は、ブラウザーのメイン文書以外のリクエストで、それぞれクロール禁止やルールの確認失敗が起きた回数。ブラウザー終了処理を始めるまでの回数を数え、1件以上の場合に値を記録する。

## 機密値と量の制限

URLは固定のrouteテンプレートに変換し、それ以外を `/other` にする。query、fragment、動的ID、ユーザーID、本文、SQL、bind値、認証ヘッダーを記録しない。
エラーは既知の分類と許可した標準名のみを残す。任意のmessageや追加プロパティは出さない。stackは先頭8フレームの数字の行・列のみ（ファイル名・関数名は除外）、causeは3段まで。未知のエラーは `redacted` になる。

HTTPは層ごとに1件、計測対象operationは終了時に1件。Workflow単位の成功ログや全D1クエリのログは追加しない。既存Observabilityの収集設定を変更しない。

## 限界

Worker起動前の拒否、runtimeがアプリへ渡さない例外、レスポンス返却後のストリーム障害、強制終了時は、このログだけでは切り分けられない。`/other` の詳細routeやサニタイズで除去したmessage/stack文字列は復元できない。全D1・全Workflow・別PDF Workerの計測ではない。

参照: [D1戻り値](https://developers.cloudflare.com/d1/worker-api/return-object/)、[AsyncLocalStorage](https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/)、[waitUntil](https://developers.cloudflare.com/workers/runtime-apis/context/)。既存の `nodejs_compat` を使用する。
