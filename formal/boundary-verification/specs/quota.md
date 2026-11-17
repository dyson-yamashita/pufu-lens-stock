# B11 利用枠・AI試行の予約と計測

検証日: 2026-11-17。対象は [usage.ts](../../../server/features/usage/usage.ts) の `reserveOperation` / `admitJob` / `aiStep` / `invokeAi`、[ai-access.ts](../../../server/infrastructure/ai/ai-access.ts) の最新登録確認、[ai-neurons.ts](../../../server/infrastructure/ai/ai-neurons.ts) の `meteredOperation` / `saveAiUsage`。モデルは [Quota.lean](../BoundaryVerification/Quota.lean)、変異は [quota.json](../mutations/quota.json)。

## 判定時点・カウンター・保護する状態

操作予約、各AIステップの試行予約、実行直前の登録確認、実行後の計測保存を別の時点として扱う。保護する状態は操作件数、試行件数、running呼出数、選択したcallの状態・再試行フラグ・最新試行の計測有無、および予約処理が触らない業務revision。モデルは全DB不変を主張しない。

時刻は同一形式のISO日時を比較した結果と同じ順序になる整数として抽象化する。操作の窓は `user_id=? AND kind=? AND created_at>windowStart()`、呼出の窓は `user_id=? AND created_at>windowStart()`。開始点は `Date.now()-86400000` で、ちょうど24時間前の行は含まず、SQLには未来の行を除く上限条件がない。`UsageRow` / `counted` は操作履歴のowner/category/strictな時刻条件を明示する。`State.attempts` は同じowner・同じstrict窓の `ai_attempts` の集計値（category条件なし）を前提とする。

利用枠の設定は実装の `limits` が正の安全整数の設定値を採用し、不正なら既定値へ戻した後の値。`Kind.memory` は `user_memory` / `project_memory` の共通カテゴリを表す。stock保存の200件trigger、検索埋め込みやマニュアル検索固有の予約SQLは、このモデルに同じであると仮定しない。

## 明示したガードと遷移

1. **操作予約**: 最新のuser登録完了、callerの追加SQL guard、日次カテゴリ操作枠、同時job枠、日次AI試行枠、running呼出枠を全て満たすと `ai_operations` をINSERTする。同じidは `INSERT OR IGNORE` で件数を増やさない。並行枠のSQLはoperationsとjobsのjoinで、done/failedを除き、questionかつpendingも除く。古い操作でもjoin先がactiveなら同時枠に数える。`Context.activeJobsAtReservation` がその集計値。
2. **admitJob**: 操作予約を試みた後、既存operationとそのownerの最新登録を照会する。既存の非question操作は、日次操作枠が既に満杯でも再利用できる。questionだけは自身のjobを除いたactive件数を再照会するため、モデルも `otherActiveJobsAtAdmission` を別に持つ。cleanupはAIを実行しない別経路なのでモデル外。
3. **試行予約**: doneなら保存結果を再利用し、AIや試行INSERTを繰り返さない。新規call、またはfailedでattempts<10かつretry_blocked=0のcallだけが予約候補となる。日次試行数とrunning数の両方が上限未満の場合にcallをrunningへ条件付きINSERT/UPDATEし、同じatomic DB batchの `changes()=1` に連動して `ai_attempts` を1行追加する。`reserveCall` はこの選択callとowner集計値を更新する。runningやdoneの二重予約は成功しない。
4. **実行直前**: `meteredOperation` は予約後に `requireRegisteredAiUser(job.user_id)` を再実行する。ここで登録が失われればAI callbackを呼ばず、既にできたattemptは残り、aiStepのcatchがcallをfailedにする。meterを開始する前なので `usage_model` はNULLのまま。実行開始後に登録を失っても、進行中のAI要求を取り消す仕組みはこの境界にない。
5. **完了・失敗**: callback成功はdone、callback失敗はfailedとし、両方とも既存attemptを消さない。meterを開始したcallbackはfinallyで保存を試み、計測の保存失敗はAI再発行理由にしない。`invokeAi` の成否不明の通信失敗は `AiInvocationError` となりretry_blocked=1で自動再試行を止める。通常のcallback/出力検証失敗は再試行でき、その都度新しいattemptを数える。`finishCall` の `meterSaved` は永続化成功を表し、usage_completeの真偽とは別。
6. **計測保存**: `saveAiUsage` は選択attemptのidとownerが一致し、usage_modelがNULLの場合だけ一度保存する。`MeterRow.recorded` はこのNULL条件を表す。空文字列のmodelでも一度保存すれば再更新しない。モデルのmicrosは保存値を抽象化し、料金表やtoken数の妥当性は既存テストに委ねる。

失敗・拒否の区別: `reserveOperation` / `reserveCall` の拒否遷移は、そのstatementが扱うモデル状態を変更しない。メモリAPIのquota_assertions失敗はDB batch全体をrollbackする。一方、予約に成功した後の登録失効・callback失敗ではattemptやcall状態・利用集計が変化する。callback開始後の業務データ変更、deferral、job dispatch、cleanupはモデル外であり、`businessRevision` の不変性は予約処理だけに限定する。

## コード・定理・照合テストの対応

新規テストは [boundary-network-quota-verification.test.ts](../../../tests/boundary-network-quota-verification.test.ts)。既存の [usage-limits.test.ts](../../../tests/usage-limits.test.ts)、[ai-neurons.test.ts](../../../tests/ai-neurons.test.ts)、[ai-neurons-runtime.test.ts](../../../tests/ai-neurons-runtime.test.ts) の実DB・Workflow・Workers runtimeテストを補完する。

| 実装・性質                                 | Lean定理                                                                                                                                                                 | テスト名・観点                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| owner/category/strict窓の操作集計          | `window_boundary_excluded`, `another_owner_excluded`                                                                                                                     | 新規「操作枠の24時間境界ちょうど・別owner・別categoryの履歴を数えない」（HTTP API→D1予約/rollback、拒否時revision/request/job件数も維持）                                                 |
| 呼出のstrict窓と拒否時attempt維持          | `new_call_respects_limits`, `accepted_call_records_attempt`, `reserved_call_within_limits`, `rejected_call_preserves_state`（集計値のowner/window条件は前提）            | 新規「呼出枠も24時間境界ちょうどと別ownerを除外し、拒否では試行を追加しない」（stock POST→実job→aiStep→D1→AI stub）                                                                       |
| question pendingの同時枠例外・操作guard    | `pending_question_is_not_active`, `new_operation_needs_registration`, `new_operation_respects_limit`, `new_operation_records_once`, `rejected_operation_preserves_state` | 既存usage-limits「プロジェクトのメモリ再生成は1件分の実行枠で受け付ける」、並行プ譜・メモリ受付；新規操作窓/rollback                                                                      |
| 再送・running競合・done結果再利用          | `operation_replay_does_not_recount`, `running_call_cannot_be_reserved_twice`, `completed_result_reuse_does_not_reserve`, `reservation_preserves_business_revision`       | 既存usage-limits「AI呼び出しの並行上限・日次上限・結果再利用をユーザーごとに強制する」「メモリ再生成も永続枠を消費し、同じrequest_idは再利用する」                                        |
| 予約後の最新登録確認・計測開始前拒否       | `invocation_requires_current_registration`, `lost_registration_does_not_create_meter`, `registration_loss_after_reservation_reachable`                                   | 新規「予約直後の登録失効ではAIを呼ばず、予約済み試行とfailed記録を残す」（call予約後にD1の登録を失効させ、callback/AI未実行・failed行・未計測attempt・記事状態を確認）                    |
| 失敗でも試行を保持、成否不明を再発行しない | `failure_keeps_attempt_charge`, `unknown_invocation_blocks_retry`                                                                                                        | 既存usage-limits「同じAIステップの失敗再試行も課金枠に記録し、10回で停止する」「応答喪失による成否不明のAI呼び出しを自動で再発行しない」；既存ai-neuronsの未計測・計測保存失敗            |
| 計測ownerとwrite-once                      | `wrong_owner_cannot_save_meter`, `recorded_meter_is_write_once`                                                                                                          | 新規「他ownerの使用量保存では既存試行と利用集計を変更しない」（実call失敗後のattempt/ai_usage_daily維持）；既存ai-neurons「再保存は重複計上せず、退会後の遅延応答でも集計を復活させない」 |
| 正常と拒否の到達可能性                     | `reservation_and_call_success_reachable`, `rejected_operation_reachable`, `registration_loss_after_reservation_reachable`                                                | 新規操作窓・呼出窓・予約後登録失効、既存成功/失敗/再試行                                                                                                                                  |

変異4件は操作日次枠の削除、試行日次枠の削除、成否不明のretry_blocked削除、計測保存のowner条件削除。各指定定理の証明箇所で失敗することを共通runnerで確認する。

## 前提と未検証

- D1の条件付きSQL・同一batchがatomicに直列化され、集計・INSERT/UPDATE・`changes()`の意味がSQLite仕様に従うことが前提。並行要求は既存Miniflareテストで照合するが、LeanでSQL engineや分散DBの実装を証明しない。
- jobはDB由来で、operation id/job id/owner、`${job.id}:${name}` のcall idが一貫することを前提とする。admitJobの既存operation検索はidで行い、callのON CONFLICT UPDATEもidをキーとし、任意の外部入力に対する追加owner認可をこのモデルへ創作しない。ownerを含むid生成と呼出側認可は別の境界。
- 操作件数、attempt件数、running数、2種類のjob件数は、それぞれ上記の実SQLが算出する値。時刻照会間のずれ、未来日時の作成、履歴削除、cleanupとの競合を通じた連続した全DB不変条件は証明していない。
- `finishCall` は予約済みcallbackが完了する局所遷移。cleanupによるcall削除/世代変更、AI callback自身による業務保存、pufu/user_memoryのresult_json保存guard、Workflow durable stepの永続化・再配送は別対象。全AI機能が必ずこのaiStepを通るとは主張しない。
- 登録確認から実AI呼出しまでの間の失効をatomicに防いだり、実行中要求を取り消したりはしない。予約後失効テストのProxyは登録を変える時点だけを挿入し、予約SQL/DB操作・再確認・catchは実コードで動かす。
- AI応答のtoken検証、モデル料金表、safe integer overflow、AsyncLocalStorageの並行隔離、ai_usage_daily trigger、メーター保存障害の扱いは既存テストで確認し、Leanでは料金計算や通信先課金の正確さを証明しない。
- すべてのAI呼出しはstub。本番AI・本番データを使わない。HTTP APIやWorkflow入口からD1/R2までの照合は実装の一部経路の検査であり、抽象モデルとの同値性証明ではない。
