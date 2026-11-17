# B12 SNS連携（X）の資格情報と外部取得

対象は利用者が登録したX Bearer Tokenによる本文取得である。SNS用OAuth認可、refresh、投稿の権限は作らない。[Sns.lean](../BoundaryVerification/Sns.lean) は資格情報のユーザー別保存、AAD照合、削除、公開状態、外部取得の採用条件を独立した逐次遷移として扱う。

`Management.identity` は [Auth.lean](../BoundaryVerification/Auth.lean) のセッションprincipalであり、`put`・`erase` は対象userを独立の引数として受け取らない。更新・削除対象とAADのuserは `identity.userId` から固定する。`authenticated_put_binds_owner` は `authenticateSession` 成功から、元セッション行のownerへ保存されることを示す。`authenticated_other_owner_unchanged` は同じ認証経路から、他ownerの資格情報全体がPUT・DELETEの両方で不変であることを示す。局所定理 `put_owner_only`・`erase_owner_only` も、比較相手を呼出し側が指定したtargetではなく、認証主体のIDと比較する。

追加照合「両者の資格情報が存在してもAliceの更新・削除はBobの暗号文と更新時刻を維持する」はAlice/BobそれぞれのCookieで実HTTP登録とAES-GCM暗号化を行い、Alice PUT後・DELETE後のBobのencrypted_token/updated_atを完全比較する。同時にAlice自身の更新・削除とBobの復号結果を確認する。

## 実装・定理・テストの対応

| 境界・実装                                                                                                                                                                  | モデル・定理                                                                                                                                                                     | 実経路の照合                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [API許可表](../../../server/api/middleware/authentication.ts)、[認証・Origin](../../../server/features/auth/auth.ts)、[管理API](../../../server/api/routes/integrations.ts) | `mayInspect` はsession/onboarding、`mayChange` はさらにOrigin。`management_requires_session`、`rejected_management_unchanged`。入力検証と暗号化の成功後を `put` の保存切点とする | 既存 [x-integration.test.ts](../../../tests/x-integration.test.ts)「秘密キー未設定・未認証・CSRF・MCP・共有トークンを拒否する」。GET/PUT/DELETEの非session拒否を確認                                                                                           |
| 管理APIの `user_id` / provider=x条件、[encryptToken/xToken](../../../server/features/integrations/x.ts) の `x:${userId}` AAD                                                | `put_owner_only`、`put_loads_same_user`、`copied_cipher_rejected`。DB行のowner選択とAADのowner対応を分ける                                                                       | 既存「暗号化保存し本人だけが更新・削除でき、値を返さない」がHTTP→D1→実AES-GCMを通し、他人の削除と暗号文の別ownerへの移植を拒否                                                                                                                                 |
| DELETE後の新規 `xToken` 読込                                                                                                                                                | `erased_new_load_rejected`、`missing_token_rejected`                                                                                                                             | 新規 [boundary-social-verification.test.ts](../../../tests/boundary-social-verification.test.ts)「configuredはXの有効性を主張せず、削除後の新たな取得は資格情報を送信しない」がHTTP削除→DB行削除→ `fetchXPost` の新規呼出しで、追加の外部fetchがないことを確認 |
| GET状態は `configured` / `available` / `updated_at` のみ                                                                                                                    | `public_status_ignores_secret`、`registered_is_configured`。`configured` はローカル行の存在であり、Xへ問い合わせない                                                             | 同じ新規テストで401後もconfigured=true、秘密を含まない応答、削除後falseを確認                                                                                                                                                                                  |
| 固定 `api.x.com` 宛て、`redirect: 'manual'`、HTTP成功・投稿ID・空白除去後の本文・サイズ条件                                                                                 | `outgoing_fixed_manual`、`fetch_success_guards`、`unauthorized_rejected`、`redirect_rejected`、`response_does_not_expose_token`                                                  | 既存「X・旧TwitterのURLを認識し、短文・長文を固定APIだけから取得する」「APIや通信のエラー内容・トークンを公開しない」「Workersが受理できるリクエストでX本文を取得する」。新規テストでは実復号後のBearerとmanual指定をstubの引数で確認                          |
| 管理失敗時・正常時に保護する業務状態                                                                                                                                        | 拒否時は `put/erase` 全state不変、正常 `put` でも `put_business_unchanged`。保存成功時の他owner資格情報も不変                                                                    | 既存owner/AAD照合。アクセスログ・利用記録など全DB不変は主張しない                                                                                                                                                                                              |

`reachable_registered_and_erased`、`reachable_mcp_denial`、`reachable_fetch_and_auth_denial` は保存・削除・取得成功と拒否を具体値で到達させる。`reachable_authenticated_update_preserves_other` はセッション認証成功と、両者に資格情報が存在する状態から本人更新・他人の資格情報維持を到達させる。

## 判定時点と保護する状態

管理権限は共通認証ミドルウェアの照会時点で判定し、書込は認証主体の `user.id` だけをSQLへ渡す。モデルの `put` は入力形式・長さ・暗号鍵設定・AES-GCM暗号化に成功した保存段階の抽象化であり、それらの失敗まで成功遷移として扱わない。秘密は資格情報行でだけ更新され、業務データ・revision・関連・履歴の変更はこの操作の効果に含まれない。ログ・rate limit等の補助状態の不変性は対象外である。

削除後の拒否は、DELETE確定後に開始する新たなDB資格情報照会に適用する。削除前に取得済みのBearerを持つ実行中のfetchは止めない。`configured` はGETのDB行照会時点の登録状態、`available` はその時点のローカル暗号鍵設定を表す。X側で失効したBearerでも登録行があればconfigured=trueとなる。

取得結果の採用はHTTP応答とJSON検査時点で決まる。リダイレクトは自動追跡せず3xxを拒否する。HTTP失敗の本文、fetch例外のmessage/stack、Bearerは公開エラーへ渡さない。モデルは秘密を持たない結果型と固定した外部宛先・manual指定を表し、実装テストが実際の応答・引数を照合する。

## 前提と限界

- `Cipher.aadUser` / `authentic` はAES-GCMライブラリが追加認証データと暗号文の完全性を検証した結果の抽象化である。暗号安全性、乱数、鍵管理、暗号文形式のパーサーの正しさを証明しない。
- `State.credentials` はuser_id/provider=xで選択された一つの行の写像である。D1制約・SQL・TypeScriptとLeanの自動的な同値性、DB障害や同時書込の原子性は証明しない。
- `ProviderResponse` のID一致・本文有効・サイズ内は実装の検査結果であり、本文内容の正しさやX側の閲覧権限管理は証明しない。401/403などの非2xxを成功として採用しない条件を証明する。
- HTTP層テストは既存Hono入口とMiniflare D1を使う。外部X通信はすべてstubであり、実アカウント・本番データ・本番APIは使わない。
- 認証後に失効したセッションによる実行中管理要求、削除前に復号済みのBearerの利用停止、既に返却した本文の回収は保証しない。

## 変異と実行

[変異定義](../mutations/sns.json) はsession限定、保存owner、AAD owner、HTTP成功条件、公開応答への秘密混入、manualリダイレクトに加え、PUTとDELETEの対象を認証主体以外へ置換する8変異を持つ。それぞれ指定した定理の証明失敗で検出する。構文・import・環境のエラーは検出成功に数えない。

```sh
cd formal/boundary-verification
PATH=/home/agent/.elan/bin:$PATH lake env lean BoundaryVerification/Sns.lean
```

新規TS照合はリポジトリルートで `pnpm exec vitest run tests/boundary-social-verification.test.ts --maxWorkers=1` を実行する。既存のX全体の振る舞いは `tests/x-integration.test.ts` が引き続き保護する。
