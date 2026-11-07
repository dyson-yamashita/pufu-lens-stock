# Workers AI移行の追加評価

生成関数にファイル交換用のAI.runを渡して、実モデルの応答を同じ関数へ戻す。DB・本番設定・デプロイは操作しない。合成fixtureの期待条件はfixtures.jsonに置く。モデル・プロンプトを変更する場合は別の交換ディレクトリを使う。

## 保存した結果のオフライン再生

```sh
node scripts/ai-evaluation/replay.mjs docs/evaluations/2026-11-workers-ai-additional-results.json
```

既存のesbuildでrunnerを一時バンドルし、保存された応答だけで生成処理を再実行する。外部推論は呼ばない。段階・モデル・入力のSHA-256を照合し、最終結果をUUID以外の全項目で比較する。失敗した試行も同じ失敗になることを検証する。ハッシュ不一致はfatal.jsonを残してexit 76で停止し、通常のAIエラーに包まれない。応答不足も許容しない。一時ファイルは終了時に削除する。

## 実推論を追加するとき

```sh
node_modules/.bin/esbuild scripts/ai-evaluation/runner.ts --bundle --platform=node --format=esm --packages=external --outfile=.ai-eval-extra.mjs
node .ai-eval-extra.mjs scripts/ai-evaluation/fixtures.json conditions-ja pufu deepseek /tmp/ai-evaluation-example
```

処理の種類はsummary/memory/pufu、構成はbaseline/gemma/deepseek。baselineは通常生成Qwen、プ譜GLM抽出＋Kimi構成。gemma/deepseekは選択したモデルを使う。レポートの比較対象は実際に実行した構成に限る。

未保存の呼出しでexit 75となり、pending.jsonにindex・stage・model・input・requestHashを書き出す。認証済みのWorkers AI接続でinputを`/ai/run/{model}`へ渡し、レスポンスenvelopeにrequestHashとelapsedMsを付けて`{index}.response.json`に保存する。接続時の認証情報は保存しない。choices.messageのreasoning/reasoning_contentは削除し、必要なら文字数だけを残す。同じ引数でrunnerを再実行し、次のpendingかfinal.jsonまで進める。requestHashを含むpending.jsonは`{index}.request.json`として保存する。

通信の結果が不明な呼出しを自動再実行しない。失敗も独立した試行として残す。今回の運用は同時2呼出しまで、モデルごとの開始間隔を記録し直近60秒に12回を目安として待機した。負荷試験やRPM上限の実証ではない。

すべての試行が終了してから交換ディレクトリを集計する。

```sh
node scripts/ai-evaluation/report.mjs /tmp/ai-evaluation-exchanges docs/evaluations/2026-11-workers-ai-additional-results.json
```

ディレクトリ名は`{fixtureId}-{summary|memory|pufu}-{baseline|gemma|deepseek}-{1|2}`とする。レポートに含める交換ファイルは合成入力のものだけにする。usageが取得できない失敗の費用を0とせずnullで残す。単価は2026-11-07の通常入力/出力単価のスナップショット。請求額、無料枠、キャッシュ割引は算出しない。意味の正しさ・条件保持は出力とfixtureを人手で比較し、構造検証の通過と区別する。

## 意味保持修正の記録

最終コードの比較は`2026-11-workers-ai-semantic-fix-results.json`、旧評価の実際の誤回答を再検証した記録は`2026-11-workers-ai-semantic-guards-results.json`。どちらも上記replay.mjsへ渡して再生できる。旧形式の入力ハッシュは意味保持修正で変わっているので、旧評価の完全再生には当時のコミットを使用する。

既知誤回答を新しく実推論で確認する場合はknown-error.tsをrunnerと同様にバンドルする。引数は`元評価JSON decision-swap|check-to-removal|deduplication|broken-sentence|missing-prohibition pufu baseline|deepseek 交換ディレクトリ`。元の最終scoreを読み、missing-prohibitionだけは重要条件を事実抽出してから再検証する。成功はドライバの実行完了であり、拒否できたかはfinal.jsonの`rejected`を見る。認証はファイル交換の外で扱い、結果不明な通信を自動再実行しない。
