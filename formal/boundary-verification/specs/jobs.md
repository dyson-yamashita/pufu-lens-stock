# B08: 世代付き非同期ジョブ

モデルは [Jobs.lean](../BoundaryVerification/Jobs.lean)。標準Lean 4.36.0のみを使い、他の境界モデルはimportしない。

## 実装の入口と判定時点

- [jobs.ts](../../../server/infrastructure/jobs/jobs.ts) の `dispatchJobs` は一覧取得後、条件付き `UPDATE processing_jobs` と起動回数増加をD1 batchで確定してからWorkflowを起動する。pending、cleanup例外を含む生存/登録済みuser、問いの自動生成設定、10回未満、受付から30分未満、将来へのdeferralなしをUPDATE時に再確認する。`mayDispatch`/`claimDispatch` はこの確定を表す。時間は `withinWaitLimit` に抽象化し日時文字列の演算は証明しない。
- [workflows.ts](../../../server/infrastructure/jobs/workflows.ts) の `claimJob` は起動時にdone/failedを拒否する。`claimWorkflow` はこの条件のみを表す。claim時には世代・onboardingの再確認を含めない。
- MemoryWorkflowはownerの最新revisionを照会し、生成後に [memory-history.ts](../../../server/features/memory/memory-history.ts) の `saveMemoryWithHistory` を呼ぶ。この保存関数もownerとrevisionを事前照会する。userのonboarding条件はこの照会にあるが、最終D1確定の `memorySaveStatement` にはない。
- R2 PUTが完了した後、[db.ts](../../../server/infrastructure/db.ts) の `memorySaveStatement` はowner存在、user対応、最新revision一致を条件にmemoriesを保存する。同じbatchの [memory.ts](../../../server/features/memory/memory.ts) `memorySourceStatements` は、保存済みmemoryと現在ownerのrevision一致を条件に根拠を入れ替える。`commitMemory` が表す保護状態は、この最新本文/revision/根拠集合のみ。
- Cronの `scheduledMaintenance` がWorkflow状態を照会した後、[job-retries.ts](../../../server/infrastructure/jobs/job-retries.ts) の `deferJob` にstatus/attempts/updatedAtの取得済み値を渡す。`deferWithLease` は3条件すべてを渡すこの呼出しだけを表す。他の呼出しではguardが一部省略されるため、全defer処理に同じ保証を広げない。更新が成功した場合だけ `changes()=1` でai_deferralsを登録する。

## 定理・変異・照合の対応

| 保護する状態・性質                                                              | 定理                                                                                                                                             | 実装を通すテスト                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 現在ownerの現在revisionなら本文/revision/根拠を確定                             | `current_generation_commits`, `memory_success_reachable`                                                                                         | 既存 `memory-history.test.ts`: 「R2に各版を保存し、一覧は本文や内部キーを返さず、過去版取得でAIを呼ばない」                                                                                                                                                                                |
| stale revisionで最新本文/根拠を変更しない                                       | `stale_generation_preserves_memory`, `memory_rejection_reachable`                                                                                | 新規 `boundary-lifecycle-verification.test.ts`: 「B08 %sのR2保存中に世代が進んだらD1の本文・根拠・公開履歴を進めない」user/project各1件                                                                                                                                                    |
| 削除済み/所有者不一致でmemoryを復活させない                                     | `deleted_owner_preserves_memory`, `foreign_owner_preserves_memory`                                                                               | 既存 `memory-history.test.ts`: 「削除中に遅れてR2保存が完了しても掃除要求を再作成し、別利用者を消さない」、新規B10退会後PUTテスト                                                                                                                                                          |
| 古いstatus/attempts/updatedAtで新しいジョブを保留へ戻さず、deferralを追加しない | `stale_timestamp_preserves_job`, `stale_attempt_preserves_job`, `terminal_job_preserved`, `lease_success_reachable`, `lease_rejection_reachable` | 新規「B08 保守の状態照会中に%sが変わったジョブを古いleaseで保留へ戻さない」timestamp/attempts各1件。実Cron→Workflow binding照会→D1 batchを通す。既存 `job-retry-limits.test.ts`: 「並行Cronの古い完了確認で10回目の実行を待機・失敗へ戻さない」と異なり、status一定で各guardだけを変更する |
| 非cleanupの削除userはdispatcher確定不可、cleanupはuser不在でも到達可能          | `deleted_user_cannot_dispatch`, `dispatch_success_reachable`, `cleanup_without_user_reachable`, `dispatch_rejection_reachable`                   | 既存 `account-deletion.test.ts`: 「退会後に処理中のジョブが保留へ戻っても、削除した履歴を再登録しない」。既存 `usage-limits.test.ts`: 「Workflow起動直後の保留をdispatchedで上書きせず、並行dispatcherも二重起動しない」                                                                   |
| 停止が確定済みのジョブはWorkflow claimで再起動しない                            | `stopped_workflow_cannot_restart`                                                                                                                | 既存 `job-retry-limits.test.ts`: 「停止確定後に遅れて起動した%sはAI処理を開始しない」article/user_memory各1件                                                                                                                                                                              |

[jobs.json](../mutations/jobs.json) はrevision条件、生存owner条件、lease時刻条件、dispatcher生存user条件を各1箇所だけ除去する4変異。指定した拒否定理の証明失敗を確認し、構文・依存・型のエラーを検出成功に数えない。

## 前提と限界

- D1 batchのSQL順序/原子性、`changes()`、外部キー、固定したDBスキーマを前提とする。owner IDの再利用やprojectの所有者付替えは現行経路にない。`belongsToUser` はproject事前照会と保存SQLのuser対応を表し、DB中の既存memoryがownerに対応する到達可能な状態だけを扱う。
- `commitMemory` はmemoryと根拠の確定だけを表す。`versionStatement` は保存済みmemoriesと同revisionなら履歴メタデータを追加できる。既存の未履歴化memoryを保全する処理もあるため、stale保存で「全履歴が常に不変」とは証明しない。新規テストは保存済み第0版がある具体状態で第1版が一覧へ公開されないことを確認する。
- R2 PUTはD1確定より先で、古い世代のオブジェクトが残り得る。新規テストでもR2オブジェクトと未解決intentの存在を確認する。現在ownerが残る間、そのような未参照オブジェクトを即時回収する保証はない。owner削除後の回収はB10で扱う。
- dispatcherの生存user/onboarding確認はclaim確定時だけ。後から失効した認証、実行中の全非同期処理、AIキャッシュ、記事/問い/プ譜の全保存箇所を一括保証するモデルではない。記事などの世代条件は既存テストに残し、ここで定理化したとは扱わない。
- 外部通信/実AIは使わない。実Miniflare D1/R2と既存Workflow harnessを使い、競合タイミングをR2 bindingまたはWorkflow statusの一箇所で制御する。Cloudflare本番Workflow実行・並列スケジューラ全体の線形化は未検証。
