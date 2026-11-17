# B04: MCPのプ譜作成・局面追加

対象は `BoundaryVerification.McpWrites`。製品コードの変更は行わず、作成と追加を別の逐次遷移として検証する。

## 実装と判定時点

- [MCPツール](../../../server/mcp/tools/pufu.ts) → [run](../../../server/mcp/tool-context.ts) で `pufus:write` を確認する。`create_pufu` は内部APIを経由して [createSavedPufu](../../../server/features/pufu/pufu-write.ts) に到達する。`add_pufu_phase` は [appendSavedPufuPhase](../../../server/features/pufu/pufu-phases.ts) を直接呼ぶ。
- 作成は要求先プロジェクトの本人所有・接続範囲を確認してから、本人と `request_id` から決まるIDの既存行を読む。保存済み `request_json` と正規化済み要求が一致すれば追加保存せず返す。不一致は409。新規作成時はINSERTのSQLでも所有者・範囲・代表の問いの有効性を確認する。
- 局面追加は対象の存在・本人所有・プロジェクト所有者の整合・接続範囲を確認した後、本人と `request_id` のレシートを読む。レシートの対象IDと要求ハッシュを比較する。**一致する再送の判定はready/revisionの確認より前**であり、後の更新後もレシートの元のphase/revisionを返す。
- レシートがなければ、ready・要求revisionと現在revisionの一致を確認する。保存バッチ内でも所有者・プロジェクト・ready・revision・current_phaseを確認し、今回の `operation_id` のレシートを発行できた操作だけが後続の局面・コメント・本体を保存する。
- 認可済み要求の途中で接続設定が失効した場合の取消しはモデル化しない。認証時の接続設定取得とツールでのscope確認、その後のDB条件を区別する。

## モデル

`Access` はwrite scope・所有条件・接続先条件の3項を分ける。このモジュールでは各SQLから得る判定値を抽象化し、IDと許可集合そのものの対応はB05が扱う。これらを含む単一の `valid` は置かない。

`create` は1人・1つの `request_id` に対応する保存枠を扱う。`CreatePayload` はプロジェクト、スコア、タイトル、問い・ストックの正規化済みID群に加え、`request_json` の関係フィールドの形を `explicitRelations` で保持する。`question_ids` / `stock_ids` の両方が省略ならfalseでlegacyの `question_id` 形、片方でも明示されればtrueで配列形となる。関係先がともにゼロでも、省略時の `question_id: null` と明示空配列は異なる要求として扱い、同じrequest_idで形を変えると409になる。初回はrevision/currentPhaseとも1、第1局面に入力スコアを置く。再送時は現在の保存行を維持し、形を含む要求内容の一致だけを確認する。`created` は機能関数内部の結果であり、現在のMCP作成応答には公開されない。

`append` は全レシートをリストで保持する。要求には `requestId`、対象プ譜ID、revision、任意のスコア置換、任意の理由を含む。新規追加はcurrentPhase/revisionを各1増やし、新番号だけにスコアを書き、理由があればその局面へ1件追加し、関連を保つ。再送は保存状態全体を維持する。

## 保護状態と対応

| 保護する性質                                                                | Leanの定理                                                                                                                                                                                                                        | 実装と照合テスト                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 初回作成は第1局面・revision1、同要求の再送は保存なし、異なる内容は拒否      | `create_first_phase`, `create_replay`, `create_payload_conflict`, `create_rejected_unchanged`                                                                                                                                     | `pufu-write.ts` の `load` / `response` / INSERT。新テスト「B04: 再送・競合・古いrevisionでレシートや関連・履歴・利用枠も増やさない」                                                                                                        |
| scope・所有者・接続先を満たさなければ、レシートがあっても拒否               | `create_missing_scope`, `append_missing_scope`, `append_non_owner`, `append_outside_project`                                                                                                                                      | `run` と対象SELECT。新テスト「B04: scope・所有者・プロジェクトの拒否では成功済み再送でも保護状態を変更しない」。移動後は既存 `mcp-pufu-phases` の「書込権限・所有者・許可プロジェクトを検証し、成功済みの再送でも範囲外なら拒否する」       |
| 局面再送は元のレシート結果を返し、payload変更は拒否                         | `append_replay_original_result`, `append_changed_payload_denied`                                                                                                                                                                  | `loadReceipt` / `response`。新テストの再送・競合ケース。理由・対象・score・revisionの変更は既存 `mcp-pufu-phases` の「同一リクエストの同時再送と後日の再送で局面・コメントが重複せず元の結果を返す」                                        |
| レシートがない古いrevision・未完成は拒否、拒否では状態全体を維持            | `append_stale_revision`, `append_not_ready`, `append_rejected_unchanged`                                                                                                                                                          | ready/revision判定と保存guard。新テストの古いrevisionケース。未完成は既存 `mcp-pufu-phases` の「不正入力・未完成・壊れた保存データを拒否し、局面やコメントを変更しない」                                                                    |
| 新規追加はrevision/局面を1増加、旧局面・関連を維持し、理由を新局面へ1件保存 | `append_success`, `append_created_commit`, `append_created_revision_phase`, `append_created_keeps_old_phase`, `commit_revision`, `commit_keeps_old_phase`, `commit_new_phase`, `commit_preserves_relations`, `commit_reason_once` | `operation_id` 付きバッチ。既存 `mcp-pufu-phases` の「MCPの局面追加は前の局面を保持し、変更・複製・最初のコメントをWebでも取得できる」、`mcp-relations` の「MCPで複数の問い・ストックを紐付けて登録し、再送・編集・局面追加後も取得できる」 |
| 成功・競合・古いrevision・後日の再送へ具体的に到達できる                    | `create_success_reachable`, `create_conflict_reachable`, `append_success_reachable`, `append_stale_reachable`, `append_late_replay_reachable`                                                                                     | 具体要求と状態をLeanのカーネルで評価                                                                                                                                                                                                        |

関係フィールドの形の保持は `pufu-write.ts` の `request_json` 構築分岐に対応する。`create_request_shape_conflict` と `create_empty_relations_shape_conflict_reachable` が形だけの変更でも拒否・保存状態維持となることを証明し、新テスト「B04: 関係ゼロでもlegacy省略と明示空配列の形を変えた再送は409でDBを維持する」が省略→明示と明示→省略を実MCP入口から照合する。

新規テストは [boundary-mcp-verification.test.ts](../../../tests/boundary-mcp-verification.test.ts)。スナップショットは本体・局面・レシート・問い・関連・コメント・メモリ履歴・AI利用操作・ストック利用記録を比較する。OAuth自体の利用記録は保護状態に含めない。局面モデルの状態外にある履歴・利用記録については実装照合による確認であり、それらのDBテーブルを数学的にモデル化したとは扱わない。

## 前提・未検証・現行応答の制約

- スコア本文・理由・IDは不透明な自然数へ置き換える。JSON/Zod検証、256KiB判定、UUID生成、ID群の重複排除・整列、`request_json` の直列化、ハッシュの衝突耐性は前提であり証明しない。関係フィールドのlegacy/配列形は区別し、意味的に同じ関係なら常に同一JSONになるとは仮定しない。phase要求の完全一致は実装の対象ID一致＋要求ハッシュ一致に対応する抽象化である。
- 認証主体の確定、同一所有者の各行の整合、SQLとD1の動作、バッチの原子性を前提とする。モデルは逐次操作であり、並行再送・別要求の競合・読取と保存間の移動/削除を形式証明しない。既存テストは一部の同時再送・競合を実D1で照合するが、全インターリーブの証明ではない。
- 旧データの欠けた第1局面を補完する処理は遷移から除外し、局面が初期化された状態を扱う。実装の補完は既存 `mcp-pufu-phases` の「旧データの欠けた第1局面は元の内容と日時で補い、原局面を新しい内容で上書きしない」が照合する。
- **作成再送の応答全体は不変ではない。** `createSavedPufu` は保存済み `request_json` を維持する一方、現在行のrevision/current_phase/status等を返す。タイトル・taskは元の入力由来。新テストは局面3へ進んだ後の作成再送がrevision3/current_phase3を返し、DBを書き換えない現行挙動を固定する。「作成も後日の再送で初回応答と完全一致」という要件は現行実装では満たさない。必要なら作成用の不変レシートまたは明示的な応答契約を別途検討する。製品コードは変更していない。

## 検証

Lean 4.36.0標準ライブラリだけを使用。定理29件。`sorry` / `admit` / 独自公理 / `native_decide` は使わない。[変異7件](../mutations/mcp-writes.json) は作成payload、関係フィールド形の同一性、レシート優先順、再送payload、revision照合・増分、旧局面の保持を破り、各指定定理の証明失敗で検出する。
