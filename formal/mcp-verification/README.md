# MCP update_pufu 形式検証PoC

形式検証全体の環境・配置・対象追加・CI登録は [共通README](../README.md) を参照する。このREADMEはB00のupdate_pufu固有の仕様・証明・実装との対応・実行手順を記載する。

Lean 4の抽象モデルの数学的証明と、実際のTypeScript MCPハンドラーの結合テストを組み合わせる。**Leanの証明はTypeScript・SQL・OAuth実装全体の正しさの証明ではない。** API・認証・認可・本番コードは変更しない。本番データ、外部AI、Cloudflare本番環境は使用しない。

## 調査した実装と処理フロー

調査基準: `origin/main` の `b25b3f1`。既存のロールや共同編集権限を新設せず、現存する所有者・OAuthスコープ・許可プロジェクトの条件を使用する。

1. [Worker入口](../../server/index.ts) → [OAuth provider](../../server/mcp/oauth.ts) が `/mcp` のBearerトークンを検証する。OAuthの認可コード発行はWebセッションとPKCEを使う。
2. [handleMcp](../../server/mcp/server.ts) が認証コンテキスト、ユーザーの存在・オンボーディング完了、unwrapしたトークンのユーザー一致、接続失効を確認する。保存済み接続設定でトークンのスコープと対象プロジェクトを制限し、許可プロジェクトが本人に属することを確認する。対象が空なら403。
3. [update_pufu](../../server/mcp/tools/pufu.ts) をMCP SDK/Zodで入力検証し、[run](../../server/mcp/tool-context.ts) が `pufus:write` を要求する。`projectScore` を `score` へ変換し、内部APIの `PATCH /api/v1/pufus/:id` を呼ぶ。API側はこのサーバーで解決済みのprincipalを使用する。
4. [ownedPufu](../../server/api/context.ts) が `pufu_scores.user_id` とprincipalのユーザーID、許可プロジェクトをSQLで確認する。不一致は404。ここでの所有判定はプ譜行の所有者であり、一般的なプロジェクト共同編集ロールを仮定しない。[project-access](../../server/features/projects/project-access.ts) の `null` は全プロジェクト、空配列は許可なし。全プロジェクト許可でも他人のプ譜には書けない。
5. [savePufu](../../server/api/routes/pufu.ts) が関連先、ready状態、局面範囲等を確認する。更新前の [initialPufuPhase](../../server/features/pufu/pufu.ts) は旧データの第1局面を本体JSONへ同期する。
6. D1 `batch` 内で、対象局面、必要なら関連テーブル、本体を更新する。各更新のSQL条件に所有者、ready状態、入力revision、読み取ったcurrent_phase、局面の存在、project_id・許可プロジェクト、関連の問いの存在を含める。最後の本体更新の `RETURNING` が空なら409。通常の `update_pufu` は局面を追加せず、revisionを**1増やす**。過去局面を編集するときは本体の最新 `score_json`・taskを維持する。

## 確定した性質とモデルの対応

| ID     | 数学的に証明するモデル内の性質                                         | 定理                                                                                        | 実装との対応                                                     |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| P1     | 未認証なら受理されない                                                 | `unauthenticated_denied`                                                                    | OAuth provider・handleMcpの認証前提                              |
| P2     | writeスコープなし、非所有者、許可プロジェクト外なら受理されない        | `missing_scope_denied`, `non_owner_denied`, `outside_project_denied`                        | run、ownedPufu、SQL条件                                          |
| P3     | 権限拒否ならデータ・全局面・revision不変                               | `unauthorized_unchanged`                                                                    | 権限不足でDB書込処理へ到達しない                                 |
| P3補助 | モデル内の任意の拒否で状態不変                                         | `rejected_unchanged`                                                                        | **正常化済みの局面**に限定した対応。旧データ同期の例外は下記参照 |
| P4     | 権限・正常更新条件・revision一致で受理、revisionは1増加                | `permitted_valid_update`, `accepted_revision`                                               | D1 batch成功時のRETURNING                                        |
| P4補助 | 対象局面だけを置換、局面数維持、最新局面を編集するときだけ本体JSON置換 | `accepted_phase_data`, `accepted_other_phase`, `accepted_no_append`, `accepted_latest_data` | UPDATE pufu_phases / pufu_scores のCASE                          |
| 追加   | 古いrevisionは拒否、空の許可リストは権限拒否                           | `stale_revision_denied`, `empty_projects_denied`                                            | revisionの楽観ロックと空配列の意味                               |

`Access.lean` は解決済みの認証状態、writeスコープ、プ譜所有権、プロジェクトID・許可リストを表す。文字列IDの同一性を自然数で抽象化し、`none` は全件、`some []` は許可なしとする。`authenticated` は有効な本人のトークン・ユーザー・オンボーディング・失効確認を通過した状態を表し、それぞれの暗号・認証処理は証明しない。

`State.lean` は本体JSON、局面番号からJSONへの写像、revision、current_phaseと、更新要求・状態遷移を表す。JSON内容は不透明な文字列、局面データは既に初期化・同期済みとして扱う。`Update.valid` はスキーマ、ready状態、正の存在する局面（current_phase以下）、関連先検証、DB処理成功を一括で抽象化した条件であり、利用者が送るフラグではない。認証・認可とrevision比較はこのフラグに隠さず個別にモデル化する。局面数の維持はcurrent_phaseの維持として表す。存在しない局面に対する写像の値は意味を持たない。

正常更新は「権限がある」だけでは足りず、validとrevision一致が必要。Stateのrevisionは自然数であり、JavaScriptの整数精度上限は扱わない。

## TypeScriptでテストする範囲

[mcp-update-pufu-verification.test.ts](../../tests/mcp-update-pufu-verification.test.ts) は既存のVitest・`testApp`・`mcpToken` を再利用する。ローカルMiniflareのD1/KVへ実際のマイグレーションとダミーユーザーを投入し、OAuth認可コード＋PKCEでトークンを発行する。`worker.fetch` のMCP JSON-RPC `tools/call` から既存API・SQLまで通し、認証・認可・SQLのモックは使わない。

- P1/P3: トークンなし・不正トークン・接続失効時の拒否とDB不変。
- P2/P3: writeスコープなし、同一ユーザーの許可対象外、他ユーザー、複数プロジェクト許可でも対象外の拒否とDB不変。
- 接続設定で発行後にスコープまたはプロジェクト許可を取り消した場合の拒否とDB不変。空配列を全許可として扱わないことも確認。
- P4: 全プロジェクト・単一・複数プロジェクト許可で正常更新し、本体と局面JSON、revisionの+1、局面数維持を確認。同じrevisionの再送は409、正常化済みデータは変化しない。
- P4補助: 第2局面が最新の状態で第1局面を編集しても最新JSONを維持する。
- 境界の実例: 旧データで第1局面が欠けている場合、revision競合で409でも第1局面が初期化される。

拒否前後の比較対象は `pufu_scores` / `pufu_phases` / `pufu_questions` / `pufu_stocks` の**全列・全行**。問い・ストック各1件の関連を持つfixtureで、拒否時と関連指定省略の正常更新時に関連が保持されることも確認する。既存の [mcp-relations.test.ts](../../tests/mcp-relations.test.ts) で関連先検証を確認する。既存の [mcp.test.ts](../../tests/mcp.test.ts)、[mcp-pufu-phases.test.ts](../../tests/mcp-pufu-phases.test.ts)、OAuth・接続設定テストも引き続き実行する。

これらは有限のケースでの実装の観測結果であり、LeanモデルとTypeScriptの自動的な同値証明ではない。

## 実行

Lean **4.36.0** を `lean-toolchain` に固定。外部Leanライブラリ・Mathlibには依存しない。elan（CIは4.1.2）、Python 3、リポジトリ所定のNode.js/pnpmが必要。

```sh
# 初回のみ、リポジトリルートで依存を取得
pnpm install --frozen-lockfile

# リポジトリルート。登録・全モジュールビルド・公理監査・7種の意図的違反
python3 formal/verify.py

# 監査・登録漏れ検出自体の回帰テスト
python3 -m unittest discover -s formal -p 'test_*.py' -v

# 証明だけを検証
cd formal/mcp-verification
lake build
cd ../..

# MCPからDBまでの照合テストと、隣接する既存テスト
pnpm exec vitest run tests/mcp-update-pufu-verification.test.ts tests/mcp.test.ts tests/mcp-pufu-phases.test.ts tests/mcp-relations.test.ts
```

elanのbinディレクトリをPATHに含める。ビルドは警告をエラーにし、未証明プレースホルダーを残さない。

`check.py` は、まず正しいプロジェクトをビルドする。その後、認証・スコープ・所有権・プロジェクト制限・revision比較の除去、拒否時の書込、revisionを2増やす変異を、それぞれ一時ディレクトリ内の**モデル定義に**適用する。定理は変更せず、キャッシュのない状態でビルドする。対応する証明ファイルでのコンパイルエラーが必須で、変異が通った場合やダウンロード失敗等の環境エラーなら検証全体を失敗させる。元のファイルは変更しない。

## CI

既存の [.github/workflows/validate.yml](../../.github/workflows/validate.yml) にLean専用jobを追加する。SHA-256も固定したelanを導入し、固定Leanで共通の `formal/verify.py` と検査機構の回帰テストを実行する。関連TypeScriptテストは既存の全テスト4分割jobに自動で含まれ、依存インストールやテスト基盤を重複させない。

PRの `ci.yml` とmain用 `cloudflare-deploy.yml` はこの再利用workflowを呼ぶため、Lean・変異検出・TypeScriptのいずれかが失敗すれば、既存の集約 `Check` も失敗する。新しい本番アクセス権限やSecretsは不要。

## 検証対象外・発見した既存挙動

- **旧データの同期:** `initialPufuPhase` はrevision条件を付けずbatchの先頭で実行される。したがって、認証・権限を持つ利用者のrevision競合でも、欠損・不一致の第1局面が初期化・同期され得る。権限拒否時のP3には該当しないが、モデルの `rejected_unchanged` を実装の任意の拒否に無条件で一般化できない。境界テストで記録し、既存コードは変更していない。もし「競合拒否でも局面テーブル不変」を要件とするなら、同期を更新条件で保護する案を別途検討する。旧Worker互換との整合確認が必要。
- **並行処理:** SQLのrevision/current_phase条件は調査したが、複数同時リクエストの全インターリーブ、読み取り後の移動・削除、権限変更との競合は証明していない。
- **DBの意味論:** D1 batchのトランザクション・SQL実行・障害時rollback、本番D1との同等性は証明していない。PoCは成功する逐次更新と、観測した拒否ケースを扱う。
- **認証の内部:** OAuthライブラリ、暗号、トークン期限・refresh・PKCEの完全性は証明しない。新規照合テストは実際の認可フローを通るが、期限切れ等の全組合せまでは扱わない。
- **データ全体:** 関連データ・task・時刻・タイトル・ジョブ・R2・監査ログ等はLean Stateに含めない。新規テストのDB前後比較は上記4テーブルに限定する。スキーマと関連先の全パターンは既存テストに依存する。
- **実装への接続:** TS/SQLからのモデル自動抽出、コード生成、refinement証明は未実装。仕様変更時にはモデルと照合テストの両方をレビューする必要がある。

ユーザーマニュアル更新なし: 基本操作・利用条件・既存の権限仕様に変更なし。

## ローカル検証結果

Lean 4.36.0への更新では、既存18定理に正常系・拒否系の存在証明2定理（Examples.lean）を加えてビルドした。共通ランナーは生成された補助定理も含む37定理の公理依存を検査し、7変異すべてを拒否した。公理監査・登録の回帰テスト6件（間接的独自公理、間接的sorryAx、native_decide・private宣言の4失敗fixtureを含む）も成功した。関連するTypeScript結合テスト4ファイル75件、型チェック・lintも成功した。スキーマ・局面存在・DB成功の抽象化は引き続き前提であり、この存在証明でTypeScript実装との同値性が証明されたわけではない。

以下の全体テスト・E2Eは、初回PoC（Lean 4.24.0）時点の記録である。

- Lean: 18定理のビルド成功、7変異すべての証明失敗を確認。
- 新規照合テスト: 15/15成功。隣接する既存MCPの3ファイルは60/60成功。
- typecheck、lint、format:check、build、依存監査は成功。
- 全体実行（4ワーカー）: 138ファイル、1,579件中1,573件成功、既存6件失敗。失敗した6件だけを1ワーカーで再実行すると4件成功し、`pufu.test.ts` の15件送信による日次上限テストと `memory-updates.test.ts` の128件要約テストは既定20秒で再度タイムアウトした。制限時間・期待値・本番コードは変更していない。変更前の `origin/main`（`b25b3f1`）の別worktreeで同じ2件を再検証すると、128件要約テストは同じ20秒制限で失敗、日次上限テストは成功した。少なくとも要約テストのタイムアウトは変更前でも再現する。全体が成功したとは扱わない。
- E2E: 台帳27シナリオ×2画面幅の整合性確認成功。CIモードで全件再生した結果、desktop 27件とphone 1件が成功したが、既存ランナーのコマンド総時間制限によりphone 1件が中断、25件が未実行。失敗0件、モデル呼出し・トークン消費0でも、全件成功とは扱わない。CIは既存の画面幅別・2分割構成で引き続き全件を検証する。

## 他のMCP操作への展開

`Access` のスコープ・所有者・プロジェクトの考え方を再利用し、各操作の実装を先に調査して固有の状態遷移を追加する。次候補は `add_pufu_phase`（局面増加とrequest_id再送）、`create_pufu`（新規作成と冪等性）。updateのrevision規則や拒否時不変性をそのまま転用せず、操作ごとのテスト・変異検出・対応表を追加する。
