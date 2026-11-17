# B09 外部URL・DNS・リダイレクト

検証日: 2026-11-17。対象は [security.ts](../../../server/infrastructure/security.ts) の `validateUrl` / `assertPublicDestination` と、[ingest.ts](../../../server/features/stocks/ingest.ts) の `fetchPublic`、[OG画像保存](../../../server/features/stocks/og-image.ts) から同関数への経路。モデルは [Network.lean](../BoundaryVerification/Network.lean)、変異は [network.json](../mutations/network.json)。

## 判定時点と保護する状態

保護する状態は取得対象へのHTTPリクエスト列 `State.fetched`。固定の `https://cloudflare-dns.com/dns-query` への名前解決要求は、この列とは別である。拒否した移動先への取得を追加せず、それまでに取得した公開先の列は保持する。取得済みのHTTP要求やDNS要求の取消し・副作用の巻戻しを主張しない。

`fetchPublic` は最初のURLを検証し、ループごとにcaller guard、期限、YouTube制限、URL/DNS宛先検証を済ませて `redirect: 'manual'` のHTTP取得を開始する。300〜399を受け取ると、Locationを現在のURLで解決し `validateUrl` を再適用する。次の反復でその移動先のDNSを再検証する。Locationが無い、URLが不許可、DNSが不許可、期限超過、6回目の取得もリダイレクト、のいずれかで停止する。非リダイレクト応答はHTTPエラーでも呼出元へ返すため、モデルの `finished` は取得応答の返却を表し、HTTP 2xxを意味しない。

期限は反復のDNS検査より前に判定する。DNS応答を待っている間の期限到達は再照会せず、実際のfetchには残り時間から算出した最短1msのtimeoutを渡す。モデルの `beforeDeadline` はこの反復開始時の判定結果であり、「HTTP開始時に常に期限内」とは証明しない。

OG画像の拒否は画像を書き込まず `false` を返し、記事本文・要約の処理を継続する。全DBやR2全体が不変になる境界ではない。

## 明示した許可条件

`Url` はWHATWG URLによる解析・正規化後の値と検証対象文字列長を抽象化する。`urlAllowed` は次の条件を独立に要求する。

- 解析成功、対象文字列長4096以下、schemeが `http:` または `https:`。
- usernameとpasswordがどちらも空。
- portが未指定、80、443のいずれか。schemeとportの組合せを追加制限しない。WHATWG URLが既定portを空へ正規化する点はパーサー側の前提。
- 正規化hostにドットまたはコロンがあり、`localhost`、末尾の `.localhost/.local/.internal/.test/.example/.invalid` でない。実装は角括弧と末尾ドットを除去して比較する。
- IP literalなら `ipaddr.process(...).range() === 'unicast'` を満たす。IPv4表記変換やIPv4-mapped IPv6の処理も同ライブラリの分類に委ねる。

非literalはさらに `dnsAllowed` が必要。A/AAAA両要求のHTTP応答が成功し、両Statusが0または3、両応答からtype 1/28だけを抽出したアドレス列が非空で、全要素が公開IPでなければならない。CNAME等を公開IPと数えない。片方の応答がNXDOMAINでも、集めたアドレスが存在し全て公開なら実装上は許可される。literalはURLで公開IP検証を済ませるためDNS照会を省く。

`Request` はさらに任意のcaller guardの成功、ループ開始時の期限内、YouTube対象でないことを要求する。`step` は停止済み・応答返却済みの後には取得せず、各リダイレクト先でも同じ条件を使う。初期budgetは6で、1取得ごとに1を消費する。

## コード・定理・照合テストの対応

新規テストは [boundary-network-quota-verification.test.ts](../../../tests/boundary-network-quota-verification.test.ts)。既存の実経路は [ingest.test.ts](../../../tests/ingest.test.ts)、[og-images.test.ts](../../../tests/og-images.test.ts)、分類・URL単体の補完は [security.test.ts](../../../tests/security.test.ts)。

| 実装・性質                                    | Lean定理                                                                                                                            | テスト名・観点                                                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| URL credentials/scheme/port/host              | `allowed_url_has_no_credentials`, `allowed_url_scheme_port_host`                                                                    | 新規「移動先のURLまたはDNSを拒否すると次のHTTP取得を開始しない」（scheme、credentials、port、内部host）；既存securityのURL/IP分類                      |
| 非literalのDNS、混在した内部IPv6回答も拒否    | `nonliteral_requires_dns`, `dns_rejects_any_private_answer`                                                                         | 新規「移動先のURLまたはDNSを拒否すると次のHTTP取得を開始しない」の公開A・内部AAAA混在；新規「empty/dns-status/dns-httpでは最初のHTTP取得も開始しない」 |
| 拒否後に取得を増やさず、全hopを再検査         | `rejected_request_does_not_fetch`, `stopped_never_fetches_again`, `redirect_preserves_checked_trace`, `run_preserves_checked_trace` | 新規移動先拒否；新規「公開先への相対移動も毎回DNSを確認して取得し、6回目の移動で停止する」；既存ingestの内部IP/内部DNS・YouTube・次ページguard拒否     |
| 6回までの取得と終端                           | `budget_never_increases`, `step_conserves_budget`, `run_conserves_budget`, `no_more_than_six_fetches`, `sixth_redirect_stops`       | 新規相対移動6回停止（各回A/AAAA照会も確認）                                                                                                            |
| 成功と拒否の到達可能性                        | `successful_fetch_reachable`, `unsafe_redirect_stops_before_second_fetch`                                                           | 既存ingest「相対URLへのリダイレクトをたどり、移動先の記事タイトルと本文を取得する」；新規移動先拒否                                                    |
| optional OG画像の拒否を記事処理へ波及させない | traceに不許可hopを追加しない性質を適用。記事DB/R2の性質自体はLeanモデル外                                                           | 新規「OG画像の移動先が内部DNSなら画像を保存せず記事の処理を完了する」（POST API→ArticleWorkflow→DNS/HTTP stub→記事DB/CONTENT/画像API）                 |
| 期限・HTTPヘッダー                            | `requestAllowed` の反復開始時guard、拒否定理。秘密ヘッダーの構築はLeanモデル外                                                      | 新規「deadlineでは最初のHTTP取得も開始しない」；移動先拒否テストでmanual redirect、Cookie/Authorization不在を確認                                      |

DNS拒否の照合テストは狙う条件だけを不正にする。Statusエラーは公開IPの有効な回答を含み、HTTP 503もStatus=0と公開IPを含む有効なJSONを返す。空回答はHTTP 200/Status=0で検査し、期限ちょうどは許可されるDNS回答を用意したうえでDNS自体が呼ばれないことも確認する。

変異3件はcredentials条件削除、DNS条件削除、各hopのrequest guard削除。それぞれ指定定理の証明箇所で失敗することを共通runnerで確認し、構文・定義エラーによる失敗は検出成功にしない。

## 前提と未検証

- URL解析、文字列長、host正規化、IP分類、DNS回答JSON解析の正しさは入力側の前提。Leanは文字列パーサーやIPアドレス空間全体を検証しない。
- 実HTTP接続が検証したDNS結果の公開IPへ向くことは別の前提。実装はfetchの接続先IPをDNS回答へ固定しないため、DNS rebindingや照会後のDNS変更を防ぐことは証明していない。DNSサービス・TLS・実ネットワークをこのテストで検証しない。
- caller guard、IP literal分類、実装のHTTP/DNS API、AbortSignalとbody cancelの動作は信頼境界。モデルのリクエスト列と実通信の同値性証明ではない。
- fetchPublic以外のX取得やBrowser Rendering自身の通信制御はこのモデルの対象外。本文抽出、コンテンツサイズ、任意のリモートサーバーの副作用も含まない。
- テストのDNS/HTTPはすべてstub。実DB/R2は既存Miniflare基盤で動かし、本番データ・本番通信は使用しない。
