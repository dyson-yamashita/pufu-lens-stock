# B02 ショートカットトークンと保存

対象モデルは [Shortcut.lean](../Verification/Shortcut.lean)。製品コードの仕様は変更しない。

## 実装から確認した境界

- [tokens API](../../../server/api/routes/tokens.ts)は本人セッションで発行・失効し、保存先指定時は`ownedProject`で所有者を確認する。無期限は`expires_at=NULL`。ハッシュのみをDB保存し、平文の再表示をしない。
- [authenticate](../../../server/features/auth/auth.ts)のDB照会はusersとのJOIN、`revoked_at IS NULL`、`expires_at IS NULL OR expires_at > now`を同時に要求する。期限ちょうどは拒否。有効なトークンでも後続拒否時に`last_used_at`が変わり得る。
- [project-access](../../../server/features/projects/project-access.ts)はトークン単一保存先と要求先の一致を確認し、指定省略時に単一保存先を補う。[stock-collection](../../../server/api/routes/stock-collection.ts)は指定された保存先を本人所有で照会する。全プロジェクト許可かつ指定省略なら、一覧表示フラグによらず本人の全プロジェクトへ保存する。保存先が存在しない場合は拒否。
- `Idempotency-Key`は任意。指定時だけ、ユーザーとキーで記録を探し、request_hash一致・stock_id存続なら元のIDを返す。異なる内容・削除済み結果は409。キーなしの同内容再保存にもcanonical article/stockの重複回避があるが、新しい本人プロジェクトがあれば関連を追加できる。

## モデルと保護状態

登録・所有ユーザー存在・失効・期限を別のguardにする。論理時刻はNatで表し、無期限はOption.none、期限付きは厳密な`now < deadline`とする。

`destinations`は、保存先制限→本人所有フィルター→明示先または省略時の全件/単一先→空集合拒否の順で解決する。`Business`はowner/project/payloadの保存関連、owner/payloadの記事識別、owner/key/fingerprint/結果存続の受付記録。`State.usage`は利用記録を別に持つ。`step`は認証拒否、保存先拒否、再送、内容競合、新規保存へ具体的に分岐する。新規保存は存在しない関連と記事を追加し、キーがある場合だけ受付記録を追加する。

payloadは正規化記事識別、fingerprintは解決済み保存先・canonical入力・メモ・補足文を含むrequest_hashの抽象値である。値の等しさが対象内容の等しさを表すことは前提とし、ハッシュ衝突耐性を証明しない。

## 定理と照合

| 性質・具体定理                                                                                                                                                     | 実装・照合テスト                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 期限ちょうど・失効: `expiry_equality_rejected`, `revoked_rejected`, `auth_denial_preserves_all`, `revoked_denial_example`                                          | 追加[boundary-auth-verification.test.ts](../../../tests/boundary-auth-verification.test.ts)「B02 期限ちょうど・失効は保存を拒否し、期限直前と無期限は認証できる」。Dateのみ固定し、HTTP→実D1で期限一致拒否、1ms前許可、失効拒否、Cookieへの非フォールバックと業務DB不変を確認 |
| 保存先/所有者拒否: `different_bound_rejected`, `foreign_owner_rejected`, `target_denial_preserves_business`                                                        | `resolveProjectId`/`ownedProject`。既存[tokens.test.ts](../../../tests/tokens.test.ts)「無期限トークンで保存でき、プロジェクト制限と手動失効も有効」、追加B02全projectテストの他人project拒否・DB比較                                                                         |
| 省略時の全件と単一先: `unrestricted_omission_selects_all_owned`, `unrestricted_destination_owned`, `all_project_success_example`, `bound_omission_success_example` | 追加「B02 全project省略保存のキー再送は新projectに書かず、キーなし再送は保存する」。本人2件だけに保存し、他人へ保存しない                                                                                                                                                     |
| キーあり再送・内容競合・削除済み: `replay_preserves_business_example`, `changed_payload_conflicts_example`, `deleted_receipt_conflicts_example`                    | 上記追加テストは再送ID一致とDB不変、異なるpayloadの409を確認。既存[api.test.ts](../../../tests/api.test.ts)のキー再送・同時競合・削除後再送、[text-stocks.test.ts](../../../tests/text-stocks.test.ts)「同じテキストの再送・別プロジェクト保存・別ユーザー保存を扱う」        |
| 任意キーと新しいproject: `replay_does_not_add_new_project_example`, `absent_key_can_add_new_project_example`                                                       | 上記追加テストは新project作成後、キーあり再送では関連を追加せず、キーなしでは3件目の関連を追加する。記事1件・受付記録1件を維持                                                                                                                                                |

4変異は期限・project所有者・トークン保存先・再送内容一致のguardを外す。[shortcut.json](../mutations/shortcut.json)の対象定理が証明失敗することを検査する。

## 判定時点・未検証範囲

失効・期限・ユーザー存在はauthenticateの照会時、保存先所有者は保存前の`ownedProject`/本人全件照会時に判定する。照会後の失効や所有者変更と保存確定の競合、実行中要求の取消しは保証しない。D1.batchの原子性、制約・トリガー、ISO日時比較とNat時刻の対応、canonical化、暗号、画像/URL取込み、ジョブ実行/R2/AIはモデルの外。

Leanの拒否不変性はBusinessの3集合について。メモリrevision、処理ジョブ、記事本文、履歴などの全製品状態を自動的に含むとはしない。追加照合ではarticles/stocks/projects/processing_jobs/idempotency_keys/users.memory_revisionを比較する。正常時の派生revision/履歴/ジョブの細部は既存テストと別モデルの対象。YouTube再送では既存記事のfailed更新があり得るため、一般の「全再送で全DB不変」とは主張しない。本モデルの再送不変性は保存関連・記事識別・受付記録に限る。並行要求は逐次モデルに含めず、既存のD1同時キー競合テストを代替照合とする。
