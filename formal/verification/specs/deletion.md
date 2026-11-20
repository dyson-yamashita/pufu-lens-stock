# B10: アカウント削除とcleanup世代

モデルは [Deletion.lean](../Verification/Deletion.lean)。独立した標準Lean 4.36.0モジュールで、Jobsモデルをimportしない。

## 実装の入口と判定時点

[account.ts API](../../../server/api/routes/account.ts) の `DELETE /api/v1/me` は認証済みprincipalのuser IDを使い、[account.ts](../../../server/features/auth/account.ts) の `requestAccountDeletion` を待つ。D1 batch内でaccount_deletionsと既存Workflow IDを退避し、deferral/起動回数を削除してusersを削除する。外部キーcascadeで業務データとセッション/APIトークン行が消える。このD1確定を `requestDeletion` で表す。`authenticated` は当該userに紐づく認証行の存否を表し、認証アルゴリズムや入口の許可表そのものの証明ではない。

その後に `cleanupAccount` がWorkflowの削除、CONTENT/MEMORY_HISTORYのprefix削除、OAuth grant失効を行う。各種処理の例外・ページ途中・Workflow未処理分は要求を残す。全体はD1とR2/KVの共通トランザクションではない。APIは外部cleanup完了なら200、残る場合は202を返す。`finishCleanup` の入力状態は外部I/O終了後のD1状態で、完了判定はその時点のtombstone世代一致とpendingJobsなし、各外部走査が完了したことを個別に表す。

`cleanupIfAccountDeleted` は外部保存後にusersを再照会し、不在ならcleanup要求を再作成/世代更新してから掃除する。古い `cleanupAccount` は最後の `DELETE ... generation=? AND NOT EXISTS(account_deletion_jobs...)` によって新要求を削除できない。モデルの `observeLateWrite` と `old_sweep_cannot_acknowledge_late_write` がこの時点を扱う。userが生存する場合の関数は要求を作らない。

記事本文のR2書き込み完了が退会処理より遅れた場合も `cleanupIfAccountDeleted` を使う。[本文の照合テスト](../../../tests/text-stocks.test.ts) はダミーの退会APIとローカルR2を通し、遅れて書いた本文の掃除と別の所有者の本文の保持を確認する。

[memory-history.ts](../../../server/features/memory/memory-history.ts) はR2 PUT前にcascade外の `memory_history_writes` を登録する。owner不在の未解決intentは削除せず、Cronが繰り返しR2 DELETEする。workerが停止し、先の掃除より遅くprovider PUTが完了するケースも再掃除できる。別系統のprefix要求 `memory_history_cleanup` も、list/delete後の最終DELETEで世代を確認する。

## 定理・変異・照合の対応

| 保護する状態・性質                                                       | 定理                                                                                                                                    | 実装を通すテスト                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1で本人の業務/認証/実行ジョブ行を削除し、掃除するWorkflow IDを残す      | `deletion_cascades_logical_data`, `deletion_preserves_cleanup_work`, `deletion_success_reachable`                                       | 既存 `account-deletion.test.ts`: 「本人の全登録データと旧本文・Workflow状態を削除し、他ユーザーを保持する」                                                                                           |
| D1 cascadeだけでは外部オブジェクトを削除したと扱わず、別userの状態を保持 | `deletion_does_not_claim_external_atomicity`                                                                                            | 既存「R2削除が失敗しても退会と認証失効を確定し、Cronで再試行する」、新規B10遅いPUTテスト                                                                                                              |
| 現在世代・全Workflow完了・全走査完了なら要求を除去                       | `matching_complete_cleanup_finishes`, `cleanup_success_reachable`                                                                       | 既存account-deletion成功/複数ページ/再試行テスト                                                                                                                                                      |
| 古い世代・残るWorkflow・未完了の外部走査は要求を保持                     | `stale_cleanup_preserves_request`, `unfinished_jobs_preserve_request`, `partial_sweep_preserves_request`, `cleanup_rejection_reachable` | 既存 `account-deletion.test.ts`: 「並行する古い削除処理が、遅延MCP保存の新しい削除要求を消さない（要求再作成: %s）」既存/再作成の両ケース                                                             |
| 遅延保存で要求を更新/再作成し、古い掃除に完了させない                    | `late_write_recreates_request`, `old_sweep_cannot_acknowledge_late_write`                                                               | 同上の実MCP/KV保存→退会API→最終D1世代DELETE競合                                                                                                                                                       |
| 履歴prefixの新しい世代を古いlist結果で消さない                           | `stale_prefix_cleanup_preserves_request`, `prefix_success_reachable`, `prefix_rejection_reachable`                                      | 新規 `boundary-lifecycle-verification.test.ts`: 「B10 履歴掃除のlist後に再作成した世代を古い掃除が消さず次回に回収する」                                                                              |
| unresolved intentを保持し、先のDELETEより遅いPUTも再掃除                 | `interrupted_intent_is_retained`, `late_provider_put_is_recleaned`, `late_put_recleanup_reachable`                                      | 新規「B10 退会完了後の遅いPUTとworker停止をcascade外のintentから再掃除する」。退会API→実D1 cascade→実R2→保守を通す。既存 `memory-history.test.ts` にproject削除、D1失敗、同版の並行writerの対応ケース |

[deletion.json](../mutations/deletion.json) の3変異はaccount世代一致、未処理Workflowなし、history prefix世代一致をそれぞれ1箇所だけ除去する。指定された拒否定理が証明不能になることを確認する。

## 前提と限界

- 固定スキーマの外部キーcascadeとD1 batchの原子性を前提とする。既存account-deletionテストが本人の各テーブルと別userの不変性を実DBで確認する。`logicalRows` はcascade対象の本人行をまとめた最小モデルであり、全schemaのcascadeをLeanから導出するものではない。削除要求の記録を含むbatchが失敗した場合のrollbackも既存テストで照合する。
- 世代はopaqueな値をNatで表す。実装のrandomblobによる新世代が観測済み世代と異なることは `distinct` の明示前提であり、乱数の一意性や暗号的性質を証明しない。列挙されるキーのprefixが本人だけを含むこと、SDKのgrant失効、Workflow delete APIの振る舞いは外部I/Oの前提。
- 遅い外部保存はD1 cascade後にも物理オブジェクトを一時的に残せる。モデルはそれを許可し、cleanup要求とintentの世代/永続性を守る。全外部データの即時消去、全workerの同時停止、すでに返した応答の取消しを保証しない。
- `late_provider_put_is_recleaned` はowner不在、intent残存、後続cleanupが実行されDELETEが成功する前提での安全性。Cronの実行公平性、永久的なprovider障害、tombstone/intentの運用上の期限は証明しない。未解決intentは遅延PUTを捕捉するため残り続ける。
- `finishCleanup` の各complete値は外部呼出し成功とページ末尾の観測結果であり、同時に将来の書込がないことを意味しない。保存後の生存確認または未解決write intentを持たない任意の外部writerへ保証を広げない。
- 本番データ/実OAuth/実Cloudflare Workflow管理APIは使わない。新規テストは実Miniflare D1/R2を使い、R2 PUT/listのタイミングだけを制御する。APIのsession-only/CSRF拒否と削除後認証拒否は既存account-deletionテストの入口検証と、新規退会後 `/api/v1/me` の401確認に委ねる。
