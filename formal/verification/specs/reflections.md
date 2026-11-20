# B16 振り返りの周期設定・予約・結果確定

[Reflections.lean](../Verification/Reflections.lean) は[B01の認証判定](auth.md)を使う。振り返りと周期設定の更新は、MCPとショートカット用トークンの許可表に含まれない `.other` で表す。

- 本人のWebセッションには一覧と届いた問いへの操作を許可する。周期設定と振り返りの更新時にはOriginを確認し、保存文でも所属プロジェクトの所有者を照合する。公開プロジェクトは振り返りのテーブルを読まない。[周期設定](../../../server/api/routes/projects.ts) [振り返りAPI](../../../server/api/routes/reflections.ts) [公開処理](../../../server/features/public-projects/public-projects.ts)
- Cronは自動追加がオンの登録済み利用者を対象に、保存した周期に対応する日本時間の最新の締めを使う。すでに確認した締めより後で、未回答・生成待ちがなく、対象ストックが3件以上あると予約できる。問いを生成できなかった場合、ストックを読んだ版か期間内のストックが変わったときに次の締めで再検討する。プロジェクトと締めの一意制約、プロジェクトごとの生成待ちの一意制約をD1が適用する。[自動予約](../../../server/features/questions/reflection-repository.ts) [制約](../../../migrations/0055_reflections.sql)
- 届いた問いの再生成は世代の変更・ジョブ登録・AI利用枠の予約を同じD1バッチで確定する。利用枠は起動待ちから数える。古い世代や枠の不足で拒否した場合は、問い・回答・世代・ジョブ・予約を保つ。[振り返りAPI](../../../server/api/routes/reflections.ts) [利用枠のモデル](quota.md)
- 自動生成は資料を読む時点で自動追加がオフ、または予約の締めが保存済みの周期と合わない場合に取り消す。回答は所有者・世代・問いの有無・回答と見送りの状態を確認する。Workflowは結果の保存時に所有者、世代、生成待ち、ジョブの実行状態を確認する。結果が参照したストックとプ譜の現存・所属は同じD1文で照合し、参照が変わった場合は以前の問いを保持する。プロジェクト削除で振り返りを消し、ジョブを終了させ、保存済みAI応答を無効にする。[結果の確定](../../../server/features/questions/reflection-generation.ts) [削除時の処理](../../../migrations/0055_reflections.sql)

| 性質                     | モデルの定理                                                                                                                                              | 実装との照合                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 本人による周期設定と閲覧 | `foreign_period_update_denied`、`foreign_read_denied`、`non_session_read_denied`、`rejection_reachable`                                                   | 設定の保存と保持、他人・未認証・別Originの拒否、公開プロジェクトからの分離                                         |
| 自動追加と締めの前進     | `closed_period_keeps_schedule`、`disabled_blocks_schedule`、`unanswered_blocks_schedule`、`fewer_than_three_cannot_schedule`、`mismatched_cutoff_cancels` | 毎週・隔週・毎月の締め、周期変更後の締めと生成前の取り消し、繰り越し、同時予約、見送り後の追加、資料更新後の再検討 |
| 届いた問いへの操作       | `stale_answer_denied`、`stale_regeneration_denied`、`quota_denial_preserves_regeneration`                                                                 | 古い世代の回答、枠不足の429と元の問いの保持、並行する再生成                                                        |
| 非同期の結果確定         | `stale_commit_denied`、`deleted_project_denies_commit`、`moved_stock_preserves_previous_question`、`success_reachable`                                    | 生成中のストック移動・プロジェクト削除、D1のキャッシュ無効化                                                       |

[周期設定のテスト](../../../tests/project-question-settings.test.ts)と[API・Cron・Workflowのテスト](../../../tests/reflections.test.ts)で照合する。モデルはプロジェクトと現在の行を取り出し、締めを順序付きの数値、未予約を0で表す。日本時間の締めの計算、周期の入力値、SQLと画面は実装テストで扱う。D1の条件付き書込みとバッチの原子性を前提とする。認証後の資格失効、送信済みAI処理の中断、実環境での配送、生成された問いの質は範囲外。

[変異検出](../mutations/reflections.json)では、所有者、利用枠、締め・無効設定・未回答・最低件数の条件、世代と根拠ストックの所属を取り外し、対応する定理の失敗を確認する。
