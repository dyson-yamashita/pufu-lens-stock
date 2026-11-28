# B08: 世代付き非同期ジョブ

モデルは [Jobs.lean](../Verification/Jobs.lean)。標準Lean 4.36.0のみを使い、他の境界モデルはimportしない。

## 実装の入口と判定時点

- [jobs.ts](../../../server/infrastructure/jobs/jobs.ts) の `dispatchJobs` は一覧取得後、条件付き `UPDATE processing_jobs` と起動回数増加をD1 batchで確定してからWorkflowを起動する。pending、cleanup例外を含む生存/登録済みuser、問いの自動生成設定、10回未満、受付から30分未満、将来へのdeferralなしをUPDATE時に再確認する。`mayDispatch`/`claimDispatch` はこの確定を表す。時間は `withinWaitLimit` に抽象化し日時文字列の演算は証明しない。
- [workflows.ts](../../../server/infrastructure/jobs/workflows.ts) の `claimJob` は起動時にdone/failedを拒否する。`claimWorkflow` はこの条件のみを表す。claim時には世代・onboardingの再確認を含めない。
- 記事要約の確定は、世代と所有者が一致する場合に記事とメモリを進める。メモリの付随処理は更新前の未確定状態を同じD1バッチで確認し、問いの登録は同じ記事世代で照合する。`completeArticle` はこのD1遷移を扱う。記事の古い待機ジョブを終了する条件は `retireSuperseded` が扱う。
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

`old_article_cannot_commit` と `article_summary_replay_does_not_advance_memory` は古い記事世代の要約・メモリ・問いへの確定拒否と、確定済み要約の再送によるメモリ世代の保持を扱う。成功・拒否は `article_completion_reachable` と `article_rejection_reachable` で到達可能を確認し、[text-stocks.test.ts](../../../tests/text-stocks.test.ts) で本文編集を挟む実D1の確定を照合する。待機と実行中の区別は `running_job_is_not_retired`、`current_job_is_not_retired`、`retirement_reachable` で扱う。

[jobs.json](../mutations/jobs.json) はrevision、owner、lease時刻、dispatcher生存user、記事世代、待機状態の条件を各1箇所だけ除去する。指定した拒否定理の証明失敗を確認し、構文・依存・型のエラーを検出成功に数えない。

## 取得失敗時の短い本文

- [ArticleWorkflow](../../../server/infrastructure/jobs/workflows.ts) は取得の失敗を受けて、URL記事かつ手入力なし、記事の所有者・世代が一致、記事が取得中、ジョブが実行中であることを、短い本文のD1保存時に確認する。削除済みの記事に対するUPDATEは行を作成しない。`retainShortText` は失敗時に得られた前後空白を除くと空でない本文のUTF-16長と保存時の状態を受け取り、採用時は短い本文の欄だけを更新する。
- `stale_short_text_denied` と `stopped_short_text_denied` の変異は世代条件とジョブ状態を除く。`foreign_short_text_denied`、`non_extraction_short_text_denied`、`out_of_range_short_text_denied` はそれぞれの拒否、`short_text_preserves_article_state` は取得状態・要約・メモリ・問いの保持、`short_text_decisions_reachable` は成功と拒否への到達を扱う。状態照会後に世代が進んでも条件付きUPDATEで拒否する。進行中の外部取得自体の取消しは対象外。
- [照合テスト](../../../tests/workflows.test.ts) はHTML・PDF取得から失敗、権限付き詳細表示、匿名公開、再取得成功を通す。旧世代の取得中に再試行した場合に、新世代のD1に短文が保存されないことを照合する。詳細の権限判定には既存の `ownedStock` を使い、公開用の要約は既存経路で採用される。成功時はR2本文の参照設定と同時に短い本文を削除する。

## 操作順序のMBT

旧ジョブが要約確定を待つ間に本文を編集し、旧・新のジョブをどちらから完了するかで2経路を生成する。各経路の最後に、完了済みの新ジョブを同じIDで再配送する。 [要約のXStateモデル](../../../tests/models/article-summary.ts)

編集APIと `ArticleWorkflow` を呼び、旧ジョブを `commit-summary` 直前で止めて順序を制御する。旧データの待機中の問いを用意し、新しい要約が確定した時点でのみ、その世代の問いとメモリのジョブが1回ずつ追加されることを確認する。各操作後に本文、要約、記事の世代、ユーザー・プロジェクトのメモリrevision、ジョブの登録と状態、記事行が参照するR2本文を照合する。対象はテキストストック1件の連続2世代と、完了済みWorkflowの再配送である。 [テキストストックの照合テスト](../../../tests/text-stocks.test.ts)

```sh
pnpm run test tests/text-stocks.test.ts -t 'B08 MBT'
```

## 足あとの再分析

- `Reanalysis.enqueue` は、セッションと同一オリジンで受け付けた要求について、プロジェクト所有者、メモリ更新設定、詳細を持つ足あと、元の根拠、対象メモリ履歴、要求と保存済みの世代の一致、並行ジョブの有無を照合する。親の比較元・比較先・中間の版を使う。予約とジョブ追加を同じD1 batchで確定する。
- `Reanalysis.mayAnalyze` と `Reanalysis.save` は、実行中のジョブIDと対象の一致、プロジェクトの所有者と設定、閲覧できる分析の現行性、新しい分析の根拠を照合する。メモリ更新をオフにしたトランザクションで実行中のジョブを失効させ、再度オンにしても再採用しない。保存とジョブ結果のDBキャッシュ時に再照合し、再試行でジョブIDを置き換えると直前のキャッシュを消去する。外部送信前に確認し、すでに送信された処理の取消しは保証しない。
- `Reanalysis.protected_fields_preserved` は保存時の元の分析、期間、履歴、公開用原稿の保持を証明する。古いジョブ・設定オフ・無効な根拠では先の再分析結果も保持する。利用枠と失敗記録は既存のジョブ管理に従う。
- [project-footprints.test.ts](../../../tests/project-footprints.test.ts) は実APIとD1/R2、Workflowハーネスで、本人以外と別オリジンの拒否、同一世代の同時要求と遅れた再送、対象期間、設定オフと削除の競合、生成失敗後の再試行を照合する。AI応答はテスト用に固定する。

## 前提と限界

- D1 batchのSQL順序/原子性、`changes()`、外部キー、固定したDBスキーマを前提とする。owner IDの再利用やprojectの所有者付替えは現行経路にない。`belongsToUser` はproject事前照会と保存SQLのuser対応を表し、DB中の既存memoryがownerに対応する到達可能な状態だけを扱う。
- `commitMemory` はmemoryと根拠の確定だけを表す。`versionStatement` は保存済みmemoriesと同revisionなら履歴メタデータを追加できる。既存の未履歴化memoryを保全する処理もあるため、stale保存で「全履歴が常に不変」とは証明しない。新規テストは保存済み第0版がある具体状態で第1版が一覧へ公開されないことを確認する。
- R2 PUTはD1確定より先で、古い世代のオブジェクトが残り得る。新規テストでもR2オブジェクトと未解決intentの存在を確認する。現在ownerが残る間、そのような未参照オブジェクトを即時回収する保証はない。owner削除後の回収はB10で扱う。
- dispatcherの生存user/onboarding確認はclaim確定時だけ。後から失効した認証、実行中の全非同期処理、AIキャッシュ、記事/問い/プ譜の全保存箇所は対象外。記事要約からの問い登録を扱い、問い本文・プ譜の確定はモデルに含めない。
- 外部通信/実AIは使わない。実Miniflare D1/R2と既存Workflow harnessを使い、競合タイミングをR2 bindingまたはWorkflow statusの一箇所で制御する。Cloudflare本番Workflow実行・並列スケジューラ全体の線形化は未検証。
