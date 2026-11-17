# B04 add_pufu_phase: モデルと実装の自動照合

対象は `add_pufu_phase` の認証・scope・owner/project・ready/revision・再送とD1確定。製品コードを変更せず、Leanの実行可能モデルから作った同じ入力列を実MCP入口へ送り、応答と保存結果を比較する。

## 期待値の出所と実行

[McpWrites.Oracle](../BoundaryVerification/McpWrites.lean) が既存の `Auth.mcpEntrance` と `McpWrites.append` / `commit` を評価する。遷移をTypeScriptで再実装しない。HTTPの401/403/404/409分類は、モデルの許可結果を実装の応答形式へ対応付けるLean側adapterである。

[exporter](../export_phase_cases.py) は登録済みモデルをbuildし、OS一時ファイルのimportと `#eval IO.print` からJSONを生成する。[生成fixture](../../../tests/fixtures/mcp-add-pufu-phase-model.json)は16ケース・25ステップ。入力と期待値はLeanに置き、JSONを手で修正しない。Node不要のcanonical JSON比較で、書式差を許容し、値・順序・bool/number等の型のずれを拒否する。書式は既存qualityジョブが検査する。

```sh
# 全モデルのbuild・公理監査・生成fixture照合・Lean変異
python3 formal/verify.py

# モデル変更時だけ再生成し、既存formatterで整形
python3 formal/boundary-verification/export_phase_cases.py --write
pnpm exec prettier --write tests/fixtures/mcp-add-pufu-phase-model.json

# Lean生成入力を実HTTP/OAuth/MCP→D1へ送り比較
pnpm exec vitest run tests/mcp-add-pufu-phase-model.test.ts --maxWorkers=1

# 元sourceを変更せず、baselineと8実装変異を検査
python3 formal/check_phase_implementation.py

# manifest/置換位置だけを検査
python3 formal/check_phase_implementation.py --check-only

# 検査機構の拒否経路も検査（Lean/Python、既存Node依存を用意）
python3 -m unittest discover -s formal -p 'test_*.py' -v
```

Lean 4.36.0所定のelan binをPATHへ追加する。`targets.json` の `conformance` が生成fixtureの照合を登録し、Leanジョブが実行する。既存Vitest分割ジョブは生成fixtureを読む。専用Nodeジョブが実装変異を実行し、どちらの失敗も集約 `Check` へ伝わる。

## 同じ入力の具体化と観測

| モデル入力・状態            | 実装側での具体化・比較                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| authenticated / writeScope  | 実OAuth PKCEで発行したtoken、または無効Bearer。pufus:write有り／projects:readのみで実MCP入口を通す                                       |
| ownsTarget / projectAllowed | Alice本人／Bobのtokenと、全本人project／alice-secondだけの接続設定。対象はAliceのalice-projectにあるプ譜                                 |
| pufuId・requestIdのNat      | ケースごとの実IDと有効UUIDへ一対一に写す。同じrequestIdは同じUUIDへ写す                                                                  |
| 不透明なdata・reasonのNat   | 固定した有効ProjectScoreModel全文と理由文字列へ写す。DBではスコアJSON全体を比較し、本文ラベルだけでは比較しない                          |
| ready/revision/局面         | 初期状態をテストDBに準備。局面1は初期化済み。古いrevisionは初期2に対する要求1とし、全要求はAPIの正値スキーマ内                           |
| phases/comments/relations   | 局面番号と全文、コメントのphase/body、問い1・ストック2への関連を照合                                                                     |
| receipts                    | 実DBにあるrequest UUID・pufu ID・phase・revisionを観測。hash前像は復元できないため、モデルの全要求フィールドをDBから読んだことにはしない |

ケースは未認証、scope/owner/project拒否、未完成、古いrevision、複製、置換と理由、直後/後日の再送、payload/reason/revision変更、成功後に同じ利用者のscope/project範囲が異なる資格情報を使う再送、他利用者による同一UUID呼出しを含む。

各ステップでLean生成のaccepted/created/phase/revisionと応答、次状態とD1を比較する。拒否と再送では、pufu_scores・pufu_phases・pufu_phase_requests・comments・pufu_questions・pufu_stocks・articles・stocks・questions・memory_versions・ai_operations・stock_usageの全行を前後比較する。OAuthの利用記録、全DB・R2等の状態全体が不変という主張ではない。owner-denied-replayはAliceの成功後にBobのtokenで同一UUIDを呼ぶケースであり、BobのnamespaceにAliceのreceiptが存在するという意味ではない。同じprincipalが所有権を失った後の既存receipt再送はこの入力列では検証しない。

初期準備後の操作は実MCPハンドラー経由であり、private判定関数やtrusted principalの注入で代替しない。

## TypeScript・SQLの変異

[manifest](../../phase-implementation-mutations.json)の8論理変異・10編集を、[runner](../../check_phase_implementation.py)が使い捨てコピーに適用する。元のserver/sharedを直接変更しない。依存は既存node_modulesを再利用し、Vite/Vitestのキャッシュ・一時データはコピー内に分離する。pnpmの自動依存インストールを禁止する。

| 破る条件                     | 指定ケース      |
| ---------------------------- | --------------- |
| tool-contextの書込scope      | scope-denied    |
| 所有者SQL（bind数維持）      | owner-denied    |
| project範囲SQL（bind数維持） | project-denied  |
| revisionの事前判定と最終SQL  | stale-revision  |
| readyの事前判定と最終SQL     | not-ready       |
| receiptのpayload照合         | changed-payload |
| 現在revisionを再送にも要求   | late-replay     |
| 保存revisionの加算           | copy            |

revision/readyは二重に保護されているため、同じ性質に対する2箇所を一つの論理変異として外す。片方だけを外して安全性が保たれる場合を、テストの不備や製品の脆弱性とは扱わない。任意のsource文字列を消せば必ず失敗する仕組みではない。

先に無変更コピーで16件すべての成功を要求する。その後は各変異の指定ケースだけを実行する。成功判定は、正常なVitest exit1・JSON report内の指定テスト1件の先頭AssertionError・他15件のskipが揃った場合だけ。生き残る変異、構文/import/collection/環境エラー、timeout、欠report、無関係ケースだけの失敗はCI失敗であり、変異検出の成功に数えない。caseの20秒上限は変更しない。各子runは180秒、超過時は子process groupを停止してコピーを掃除する。

## 保証の区別と限界

- **カーネルでの証明:** B04の普遍的なモデル定理と、追加した正常/入口拒否の到達例。公理監査とLeanの安全条件変異は維持する。
- **実行可能モデルの評価:** `#eval` による有限の期待値生成と、tracked fixtureのfreshness検査。これは証明用の `native_decide` ではなく、JSON/実行評価を新しい数学的証明として扱わない。Leanの評価器・serializer・ID/データ具体化・HTTP分類adapterも照合の信頼対象になる。
- **実装の照合:** 16入力列・25操作と8実装変異で、実HTTP/MCPとローカルD1を観測した結果。全入力に対するTypeScript/SQLとの形式的同値性、全変異、全並行スケジュール、暗号・OAuth/provider・D1の正しさを証明したものではない。

入力は有効な小さいスコアと初期化済み局面に限る。壊れたJSON/上限/旧局面補完、別プ譜へのrequest_id再使用、認証後の同時失効、外部サービスやDNSと実接続先の一致は今回のモデルベース入力の範囲外。既存テスト・個別仕様の前提を維持する。本番データや本番通信は利用しない。
