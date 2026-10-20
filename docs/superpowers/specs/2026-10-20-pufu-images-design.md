# プ譜画像の自動生成とMCP参照

## 目的と範囲

保存済みのProjectScoreModelから、ブラウザやAIを起動せずSVGとPNGを生成するライブラリを作る。プ譜の生成完了・保存・局面追加後に最新局面の画像を非同期更新し、ChatGPT等から `get_pufu_image(question_id)` で参照できるようにする。既存の `get_pufu` JSON取得は維持する。

ユーザーが指定した表示は、廟算八要素の縦配置、色枠のコメント吹き出し、左上のプ譜/Pufu Lensと商標表記なし。施策の進捗はライブラリの `showProgress` で切り替え、アプリの保存画像は進捗なしを既定とする（実装判断）。文章や配列順序は変えず、切り詰めない。

## ライブラリ

`packages/pufu-image` にTypeScriptの再利用可能なパッケージを置く。ProjectScoreModelと互換の共有スキーマで入力を検証する。SVGは純粋な図形とtextで組み立てる。PNGはresvg 2.6.2のWASMを使用し、生成物とrendererの `free()` をfinallyで呼ぶ。WASM初期化とフォントの供給はホストが担当し、外部通信・DOM・AIをライブラリから呼び出さない。

日本語フォントはライセンス付きのNoto Sans CJK JPを静的アセットとして同梱する。字幅情報は同じフォントから生成する。入力の文字数、XML制御文字、画像の画素数、PNGサイズに上限を設け、超過はコード付きエラーにする。大きなSVGを描画してから判定しない。

## 永続化と生成

`pufu_image_entries` を削除後も残るoutboxとして設ける。D1トリガーでreadyのプ譜作成・revision更新ごとに古いエントリーを失効し、新しいpendingエントリーを作る。既存のreadyプ譜もmigrationで登録する。画像キーはユーザーprefix配下のエントリー固有キーとし、上書きしない。

Workflowはプ譜保存後に画像生成を試み、保存APIはwaitUntilで対象プ譜の処理を開始する。Cronも少数ずつ回復処理する。画像生成の失敗はプ譜生成の失敗として扱わない。AIの利用枠を消費しない。失敗の状態・理由を記録し、恒久的な入力不正は繰り返し描画しない。

R2へ書く前にtouched/write_pendingを永続化する。失効済み・削除済みの画像はCronで削除し、未確定の書き込みがある間は削除記録を残す。遅れて書き込みが完了しても削除対象を再確保する。リースの期限切れ後は同じキーへ再アップロードせず、新エントリーで回復する。プロジェクト・問い・アカウント削除との競合でも公開や返却をしない。

## 取得と権限

認証済みGET `/api/v1/questions/:id/pufu/image` は現在の画像メタデータを返し、PNG取得用の同配下 `/content` を用意する。取得はread-onlyで生成を開始しない。プ譜の選択と権限は `get_pufu` と同じく本人・認可プロジェクト・最新のreadyプ譜に限定する。公開設定だけでは他ユーザーのMCPに公開しない。R2のキーやAPIキーを返さず、レスポンスはno-storeとする。

MCP `get_pufu_image` は `questions:read` を使う。readyならPNGをMCP image contentに入れ、structuredContentにはquestion_id/project_id、phase、revision、画像サイズ等のメタデータだけを返す。未作成はnot_created、生成待ちはpending、失敗はfailedとして区別する。無権限は既存ツール同様404/403。画像欠落や破損を未作成として扱わない。生成・保存内容を変更しない。

## 検証

実WASMで日本語、コメント、進捗0/未設定、空、少数、多数、長文、制御文字、過大画像、連続生成を確認する。D1/R2で保存後の同期、更新競合、遅延putと削除、期限切れ回復、既存データ移行を確認する。MCPでimage content、scope/project制限、未作成/pending/failedとread-only性を確認する。ローカルworkerdでWASMと静的フォントの実動作を確認し、全体チェックと独立レビュー後にPRを作成する。マージ・本番デプロイ・npm公開は行わない。
