# B05: MCPのscope・所有者・プロジェクト・一覧可視性

対象は `Verification.McpVisibility`。実際のIDと許可集合、対象種別ごとのscope、一覧のフィルタとページ/件数、書込応答の投影を扱う。

## 実装と判定時点

- [MCPツール群](../../../server/mcp/tools) は [run](../../../server/mcp/tool-context.ts) でツールごとのscopeを確認する。projects/stocks/questions/memoriesのscopeは別で、プ譜のコメントのread/writeは `questions:read` / `questions:write` を使う。`pufus:write` はコメントの許可を代替しない。
- 詳細は [ownedStock / ownedQuestion / ownedPufu](../../../server/api/context.ts)、メモリは本人のプロジェクト取得、コメントは [targetQuery](../../../server/features/comments/comments.ts) で所有者と許可プロジェクトを調べる。コメント一覧・保存SQLは同じ対象条件を再利用する。
- [project-access](../../../server/features/projects/project-access.ts) の `null` は本人の全プロジェクト、空配列は許可なし。選択済みの複数プロジェクトはそれぞれ集合の要素として扱う。
- stocks/questions/pufusの一覧は所有者・許可プロジェクト・明示指定先・全体一覧表示設定を**ページ分割、総数、意味検索候補の前**に適用する。本人所有の非表示プロジェクトも明示指定または接続先選択があれば一覧対象になる。projects一覧は非表示先も含む。
- [handleMcp](../../../server/mcp/server.ts) は接続設定読込時に許可先を本人所有の現存プロジェクトと照合し、現存する許可先が空ならHTTP403で入口を拒否する。認証後に接続が失効・範囲変更された実行中要求の強制取消しは証明しない。

## モデルと保護状態

`Principal` は本人ID・scopeのリスト・任意の許可プロジェクトID集合を持つ。`Row` は所有者・プロジェクト・表示設定・私的データを持つ。`access` はscope包含、owner一致、project包含を独立に計算し、`detail` は通過した行のデータだけを返す。

`filtered` はこれに要求プロジェクトと表示設定を加えて絞り込む。`page` は絞り込み済みリストをdrop/takeし、`total` は同じ絞り込み済みリストを数える。拒否された行が1つ追加されても総数が変わらない性質と、返した各ページの全要素が許可集合に属する性質を証明する。

`questionWrite` は `add_question` のMCP応答投影を抽象化する。保存処理を通過した要求の応答は送信値から作り、既存の私的行を応答へ混ぜない。保存前のscope/owner/project拒否では、入力記録・私的行・revision・関連・履歴・利用記録から成る `WriteState` 全体を維持する。成功時のsavedInputsは単一保存の抽象的記録であり、問い作成自体のrequest_id再送をモデル化したものではない。

## 定理・実装・テストの対応

| 保護する性質                                                                                                     | Leanの定理                                                                                                                                       | 実装と照合テスト                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scope・owner・projectの個別条件を全て満たした場合だけ詳細を返す                                                  | `access_conditions`, `detail_missing_scope`, `detail_wrong_owner`, `detail_outside_project`, `detail_permitted`                                  | `run`、API所有判定、`ownedDetail`。既存 `mcp.test.ts` の「ID指定・検索・追加のどれも許可プロジェクト外と他ユーザーを拒否する」、`mcp-memory.test.ts` の「専用権限とプロジェクト範囲を保ち、履歴一覧と指定版本文を取得する」等       |
| 検索/ページの全要素はscope・owner・projectの許可集合に含まれる。総数も同じ条件で数え、許可外行の追加で変わらない | `filtered_subset_permitted`, `page_subset_permitted`, `total_counts_only_filtered`, `total_ignores_forbidden_row`                                | `projectListFilter` と各一覧SQL。新テスト「B05: プ譜一覧は許可集合で絞った後に総数とページを求め、選択された非表示先を含める」。既存 `mcp-connection-settings` の「意味検索・hybridの候補と総数にも複数プロジェクト制限を適用する」 |
| 空集合を全件許可として扱わない                                                                                   | `empty_selection_no_rows`, `empty_page_reachable`                                                                                                | SQLフィルタの性質をモデル化。実MCP入口は403になるため、新テスト「B05: 最後の許可先削除後は他の本人プロジェクトがあっても一覧を全体公開へ拡張しない」で5種の入口拒否とDB不変を照合                                                   |
| 非表示先は全体一覧から除外、接続先選択・明示指定なら許可条件内で表示                                             | `hidden_global_excluded`, `hidden_selected_included`, `explicit_project_included`                                                                | 新テストのプ譜一覧・projects一覧。既存 `mcp.test.ts` の「全体一覧の非表示設定を反映し、プロジェクト指定・接続先限定では表示する」はstocks/questionsを照合                                                                           |
| プ譜コメントの書込scopeはquestions:write                                                                         | `pufu_comment_requires_questions_write`                                                                                                          | `tools/comments.ts` のtarget_type分岐。新テスト「B05: プ譜のコメントはquestions権限を使い、pufus書込権限を読取・コメント権限へ昇格しない」                                                                                          |
| 書込拒否は保護状態を維持。問い書込応答は送信内容に限定                                                           | `write_denied_unchanged`, `question_response_only_submitted`                                                                                     | `tools/question-write.ts` の送信値からの応答構築。既存 `mcp-relations` の「問いの書き込み許可だけで関連ストック名や再送後の個人メモを読み出せない」。新テストのコメントscope拒否ではレシート/関連/履歴/利用記録を含むDB状態を比較   |
| 詳細・ページ・書込の成功と拒否に具体的到達例がある                                                               | `detail_success_reachable`, `detail_rejection_reachable`, `page_success_reachable`, `writer_success_reachable`, `writer_missing_scope_reachable` | 具体ID・scope・許可先をLeanのカーネルで評価                                                                                                                                                                                         |

新規テストは [boundary-mcp-verification.test.ts](../../../tests/boundary-mcp-verification.test.ts)。入口はOAuthで発行した実トークンを使う `/mcp` の `tools/call` で、認可関数の直接呼出しやDBのモックは使わない。一覧はローカルD1へ種データを挿入し、24件/1件/0件の3ページ、全体一覧・明示指定・selected接続を比較する。外部通信は行わない。

## 前提と未検証

- モデルの `required : Scope` と実ツールの対応は上記表と実装調査・照合テストで確認する。全ツールの宣言からLeanモデルを自動生成・検証してはいない。コメントのtarget_typeによる分岐は独立した `commentScope` で扱う。
- 詳細取得と一覧の所有条件は、整合したDB上の本人・プロジェクトを自然数IDで表す。関連先の本文取得・JSON形式・意味検索の順位・重複排除・SQL結合そのものは証明しない。既存の複数関連、移動時の取得、意味検索テストを再利用する。
- 空許可集合・scope不足はフィルタ層では0件を表現するが、実MCP入口はそれぞれ403で拒否する。許可外の明示project_idも、モデルの返却候補0件という性質に対し実装は403/404を返す。モデルはエラー番号の完全同値を主張しない。
- `questionWrite` の応答投影は `add_question` に限定する。他のツール、特にstock追加が常に送信値だけを返すというルールは追加しない。私的本文の完全な情報流・タイミング漏洩は対象外。
- `WriteState` の逐次保存を扱い、D1原子性、DBトリガー、並行要求、途中の移動/削除・接続失効の全インターリーブは未証明。拒否時の業務データ・関連・履歴・利用枠は照合テストの比較範囲で確認し、OAuth利用記録は不変としない。

## 検証

Lean 4.36.0標準ライブラリだけを使用。定理22件。`sorry` / `admit` / 独自公理 / `native_decide` は使わない。[変異8件](../mutations/mcp-visibility.json) は一覧フィルタ、scope、owner、project、空集合、非表示条件、コメントscope、問い応答の投影を破り、各指定定理の証明失敗で検出する。
