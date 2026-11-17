# B13 Pushの登録・解除・配信

[Push.lean](../BoundaryVerification/Push.lean) はセッションに結び付く購読、所有者と20端末上限、ログアウト・期限、配信claim/lease/再送、送信直前の同意再確認を扱う。外部サービスへの厳密な一度だけの配送と、既に渡った通知の取消しは保証しない。

`Registration.principal` は [Auth.lean](../BoundaryVerification/Auth.lean) のセッション認証結果であり、owner・session・期限を別々の登録入力として受け取らない。`register` は `principal.userId/sessionHash/expiresAt` から購読を作る。`authenticated_registration_matches_session_row` は、提示Cookieハッシュ・JOINしたユーザー・認証時刻の検査を経たprincipalから、保存した購読のowner/sessionが認証元セッション行のowner/tokenHashと一致することを示す。認証成功とAPI認可は別であり、Origin・onboarding・PUT許可は既存の共通middleware（B01）を通過したという前提を維持する。`registrationValid` のsession種別・sessionHash存在・設定・endpoint・鍵のguardも保持する。

追加照合「bodyのowner・session指定を使わず、Cookieを照会した本人とセッションへ購読を結び付ける」は実HTTP入口からsessions JOIN usersを通し、body内の別人のuser_id/sessionHash/session_hashが保存先に影響しないことを確認する。同じAliceの別Cookieへ切り替えた更新では対応する別sessionHashへ変わり、BobのCookieで別endpointを登録すればBob自身のowner/sessionHashになる。principalの内部注入は用いない。

## 実装・定理・テストの対応

| 境界・実装                                                                                                                                                                          | モデル・定理                                                                                                                                                             | 実経路の照合                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [pushApp](../../../server/features/announcements/push.ts) と[共通API許可表](../../../server/api/middleware/authentication.ts)のsession限定、設定・endpoint・鍵検査、sessionHash必須 | `Registration` のguardを個別に保持。`registration_requires_session`、`invalid_registration_unchanged`、`register_binds_current_session`                                  | 既存 [push.test.ts](../../../tests/push.test.ts)「初期は管理者未設定、設定後は本人だけが購読・解除でき、ログアウトで削除する」「内部URL・リダイレクト先・無効な暗号鍵・クロスオリジン・匿名の登録を拒否する」                                          |
| 登録前の期限切れ購読削除とendpoint競合、`ON CONFLICT ... WHERE user_id=excluded.user_id`                                                                                            | `cleanExpired`、`ownsOrUnused`、`other_owner_registration_rejected`。上限判定はcleanup後件数を入力する                                                                   | 新規 [boundary-social-verification.test.ts](../../../tests/boundary-social-verification.test.ts)「期限切れセッションの購読を登録時に掃除し、新しい所有者のセッションへ結び付ける」。期限前の他owner競合は既存pushテスト                                |
| 件数20未満、または本人の同一endpoint更新だけを許可                                                                                                                                  | `deviceLimitAllows`、`new_device_limit_rejected`、`registration_business_unchanged`                                                                                      | 新規「20端末に達しても本人の既存購読は更新でき、新規端末の拒否は購読を変えない」。HTTP 409後の購読表を全行比較                                                                                                                                         |
| DELETEはendpointとownerで削除、statusはownerとsession期限、ログアウトはsession削除のCASCADE                                                                                         | `other_owner_unsubscribe_unchanged`、`logout_removes_bound_subscription`、`expiry_boundary_not_subscribed`                                                               | 既存pushテストの他owner解除・ログアウト・再ログイン削除。新規の登録時expiry cleanup照合                                                                                                                                                                |
| [deliverAnnouncements](../../../server/features/announcements/push-delivery.ts) の条件付きclaim、120秒lease、期限切れ復帰、最大5回の状態遷移                                        | `claim_increments_once`、`claim_preserves_bound`、`recover_preserves_bound`、`finish_preserves_bound`、`exhausted_retry_fails`、`expired_fifth_lease_fails`              | 既存 [push-delivery.test.ts](../../../tests/push-delivery.test.ts)「暗号化したWeb Pushを送信し、Cron重複実行・本文訂正でも同じIDを再送しない」「例外でも5回で再試行を終了する」。新規「5回目の送信leaseが期限切れなら失敗を確定し、6回目を送信しない」 |
| 完了UPDATEのlease一致条件                                                                                                                                                           | `stale_lease_cannot_complete`                                                                                                                                            | 新規「送信後にleaseが置き換わったとき、古い完了結果で新しい配信状態を上書きしない」。fetch stub内でDB leaseを置換し、古い完了後も新lease/attempts/statusを保持                                                                                         |
| 暗号化後の最終SQL: 購読存在・session期限・お知らせ存在・notify=1・notify_at一致・公開時刻                                                                                           | `Preflight`、`send_requires_current_consent`、`unsubscribe_before_preflight_rejects`、`expiry_before_preflight_rejects`、`notification_changed_before_preflight_rejects` | 新規パラメーター化テスト「暗号化後・送信直前の%sを再確認し、外部へ送信しない」が解除・logout・期限・非公開化・通知停止・notify_at変更の6ケースを実暗号化後に挿入し、fetch 0回を確認                                                                    |

`reachable_register_logout_and_denial` と `reachable_delivery_success_and_denial` は正常登録・削除、owner拒否、201成功、5回目の503終了、同意あり/なしを具体値で到達させる。`reachable_authenticated_registration` は認証時刻10・登録時刻20を区別し、認証元行と同じowner/sessionでの登録成功と非session拒否を到達させる。

## 判定時点と保護する状態

認証は共通middlewareのセッション照会時刻 `authTime` に行い、登録に使うsessionHashはその認証結果に由来する。登録時刻 `registrationTime` は既存購読のcleanupにだけ使い、登録前に認証を再照会する規則は加えない。したがって認証後にセッションが失効・削除された登録要求の原子的取消しは保証しない。`Subscription.expiresAt` は結合されたセッション行の期限を投影した値であり、実装が購読表に期限を複製しているという意味ではない。期限ちょうどは有効としない。

登録拒否では、期限前の他owner購読を更新せず、業務revisionも変更しない。ただし、正しい入力を受けた登録処理は、競合・上限による409より先に期限切れの購読を掃除する。このため「409なら全DB不変」は主張しない。上限拒否テストの表全体不変は、事前に期限切れ購読がないケースに限定する。解除・logoutで購読が消えると紐付いた配信台帳もCASCADE削除される。

配信開始はdue pending行に対する条件付きUPDATEでclaimし、同じ未失効claimを並行要求が重ねて取れない。`bounded` は初期pending/attempts=0からclaim・finish・recoverで保たれる不変条件である。SQL claim自体には `attempts<5` の条件がないため、任意の壊れたpending/attempts=5以上まで安全だとは仮定しない。404/410時の購読削除とpayload作成の暗号処理は状態機械の中心から分離して既存テストで照合する。

送信可否の最後の判定は、署名・暗号化を終えた後、fetch直前のSQL照会で行う。解除・logout・期限・通知条件変更をその時点で観測すれば送信しない。解除/logoutは台帳も削除する。通知条件変更や期限による最終拒否では、確保済みの行がsendingのまま残り、後のlease回復・期限cleanupの対象になる。即座にpending/failedへ戻るという性質は主張しない。

## 前提と限界

- 時刻は比較可能な自然数のtick、件数はcleanup後のDB件数として抽象化する。ISO時刻文字列の整形式、DBトランザクション・制約・CASCADE、SQLとLeanの自動的同値性は前提と照合テストに分ける。
- モデルの上限・ownerは一つのendpointの遷移であり、全ユーザーの並行登録件数について独立の直列化可能性を証明しない。D1の実際のSQL条件をMiniflareで照合する。
- 最終SQLは現行leaseを確認しない。lease一致による保護は完了UPDATEに適用され、失効leaseの遅延した処理の外部送信を排除しない。通信成功後に完了保存が失敗した場合、回復後に再送され得る。notification tagの同一性は外部サービスやOSによる厳密な一度だけの受信を意味しない。
- 最終SQL照会の後に起きた解除・logout・非公開化をfetch前に必ず止める原子性はない。既に外部Pushサービスへ渡った通知の回収も対象外である。
- `allowedPushEndpoint`、VAPID署名、ECDH/暗号化、ブラウザー購読、Pushサービスの配送の正しさはLeanの証明対象外。設定・endpoint・キーが通ったことをguardとして扱い、ライブラリと既存テストで照合する。
- HTTP入口は既存Hono、DBはMiniflare D1、署名・暗号化は実WebCryptoを使用する。新規テストの暗号化hookは処理途中に正規のHTTP解除/logoutやDB時刻・通知変更を挿入する目的に限定し、外部fetchは常にstubとする。本番データ・本番配信は使わない。

## 変異と実行

[変異定義](../mutations/push.json) はowner、完了lease、5回上限、購読同意、notify_at一致、20端末上限に加え、保存owner・sessionを認証principal以外の値へ置換する8変異を持つ。指定した安全性定理の証明失敗で検出する。

```sh
cd formal/boundary-verification
PATH=/home/agent/.elan/bin:$PATH lake env lean BoundaryVerification/Push.lean
```

新規TS照合はリポジトリルートで `pnpm exec vitest run tests/boundary-social-verification.test.ts --maxWorkers=1` を実行する。通常の配信・再送・秘密を含めないエラーログは `tests/push.test.ts` / `tests/push-delivery.test.ts` の既存テストも継続して保護する。
