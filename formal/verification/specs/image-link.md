# B07 秘密のプ譜画像リンク

対象モデルは `Verification.ImageLink`。公開プロジェクトとは独立した期限付きbearer権限の、pending記録・R2保存・ready化と、匿名GET/HEADの二度の状態照会を扱う。

## 実装・証明・照合テストの対応

実装は `server/features/pufu/images/pufu-image-links.ts` の `issuePufuImageLink`、`currentPufu`、`usableLink`、`readPufuImageLink`。実HTTP入口は `server/api/routes/public-endpoints.ts` の `/api/pufu-images/:token`。

| 実装条件・遷移                                                                                    | Lean定義・定理                                                                                                                                     | 実装との照合                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 発行INSERTは本人所有者、許可project、完成済みプ譜、phase/revision、問い関連、50件未満を条件とする | `issueAllowed`, `reserve` / `reservation_requires_owner`, `reservation_requires_scope`, `reservation_requires_capacity`, `issue_denied_unchanged`  | 既存 `pufu-image-links.test.ts` の「リンク発行はユーザーあたり50件までとし、並行リクエストでも超えない」、`mcp-pufu-viewer.test.ts` の「権限・紐づき・生成状態を再確認する %s/%s」 |
| 初回INSERTはpending (`ready=0`)、R2 put後にcurrentPufuを条件としてready化する                     | `reservation_pending`, `publishPending`, `pending_publish_requires_current`, `pending_publish_requires_storage`, `publish_preserves_business_data` | 既存「保存失敗はBase64へ戻せる案内を返し、pendingを公開しない」「退会中に遅れて保存したPNGも削除し、リンクを発行しない」                                                           |
| トークン形式、ハッシュ一致行、ready、厳密な `expires_at > now`                                    | `readable` / `readable_requires_presence_and_token`, `readable_requires_ready`, `readable_requires_unexpired`, `expiry_inclusive_refusal`          | 既存「無効・推測したトークンや期限切れはR2を読まず404にし、期限後に画像を削除する」、新規「pendingはGET/HEADのR2照会前に拒否し、保存内容を変更しない」                             |
| currentPufuはプ譜存在・ID、プ譜owner、project owner、project、readyを個別に照合する               | `currentMatches` / `readable_requires_current_pufu`, `readable_requires_owner`, `readable_requires_project`, `readable_requires_pufu_ready`        | 新規「リンク所有者不一致/リンク保存先不一致/プ譜未完成はGET/HEADのR2照会前に拒否し、保存内容を変更しない」                                                                         |
| 現在phase・revision、question_idがある場合の問い関連                                              | `readable_requires_phase`, `readable_requires_revision`, `readable_requires_relation`                                                              | 既存「update/phase/delete/move/account後のURLは使えない」                                                                                                                          |
| R2 get/head前の照会と、完了後の同じusableLinkの再照会                                             | `read` / `served_requires_initial_check`, `served_requires_final_check`, `late_invalidation_denied`                                                | 既存「R2読み取り中に更新された画像は返さず、R2障害は秘密を含まない503にする」、新規「R2のGET/HEAD照会後に期限切れとなったリンクは応答しない」                                      |
| 匿名取得はDB/R2の読み取りのみ                                                                     | `read_preserves_state`                                                                                                                             | 新規pending/owner/project/status拒否テストでリンク行・プ譜行と保存済みR2内容が不変                                                                                                 |
| usableLink/currentPufuに `is_public` 条件はない                                                   | `publicity_independent`                                                                                                                            | 新規「秘密画像リンクは匿名公開と独立し、非公開化だけでは失効しない」                                                                                                               |
| 成功と拒否の到達可能性                                                                            | `success_reachable`, `refusal_reachable`                                                                                                           | 新規独立性・拒否テスト、既存の匿名PNG正常取得                                                                                                                                      |

新規テストファイルは `tests/boundary-public-verification.test.ts`。既存 `testApp` のRequest/Response入口からルート、Miniflare D1・R2までを通す。描画・発行の重複を避けるため、匿名取得テストでは実スキーマにリンク行と最小のR2内容を用意する。PNG描画や発行の完全経路は既存pufu-image-links/MCPテストを再利用する。R2後の競合は実R2操作を完了した直後にDBで期限を変更し、後続の状態再照会を通す。

## 判定時点と保護状態

発行はINSERT時に現在の所有者・project・phase/revision・完成状態・問い関連・scopeと件数を判定する。pending行を先に残すため、R2保存に失敗しても掃除対象を失わない。ready化UPDATEでも期限とcurrentPufuを再評価する。発行失敗後のR2削除・退会時の再掃除、上限/障害時の `assertImageCurrent` による古いBase64拒否は既存テストの確認範囲であり、本モデルの定理には含めない。

匿名取得は、トークン形式を検証した後にusableLinkでDB条件を評価し、R2 getまたはheadの完了後に再び同じDB条件を評価する。期限ちょうどを拒否する。`read` が成功すれば初回と最終の両snapshotが条件を満たす。最終snapshotが失効・削除・更新済みなら画像を返さない。

モデルの読取は最終snapshotを変更しない。第三者や並行更新が変えた状態を元へ戻すことを意味しない。ready化はリンクのreadyだけを変え、業務データ・履歴・利用記録は不変である。拒否されたreserveは新しいリンクを作らないが、実装で先に記録済みのpending行を消すという主張ではない。

## 抽象化と保証しない範囲

- `tokenValid` は形式検証とハッシュ一致、`scopeAllowed` は既存projectScopeJsonの包含判定を抽象化する。暗号の推測困難性、乱数の衝突確率、PNG描画、R2の内部実装、ISO日時比較と時計の正しさは証明しない。実装が発行する1時間の期限は数値境界へ抽象化し、1時間という定数自体は証明しない。
- `currentMatches` はcurrentPufu SQLが返す一致条件である。問い関連boolは対象question_idについてのEXISTSを表す。SQLエンジン全体や制約・トリガーをLeanで解釈してはいない。
- scopeは発行時に判定する。発行後の匿名取得には発行元セッションや接続の再認証を要求する仕様を追加しない。非公開化だけではこの期限付き権限は失効しない。
- R2前後の照会は同じtoken_hashの同じリンクを読む前提であり、製品経路が既存行のtoken_hash/content_key/metadataを別物へ再利用しないことを前提にする。取得後のオブジェクト内容の整合性やstream cancel成功は証明しない。
- 最後のDB照会より後の期限切れ、更新、削除、退会により、既に開始した応答を取り消す保証はない。初回照会からR2後照会までの全操作を単一の原子的トランザクションとみなしていない。
- モデルとTypeScript/SQLの同値性は証明していない。例外、503のログ秘匿、cleanupの完全性は既存実装テスト側に残る。

## 変異

`mutations/image-link.json` の3件は、ready条件、R2後の再照会、revision一致をそれぞれ除き、`readable_requires_ready`、`served_requires_final_check`、`readable_requires_revision` の証明を失敗させる。型や構文の不正による失敗は検出成功に数えない。
