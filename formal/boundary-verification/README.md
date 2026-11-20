# 境界処理の最小モデル B01〜B16

MCP以外も含む既存境界をLean 4.36.0で扱う。[B00 update_pufu](../mcp-verification/README.md)の仕様と検証範囲は専用のREADMEを参照する。

## 対象と対応表

以下の「詳細仕様」に、調査した実装、定理名と実装の判定箇所、実際の入口を通したテスト、保護する状態、判定時点、前提・未検証範囲を記録している。対象IDの全機能を完全再現したモデルではなく、表の性質を扱う最小モデルである。

| ID  | モデル・詳細仕様                                                                           | 数学的に証明する主な性質                                                         |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| B01 | [Auth](BoundaryVerification/Auth.lean) / [仕様](specs/auth.md)                             | 認証種別ごとのAPI許可表、セッションの同一Origin/onboarding、本人IDとhashの受渡し |
| B02 | [Shortcut](BoundaryVerification/Shortcut.lean) / [仕様](specs/shortcut.md)                 | トークンの期限/失効、owner/projectごとの保存先、キー再送                         |
| B03 | [Connection](BoundaryVerification/Connection.lean) / [仕様](specs/connection.md)           | 元のscopeとの積集合、最新設定/owner、発行・検証・callbackを通したrefreshの拒否   |
| B04 | [McpWrites](BoundaryVerification/McpWrites.lean) / [仕様](specs/mcp-writes.md)             | 作成と局面追加の再送/競合、revision、既存局面維持                                |
| B05 | [McpVisibility](BoundaryVerification/McpVisibility.lean) / [仕様](specs/mcp-visibility.md) | scope/owner/projectの同時条件、フィルタ後の可視集合                              |
| B06 | [Publication](BoundaryVerification/Publication.lean) / [仕様](specs/publication.md)        | 公開ID/公開状態/キャッシュ世代と欠損時の拒否                                     |
| B07 | [ImageLink](BoundaryVerification/ImageLink.lean) / [仕様](specs/image-link.md)             | 秘密リンクの期限/owner/局面/ready、R2後の状態再照会                              |
| B08 | [Jobs](BoundaryVerification/Jobs.lean) / [仕様](specs/jobs.md)                             | 古いメモリ・記事世代の確定拒否、ジョブの終了とlease条件                          |
| B09 | [Network](BoundaryVerification/Network.lean) / [仕様](specs/network.md)                    | URL/DNS各条件、リダイレクト各hopの再検査と予算                                   |
| B10 | [Deletion](BoundaryVerification/Deletion.lean) / [仕様](specs/deletion.md)                 | 本人削除、論理データのcascade、cleanup世代の照合                                 |
| B11 | [Quota](BoundaryVerification/Quota.lean) / [仕様](specs/quota.md)                          | 時間窓の利用枠予約、試行/呼出の計上と所有者条件                                  |
| B12 | [Sns](BoundaryVerification/Sns.lean) / [仕様](specs/sns.md)                                | X資格情報の本人対応、削除後の新読込拒否、外部失敗の拒否                          |
| B13 | [Push](BoundaryVerification/Push.lean) / [仕様](specs/push.md)                             | セッション付き購読、配信前の再確認、試行/lease遷移                               |
| B14 | [Intake](BoundaryVerification/Intake.lean) / [仕様](specs/intake.md)                       | 画像のサイズ/形式/予約、親/scope/key付き確定、PDF/AI出力の採用条件               |
| B15 | [TextStock](BoundaryVerification/TextStock.lean) / [仕様](specs/text-stock.md)             | 本文の所有者・世代の再確認、共有分離、メモリ世代の失効                           |
| B16 | [Reflections](BoundaryVerification/Reflections.lean) / [仕様](specs/reflections.md)        | 周期設定と振り返りの本人限定、締めの重複防止、生成確定時の世代と関連             |

すべてのモデルに成功と拒否の到達例を置く。各モデルの入力となるスキーマ判定や公開IP分類などの前提は、仕様文書に記載する。

## 認証主体と各入口の接続

B01のセッション照会から得た本人ID・session hashをB12/B13へ渡し、SNSの保存/削除対象とPushのowner/sessionをその認証結果から選ぶ。対象ユーザーやsessionを独立した任意入力として扱わず、元のセッション行と保存先の対応、他ユーザーの資格情報の不変性を確認する。認証後の失効と保存の競合による実行中要求の取消しは、この接続の証明には含めない。

B03では、refresh tokenの発行・provider側の検証・アプリcallbackの現在設定判定を区別する。発行時に元offline権限がなければcredentialを作れず、後から設定にofflineを追加してもrefreshの入口に到達しないことを、発行時と現在の設定を分けたモデルで扱う。callback自体が元scopeを再検査しているという実装にない説明はしない。暗号・client・期限・KV内部の検証は外部ライブラリの前提として残す。

秘密画像リンクの前後照会が同一token/keyを使う前提、B01と退会処理B10の本人確認を結ぶ証明は引き続き各仕様の前提・今後の拡張であり、今回の接続対象には含めない。

## 実行

固定バージョン・登録・公理監査は[共通基盤](../README.md)を参照。リポジトリルートで実行する。

```sh
# B00を含む全対象の登録、Leanビルド、公理監査、変異検出
python3 formal/verify.py

# 登録したTypeScript照合テストも実行（ローカル2 worker、全体上限30分）
python3 formal/verify.py --tests

# 登録・公理監査・変異検査の拒否経路を検査
python3 -m unittest discover -s formal -p 'test_*.py' -v
```

既存のPR用CIが全対象のLean検証と、全Vitestの分割実行を行い、失敗を`Check`へ伝える。新たな外部Leanライブラリは使わない。

## 変異検出と登録漏れ

[check.py](check.py)は下位ディレクトリも含む全モデルに対する[変異JSON](mutations)の存在、一意な置換、指定定理の存在を検査する。各モデルの無変更ソースを同じ環境で先にコンパイルし、許可条件を削除/変更したコピーを一時ディレクトリで検査する。製品コードと元のモデルは書き換えない。各コンパイルは60秒、共通ランナーからのスイート全体は5分を上限とし、期限切れは検証失敗として扱う。

失敗は指定した定理の範囲内にLeanのerror診断がある場合だけ認め、定理外の構文/定義/依存エラーや別の定理だけの失敗、コンパイル成功を検出成功として数えない。定理本体を書き換える変異も拒否する。ルートモジュールは全境界のimportだけに制限し、新しいモデルが変異登録をすり抜けないようにする。基盤の回帰テストで正常な安全条件変異、検出されない変異、定義エラー、無関係な定理の失敗を区別する。

[targets.json](../targets.json)が全モジュールと照合テストを登録する正本であり、[verify.py](../verify.py)は未登録ソースを拒否する。全モデルの定理・補助定理・private宣言の推移的な公理依存を監査し、許可する標準公理以外を拒否する。

## 保証の区別と残る課題

Leanが証明したのは、各仕様の前提を満たす抽象状態遷移の性質。TypeScriptの照合は、実HTTP/MCP・ローカルD1/R2/KV・外部送信のstub等で有限の入力と割込み例を観測するもの。両者の自動的な同値性や全並行スケジュールは証明していない。

認証/最終照会後の失効・削除で実行中要求を取り消すこと、応答済み情報の回収、DNS検証と実接続IPの一致、暗号/OAuth/スキーマ/PDFパーサー/LLMの意味的正しさ、D1/R2/KVの全体原子性、外部SNSやPushの動作/厳密な一度だけの配送は範囲外。旧R2結果は公開業務状態には採用されなくても、cleanup対象として物理的に残り得る。

調査で仕様を明確化した点: create_pufuの再送は同IDで新規書込をしないが応答に現在のrevision等を含む。add_pufu_phaseは保存レシートのrevisionを返す。トークン利用日時やAI利用記録は後続拒否時にも変わり得る。Pushのleaseは完了UPDATEで照合されるが、送信直前にlease自体の現行性を再照会する保証はない。これらを無断で変更せず、強い保証を追加する場合は製品仕様・条件付き書込とモデルを別途更新する。
