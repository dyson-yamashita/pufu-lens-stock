# B01 共通認証とAPI許可表

対象モデルは [Auth.lean](../Verification/Auth.lean)。製品コードの仕様は変更しない。

## 実装から確認した境界

- [authenticate](../../../server/features/auth/auth.ts) はAuthorizationがあればBearerを先に検証し、不正・未登録・失効・期限切れならCookieへ戻らず401にする。セッションはDBで所有ユーザーと期限を照会し、GET/HEAD/OPTIONS以外でOriginを確認する。
- [registerAuthentication](../../../server/api/middleware/authentication.ts) はonboarding、認証種別ごとのメソッド/パス許可表の順に確認する。セッションの未同意例外はGET/DELETE `/me`、POST `/onboarding`・`/logout`だけ。ショートカット用トークンの許可はGET `/projects`・POST `/stocks`だけ。
- MCPのAPI許可はGETのcomments/projects/memory（history・個別履歴含む）/stocks（個別・content・images含む）/pufus/questions（個別・pufu・局面・画像含む）、POSTのcomments/stocks/questions/pufusおよびstock images、PATCHの個別pufu。モデルの`memoryRead`・`stockRead`・`questionRead`はそれぞれこの正規表現のクラスを表す。`other`へ許可を広げない。
- MCPのREST呼出しは[tool-context](../../../server/mcp/tool-context.ts)がOAuth検証後のprincipalを`createApp`へ内部注入する。外部からのショートカットBearerは[mcp provider](../../../server/mcp/oauth.ts)の認証情報として受け入れられない。`mcpEntrance`はこの入口種別の分離を表す。
- `Method`は現行のGET/HEAD/OPTIONS/POST/PUT/PATCH/DELETEを含む。PUT `/integrations/x`と`/push/subscription`はRouteの`other`に分類し、セッション変更としてOrigin確認を要求する。token/MCPでは全RouteのPUTを拒否する。

## 状態・判定時点

`registered`と`live`は照会時の資格情報一致・存在・有効性を個別に抽象化する。`onboarded`・`sameOrigin`・認証種別・HTTP操作を別々に判定する。`State.business`は許可された変更操作の抽象版カウンタ、`usage`は有効トークンの利用日時更新予約の回数。個々の業務ハンドラーを再現するモデルではない。読み取りメソッドは業務版を変えない。

セッションの主体対応は別に `SessionRow`（owner・tokenHash・期限）と `SessionUser`（id・同意状態）で表す。`authenticateSession` は提示Cookieのハッシュ一致、`sessions.user_id = users.id` のJOIN一致、認証時刻 `authTime < expiresAt` を個別に確認し、欠けた行・不一致・期限切れを拒否する。成功時だけJOIN先ユーザーのID・同意状態と提示ハッシュ・照会した期限を `SessionPrincipal` に投影する。`authenticated_session_matches_row` は生成principalのuser/sessionが元セッション行のowner/tokenHashに一致することを証明し、B12/B13の保存定理から利用する。単に入力のuser/sessionを一つのrecordにまとめる前提ではない。

この関数は認証時のSQLスナップショットであり、API全体の認可成功を表さない。Origin・onboarding・認証種別の許可表は既存の `apiAllowed` と各境界の条件で扱う。保存時の再照会や認証後失効の原子的取消しは加えない。

トークンの`last_used_at`は認証成功直後に`waitUntil`で更新を予約する。後続のonboarding/API許可拒否でも利用記録は変化し得るため、拒否時にDB全体不変とはしない。認証照会後に失効した実行中要求を取り消す性質は含めない。

## 定理と照合

| 性質・具体定理                                                                                                              | 実装・照合テスト                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 未登録・無効拒否: `unregistered_rejected`, `dead_credential_rejected`                                                       | `authenticate`のDB照会。既存[api.test.ts](../../../tests/api.test.ts)「未認証の保存を拒否する」「失効・期限切れトークンを拒否し、Cookieへフォールバックしない」                                                                                                     |
| セッションOrigin: `cross_origin_session_rejected`, `csrf_denial_example`                                                    | `assertSameOrigin`。既存api「セッションによる他サイトからの変更を拒否する」、[onboarding](../../../tests/onboarding.test.ts)「未認証・別サイト・既存Bearerからの同意を拒否する」                                                                                    |
| 許可表・拒否不変: `token_api_table`, `mcp_management_denied`, `policy_denial_preserves_business`                            | authentication.ts。追加[boundary-auth-verification.test.ts](../../../tests/boundary-auth-verification.test.ts)「B01 有効トークンの許可表拒否は業務DBを維持し利用日時だけ記録する」。HTTP入口→DBでarticles/stocks/projects/jobs/キー/users.memory_revisionを比較する |
| 未同意拒否と例外: `onboarding_denial_preserves_business`, `onboarding_exception_example`, `onboarding_token_denial_example` | 既存onboarding「未登録では本人情報とログアウトだけ利用でき、保存APIは利用できない」「既存のMCP認可を使っても未同意のユーザーは利用できない」                                                                                                                        |
| 利用記録と業務状態の分離: `valid_token_records_usage_even_if_denied`, `safe_methods_preserve_business`                      | 上記追加B01テストで拒否ごとに利用日時のみ更新されることを確認                                                                                                                                                                                                       |
| 正常到達: `allowed_reaches_operation`, `session_success_example`, `shortcut_success_example`, `mcp_success_example`         | 既存api保存テスト、[mcp.test.ts](../../../tests/mcp.test.ts)の実OAuth→tools/call→DB保存                                                                                                                                                                             |
| 認証入口分離: `shortcut_never_mcp`                                                                                          | 既存mcp「読み取り専用の認可では追加できず、CookieやショートカットトークンもMCPでは使えない」のショートカットBearer→`/mcp` 401                                                                                                                                       |

PUTの固有定理`put_session_requires_origin`は任意のRouteでOrigin不一致のセッション変更を拒否し、`put_token_and_mcp_denied`は任意のRouteでtoken/MCPのPUTを拒否する。実装との照合は既存[x-integration.test.ts](../../../tests/x-integration.test.ts)「秘密キー未設定・未認証・CSRF・MCP・共有トークンを拒否する」と[push.test.ts](../../../tests/push.test.ts)「内部URL・リダイレクト先・無効な暗号鍵・クロスオリジン・匿名の登録を拒否する」を再利用する。

8変異は認証・CSRF・onboarding・許可表に加え、セッションのJOIN一致・提示ハッシュ一致・認証時刻期限のguardとprincipalのuser投影をそれぞれ壊し、対応する安全性定理の証明失敗を要求する。[auth.json](../mutations/auth.json)に一意の置換箇所と対象定理を登録する。

セッション主体の定理は `authenticated_session_matches_row`、`session_join_mismatch_rejected`、`session_hash_mismatch_rejected`、`session_expired_at_authentication_rejected`。`session_identity_success_and_denial_example` は成功とJOIN・hash・期限・行欠落拒否を具体値で到達させる。照合には追加 [boundary-social-verification.test.ts](../../../tests/boundary-social-verification.test.ts)「bodyのowner・session指定を使わず、Cookieを照会した本人とセッションへ購読を結び付ける」を使う。Cookie→実hash→sessions JOIN users→principal→購読SQLまで通し、保存したowner/sessionHashを比較する。

## 未検証の前提・限界

暗号ハッシュ、Cookie/Authorization構文、OAuthプロバイダー、URL/正規表現からRouteへの分類、D1照会結果の正しさは前提。有限のMethod/Routeクラスを扱い、任意の文字列に対するパーサーとの同値性は証明しない。API許可表はツール固有scopeや所有者検査を代替しない（B03/B05）。正常時の各ハンドラーの全DB効果、利用日時更新の耐障害性・到達順序、読み取り後の失効との並行性は対象外。追加テストのDBスナップショットは記載した表と列に限る。
