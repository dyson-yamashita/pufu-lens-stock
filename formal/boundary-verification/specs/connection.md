# B03 MCP接続設定・失効・refresh

対象モデルは [Connection.lean](../BoundaryVerification/Connection.lean)。製品コードの仕様は変更しない。

## 実装から確認した境界

- [oauth.ts](../../../server/mcp/oauth.ts)の接続管理入口は本人セッション・onboarding・変更時のOrigin確認を要求し、本人のgrant一覧から対象を解決する。PATCHはscopeを元grantの部分集合に制限する。projectは本人所有のものを選び直せる。初回認可projectからの拡張禁止という制約はない。`null`は今後作成するものも含む全件、空配列の登録は400。
- [handleMcp](../../../server/mcp/server.ts)はprops形式、OAuth認証、現在のユーザー存在/onboarding、unwrapToken結果とユーザー一致を確認する。[getMcpConnectionSettings](../../../server/mcp/connection-settings.ts)はuser/grant双方をキーに照会する。失効tombstoneなら401。scopeは認証scopeと最新設定の積集合。projectは最新設定を優先し、現在本人が所有するprojectだけに絞る。制限付き集合が空なら403とし、全件へ戻さない。
- [tool-context.run](../../../server/mcp/tool-context.ts)がツール別scopeを確認し、不足時は実API処理を呼ばず403を返す。API許可表や各所有者検査も別途適用される。
- DELETEはDBにrevokedのtombstoneと空scopeを書いてからproviderのgrantを失効する。PATCHのUPSERTは既存tombstoneを復活させない。OAuthの`tokenExchangeCallback`も最新設定のrevokedを読み、refreshでoffline_access取消済みなら拒否する。新たなrefresh tokenのTTLは元scopeと最新設定の双方にoffline_accessがあるときだけ30日、それ以外は0。

## モデルと状態遷移

`Grant`はownerと各入口へ渡るscope/project上限を表す。アクセス解決のscopesはprovider検証済みの`ctx.auth.scope`、管理では元`grant.scope`、refreshではcallbackの`scope`を同じ型でパラメータ化する。元grantからtoken scopeを導くOAuth内部の処理は証明対象にせず、token scopeが元認可以下であることはprovider検証の前提。`lookup`はowner/grantの二重キー。`Request`のprovider検証・ユーザー存在・同意・propsOwner一致を別のguardにする。`resolve`は現在のSettingsからAccessを構築し、最新scopeとの積集合と現在のproject所有者を適用する。`none`の全件と`some []`の空集合を区別する。Scopeの各constructorはshared/mcp.tsの8権限に対応する（`memoryRead`は`memories:read`、`offline`は`offline_access`）。

`State`は設定行、refresh受付数、抽象業務版。`edit`はセッション/認証/Origin/同意/owner、tombstone、元scope部分集合、本人project集合を確認して設定を書き換える。`revoke`はtombstoneを残す。`refresh`は有効なprovider要求・現在の失効・offline_accessを確認し、許可時だけ受付数を増やす。`tool`は必要scopeがある場合だけ抽象業務版を更新する。refreshは設定と業務版を変えない。

## 定理と照合

| 性質・具体定理                                                                                                                                                  | 実装・照合テスト                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 元scopeと最新scopeの積集合: `scopes_never_exceed_original`, `latest_scope_required`, `ungranted_scope_removed_example`                                          | handleMcpのscope.filter。追加[boundary-auth-verification.test.ts](../../../tests/boundary-auth-verification.test.ts)「B03 初回単一projectから本人の別projectと全projectへ既存トークンの設定を変更できる」はDBに元scope外のstocks:writeを混ぜても実OAuth→add_stockが403で業務DBを維持することを確認 |
| owner一致と二重キー: `wrong_owner_rejected`, `foreign_settings_ignored_example`, `foreign_project_rejected_example`                                             | user_id/grant_id照会と本人project SQL。既存[mcp-connection-settings.test.ts](../../../tests/mcp-connection-settings.test.ts)「他人・CSRF・不正な入力・未認可の権限追加を拒否し設定を維持する」                                                                                                     |
| 最新project、初回範囲から拡張可能: `initial_success_example`, `project_change_beyond_initial_grant_example`, `all_projects_setting_example`                     | 上記追加B03テストは初回alice-project→alice-second→nullへ変更し、同じ発行済みaccess tokenが現在の本人2件だけを返す                                                                                                                                                                                  |
| 空集合は全件ではない: `empty_is_not_all_example`                                                                                                                | 上記追加B03テストはDBに空集合を直接置き、実MCP入口の403を確認。登録自体の400と削除後projectの403は既存connection-settingsテスト                                                                                                                                                                    |
| 失効でaccess/refresh拒否: `revoked_access_rejected`, `revoked_refresh_rejected`, `revoked_denial_example`                                                       | 追加「B03 tombstoneは発行済みaccess・refreshと設定の復活を拒否する」。OAuth側grantを残してDBのtombstoneだけを置き、旧access 401・refresh invalid_grantを実入口で確認                                                                                                                               |
| 復活禁止・管理拒否: `revoked_settings_cannot_revive`, `management_denial_preserves_all`                                                                         | 上記追加テストはtombstone後PATCH 404とrevoked/scopes維持を確認。DELETE実経路・他人・CSRFは既存connection-settingsテスト                                                                                                                                                                            |
| refresh正常とoffline取消: `refresh_success_example`, `offline_removal_blocks_refresh_example`, `offline_removal_zero_ttl_example`, `refresh_preserves_business` | 既存connection-settings「保存した名前・対象・権限を一覧と既存/更新トークンに適用する」は正常refresh→現在設定反映→offline取消後invalid_scopeを確認                                                                                                                                                  |
| 必要scope不足は業務不変: `missing_scope_preserves_business`                                                                                                     | 上記追加B03テストのadd_stock拒否とarticles/stocks/projects/jobs/キー/users.memory_revision比較、既存[mcp.test.ts](../../../tests/mcp.test.ts)のscope拒否                                                                                                                                           |

5変異は最新scopeの積集合・失効access・project所有者・offline refresh・tombstone更新防止を個別に外す。[connection.json](../mutations/connection.json)の対応定理で証明失敗を確認する。

## 判定時点・未検証の前提

設定はhandleMcpのunwrapToken後のDB照会時、refreshはtokenExchangeCallbackの照会時に判定する。既存の「認証済みリクエストと解除が競合しても元の権限に戻さない」テストはunwrapTokenと設定読込の間の競合を確認する。設定読込後に始まった失効/変更による実行中ツール取消し、最後の所有者照会と保存の競合はモデル・追加テストの対象外。

providerVerified/providerValidはOAuthライブラリによる署名・暗号・grant/client/resource/token期限検証を抽象化した前提。そのライブラリ、KV/D1間の原子性、ネットワーク、props/JSONのパーサー、SQLとの同値性は証明しない。正常なrefreshの有効期間の延長一般を禁止するモデルではない。証明するのは失効/取消後の新しいrefresh拒否とrefresh発行TTL=0であり、認可済み実行中要求の取消しや発行済みtokenの回収ではない。管理APIの入力長/重複除去、旧project_id列からの互換解決・移行は既存テストへ委ねる。全件AccessはownerのSQL絞り込みを利用する前提で、全データの読み取り非漏洩はB05で扱う。
