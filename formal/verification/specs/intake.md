# B14: 添付画像・PDFサービス・AI応答の採用条件

## 実装と判定時点

- [stockImagesApp](../../../server/features/stocks/stock-images.ts) はAPI認証後にショートカットtokenを拒否し、stockのownerと許可projectを確認する。ファイル名、5MiB以内、[imageType](../../../server/features/stocks/image-type.ts)の検出形式とContent-Typeの一致を検査する。
- 新規IDの条件付きINSERTはpendingも含む件数が5未満のときだけ予約する。R2 PUT後のUPDATEは、同じid/content_key、現時点のowner/projectを再照会してreadyを確定する。失敗時はそのkeyの行だけを削除し、外部オブジェクトの掃除を予約する。id再使用で別keyの新しい行を消さない。
- GET/一覧はreadyのみ。pendingの再送は409、同じ画像のready再送は200、異なる内容なら409。再送規則のLeanモデル化は今回含めず、既存テストで確認する。
- [PDFクライアント](../../../server/features/stocks/pdf/pdf-client.ts) は入力Content-Lengthの10MiB上限、サービス有無、20秒中断、応答1MiB上限、title文字列/300文字以下、text文字列/200〜120000文字を確認してから結果を返す。422かつerrorが文字列なら解析失敗として返す。現行クライアントは、422でもerrorが文字列でなくtitle/textが正常なら採用する（今回変更しない）。専用[Worker](../../../server/features/stocks/pdf/pdf-worker.ts)も入力の実バイト数を制限し、解析を重ねず、DB/認証情報を持たない。
- [parseAiJson](../../../server/infrastructure/ai/ai.ts) はchat envelope/終了理由、JSON decode、呼出元のZodスキーマを通した値だけを返す。finish_reasonはstop・null・省略を許可する。reasoning_contentは回答として採用しない。

## モデルと照合

モデル: [Intake.lean](../Verification/Intake.lean)。画像のcountは予約時の全pending/ready件数、pendingKey/readyKeyは対象IDの抽象スロット、keyはR2 object keyの識別子。親とscopeは予約時と確定時の観測値を別々に渡す。finishは掃除の予約までを表し、失敗時の総件数返却・R2削除の完了は扱わない。

| 定理                                                                                                          | 対応する実装                                              | 照合テスト                                                          |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| unauthenticated_denied / shortcut_denied                                                                      | 共通認証とstockImagesAppのprincipal.kind                  | stock-imagesの「他人・未認証…token…」                               |
| oversized_denied / signature_mismatch_denied                                                                  | limitedBytes / imageType + Content-Type                   | stock-imagesの「形式偽装・SVG・空・過大入力…」                      |
| pending_counts_towards_limit / reservation_bounded                                                            | INSERTのCOUNT条件                                         | stock-imagesの「並行アップロードでも上限…」                         |
| reservation_keeps_ready                                                                                       | pending INSERTとready条件のGET                            | boundary-intake-verificationの「R2保存中のpending画像…」            |
| finalize_deleted_parent_denied / finalize_scope_rechecked / finalize_owner_rechecked / finalize_key_rechecked | PUT後のowner/project/key付きUPDATE、失敗時のkey付きDELETE | stock-imagesの「親削除…同じリクエストID…」「MCPの保存中に…移動…」   |
| denied_finalize_keeps_ready / successful_finalize                                                             | UPDATE成功のready化、失敗のcleanup予約                    | 上記と新規pending観測テスト                                         |
| pdf_error_status_denied / pdf_422_error_denied / pdf_short_text_denied / pdf_large_response_denied            | PDFクライアントのHTTP/error条件と出力境界                 | 新規「PDFサービス出力の文字数境界…」、実Workerのpdf-worker          |
| invalid_ai_schema_denied / incomplete_chat_denied                                                             | parseAiJsonのZod、終了理由の検査                          | ai-outputの「不完全または不正なchat応答…」「AIが指定を守らず上限…」 |
| image_success_reachable / image_rejection_reachable / output_success_reachable / pdf_422_shape_reachable      | 正常・拒否状態の具体例                                    | 新規テストのready確定とpending再送409、既存AI正常応答               |

[変異](../mutations/intake.json)はowner・検出形式・最終project・object key・PDF本文下限・AIスキーマを外し、それぞれ対応する定理が失敗することを確認する。

## 前提と未検証

API層の認証・CSRF・MCP scope判定はB01/B05側で扱う。Leanは実際の画像シグネチャ検出、UTF-8/JS文字数、ハッシュ/UUID、Zod/JSON解析、PDF.js/LLMの内容、暗号、R2/D1の原子性を証明しない。PdfOutputのstatus/errorIsStringはHTTP成功範囲または422の文字列error有無を個別に表し、AiOutputの判定値は実装の観測結果を抽象化したものであり、パーサーの正しさを仮定してアルゴリズム全体の安全性を証明したものではない。PDFの200/300等はJS文字列のlengthに対応し、モデルのNatへ測定済み長さを渡す。

予約・PUT・確定・削除をまたぐ全並行実行の網羅的証明は行っていない。条件付き確定の安全性と、実テストによる限定した割込み例を区別する。最後のGET照会後の親削除で既送信バイトを取り消すことは保証しない。PDFは実サービスbindingで正常・過大・中断を既存テストし、壊れたサービス出力はstubで採用拒否を確認する。AI→全業務DB経路の全スキーマを今回追加テストしたとは主張しない。
