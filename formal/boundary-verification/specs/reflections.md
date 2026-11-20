# B16 振り返りの受付と結果確定

[Reflections.lean](../BoundaryVerification/Reflections.lean) は[B01の認証判定](auth.md)を使う。振り返りのパスは、MCPとショートカット用トークンの許可表に含まれない `.other` で表す。

- 一覧・作成・更新は本人のWebセッションを確認し、D1で所属プロジェクトの所有者を照合する。変更要求は認証時にOriginを確認する。公開プロジェクトの一覧や個別ページは振り返りのテーブルを読まない。[API処理](../../../server/api/routes/reflections.ts) [公開処理](../../../server/features/public-projects/public-projects.ts)
- 手動生成は本人とrequest IDから一意に決まるキーを用いる。同じ期間・プロジェクトで再送すると元の受付IDを返す。新しい受付や再生成の世代変更は、ジョブ登録・AI利用枠の予約と同じD1バッチで確定する。手動ジョブは起動前から同時処理枠に含める。枠を取れなければ、問い・回答・世代・ジョブ・予約を保つ。[API処理](../../../server/api/routes/reflections.ts) [利用枠のモデル](quota.md)
- Cronは自動追加がオンの登録済み利用者を対象に、週と未回答の有無、生成待ちの有無、対象ストックの件数を照合する。問いを生成できなかった場合、実際にストックを読んだ版か期間内のストックが変わったときに再検討する。週とプロジェクトごとの一意制約と、プロジェクトごとの生成待ちの一意制約をD1が適用する。[週次の受付](../../../server/features/questions/reflection-repository.ts) [制約](../../../migrations/0055_reflections.sql)
- 回答時に所有者・世代・問いの有無・回答済みと見送りの状態を確認する。Workflowは保存時にプロジェクトの所有者、生成世代、反映待ち、ジョブの実行状態を確認する。結果が参照したストックとプ譜の現存・所属は同じD1文で照合する。参照が変わった場合は以前の問いがあれば保持する。プロジェクト削除で振り返りを消し、D1のジョブを終了させ、保存済みAI応答を無効にする。[結果の確定](../../../server/features/questions/reflection-generation.ts) [削除時の処理](../../../migrations/0055_reflections.sql)

| 性質                         | モデルの定理                                                                                                                                  | 実装との照合                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 本人のセッションへ限定       | `foreign_read_denied`、`non_session_read_denied`、`rejection_reachable`                                                                       | 他人・未認証・別Originの拒否、公開プロジェクトからの分離                     |
| 受付の再送と利用枠の拒否     | `replay_keeps_job_and_reservation`、`quota_denial_keeps_request`                                                                              | 同じIDの再送、期間違いの409、枠不足の429と元の問いの保持                     |
| 週ごとの追加と未回答時の待機 | `existing_week_keeps_schedule`、`unanswered_blocks_schedule`、`fewer_than_three_cannot_schedule`                                              | 週をまたぐ3件、同時予約、見送り後の追加、要約完了後の再検討                  |
| 本人の回答と非同期の結果確定 | `stale_answer_denied`、`stale_commit_denied`、`deleted_project_denies_commit`、`moved_stock_preserves_previous_question`、`success_reachable` | 古い世代の回答、生成中のストック移動・プロジェクト削除、D1のキャッシュ無効化 |

照合は[API・Cron・Workflowテスト](../../../tests/reflections.test.ts)で行う。モデルは1つの要求キー、週、プロジェクトおよび現在の行を取り出し、日付、本文、参照IDを識別値で表す。SHA-256のキー衝突が現実に起こらないこと、D1の条件付き書込みとバッチが原子的であることを前提とする。認証完了後の資格失効や、送信済みAI処理の中断は範囲外。日本時間の境界、SQLの関係、画面とAPIは実装テストで扱う。AIが選ぶ内容の妥当性と実環境での配送・データ保持は別途確認する。

[変異検出](../mutations/reflections.json)では、所有者、利用枠、週と未回答の制約、最低件数、世代、根拠ストックの所属の各条件を取り外し、該当する定理が失敗することを確認する。
