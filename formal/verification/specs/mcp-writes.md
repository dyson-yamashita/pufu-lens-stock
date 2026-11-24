# B04: MCPのプ譜作成・局面追加

対象は `Verification.McpWrites`。製品コードの変更は行わず、作成と追加を別の逐次遷移として検証する。

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

| 保護する性質                                                                | Leanの定理                                                                                                                                                                                                                        | 実装と照合テスト                                                                                                                                                                         |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 初回作成は第1局面・revision1、同要求の再送は保存なし、異なる内容は拒否      | `create_first_phase`, `create_replay`, `create_payload_conflict`, `create_rejected_unchanged`                                                                                                                                     | `pufu-write.ts` の `load` / `response` / INSERT。MBTで作成と再送・競合を照合する                                                                                                         |
| scope・所有者・接続先を満たさなければ、レシートがあっても拒否               | `create_missing_scope`, `append_missing_scope`, `append_non_owner`, `append_outside_project`                                                                                                                                      | `run` と対象SELECT。MBTで接続の書込権限を外した後の再送を照合する。所有者・許可プロジェクトの拒否は `boundary-mcp-verification`、プロジェクト移動後の再送は `mcp-pufu-phases` が照合する |
| 局面再送は元のレシート結果を返し、payload変更は拒否                         | `append_replay_original_result`, `append_changed_payload_denied`                                                                                                                                                                  | `loadReceipt` / `response`。MBTで第2・第3局面および未完成状態での再送と理由変更を照合する。`mcp-pufu-phases` は同時再送や対象・スコア・revisionの変更も確認する                          |
| レシートがない古いrevision・未完成は拒否、拒否では状態全体を維持            | `append_stale_revision`, `append_not_ready`, `append_rejected_unchanged`                                                                                                                                                          | ready/revision判定と保存guard。MBTで古いrevisionと未完成状態への新規追加を照合する                                                                                                       |
| 新規追加はrevision/局面を1増加、旧局面・関連を維持し、理由を新局面へ1件保存 | `append_success`, `append_created_commit`, `append_created_revision_phase`, `append_created_keeps_old_phase`, `commit_revision`, `commit_keeps_old_phase`, `commit_new_phase`, `commit_preserves_relations`, `commit_reason_once` | `operation_id` 付きバッチ。MBTで追加ごとの保存状態を照合する。`mcp-pufu-phases` と `mcp-relations` はWebでの取得や複数関連を確認する                                                     |
| 作成・局面追加の成功と基本的な拒否へ具体的に到達できる                      | `create_success_reachable`, `create_conflict_reachable`, `append_success_reachable`, `append_stale_reachable`                                                                                                                     | 具体要求と状態をLeanのカーネルで評価                                                                                                                                                     |

関係フィールドの形の保持は `pufu-write.ts` の `request_json` 構築分岐に対応する。`create_request_shape_conflict` と `create_empty_relations_shape_conflict_reachable` が形だけの変更でも拒否・保存状態維持となることを証明し、`boundary-mcp-verification` の「関係ゼロでもlegacy省略と明示空配列の形を変えた再送は409でDBを維持する」が省略→明示と明示→省略を実MCP入口から照合する。

## 操作順序のMBT

[XStateモデル](../../../tests/models/mcp-pufu-writes.ts)から各状態への最短経路を生成し、その状態に留まる再送・拒否イベントを経路の末尾に追加する。必須の再送・競合イベントが対応する経路に含まれることもテストする。旧 `append_late_replay_reachable` が扱った「現在の局面・revisionが先に進み、readyでなくなっても、同じ要求には元のレシートを返す」という具体例も含める。経路生成は [StatelyのMBTガイド](https://stately.ai/docs/model-based-testing) と [XState v5のグラフAPI](https://stately.ai/docs/xstate/v5/graph) を参照した。

[boundary-mcp-verification.test.ts](../../../tests/boundary-mcp-verification.test.ts) は経路ごとに新しいMiniflare環境を作り、OAuthで発行したトークンを使って実際の `/mcp` 入口を呼ぶ。各操作の応答と、D1の本体・局面・レシート・コメント・関連を照合する。再送と、古いrevisionでの局面追加・編集などの拒否では、問い・ストック・メモリ履歴・AI利用操作・ストック利用記録も含めて操作前と比較する。権限の変更には連携設定APIを使う。未完成状態はローカルD1のフィクスチャで作り、レシートを残しながら局面番号とrevisionを異なる値にする。履歴・利用記録の確認はD1の照合テストの範囲で、OAuth自体の利用記録は比較対象から除く。

```sh
pnpm run test tests/boundary-mcp-verification.test.ts -t 'B04 MBT'
```

## 前提・未検証・現行応答の制約

- スコア本文・理由・IDは不透明な自然数へ置き換える。JSON/Zod検証、256KiB判定、UUID生成、ID群の重複排除・整列、`request_json` の直列化、ハッシュの衝突耐性は前提であり証明しない。関係フィールドのlegacy/配列形は区別し、意味的に同じ関係なら常に同一JSONになるとは仮定しない。phase要求の完全一致は実装の対象ID一致＋要求ハッシュ一致に対応する抽象化である。
- 認証主体の確定、同一所有者の各行の整合、SQLとD1の動作、バッチの原子性を前提とする。モデルは逐次操作であり、並行再送・別要求の競合・読取と保存間の移動/削除を形式証明しない。既存テストは一部の同時再送・競合を実D1で照合するが、全インターリーブの証明ではない。
- 旧データの欠けた第1局面を補完する処理は遷移から除外し、局面が初期化された状態を扱う。実装の補完は既存 `mcp-pufu-phases` の「旧データの欠けた第1局面は元の内容と日時で補い、原局面を新しい内容で上書きしない」が照合する。
- `createSavedPufu` の再送は元の入力のタイトル・taskと、現在行のrevision/current_phase/status等を返す。MBTは第3局面へ進んだ後の作成再送でrevision3/current_phase3が返り、保存済み `request_json` を含めてDBが維持されることを照合する。

## 検証

Lean 4.36.0標準ライブラリだけを使用。定理28件。`sorry` / `admit` / 独自公理 / `native_decide` は使わない。[変異7件](../mutations/mcp-writes.json) は作成payload、関係フィールド形の同一性、レシート優先順、再送payload、revision照合・増分、旧局面の保持を破り、各指定定理の証明失敗で検出する。
