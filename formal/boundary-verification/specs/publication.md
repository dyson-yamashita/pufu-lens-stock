# B06 匿名公開・公開ID・ディレクトリキャッシュ

対象モデルは `BoundaryVerification.Publication`。製品コードの条件を変更せず、公開条件・キャッシュ選択と公開設定変更の最小状態遷移を記述する。

## 実装・証明・照合テストの対応

| 実装の入口・条件                                                                                                                                    | Lean定義・定理                                                                                                                                                | 実装との照合                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/features/public-projects/public-projects.ts` の `publicWhere` (`public_id=? AND is_public=1`) と各詳細API                                   | `detailAllowed` / `detail_requires_existing`, `detail_requires_public`, `detail_requires_key`, `private_denied`, `deleted_denied`, `missing_public_id_denied` | 既存 `public-projects.test.ts` の「非公開化で一覧と全参照を止め、再公開しても同じURLを使え、削除時もアクセスできない」「公開URLから別のプロジェクトの問い・プ譜・生成途中の情報へアクセスできない」              |
| `public-pages.ts` の `readPublic` が同じ公開APIをプロセス内HTTPで呼ぶ                                                                               | `detail` の公開可否を共用する抽象化                                                                                                                           | 既存 `public-pages.test.ts` の「掲載解除・非公開化・削除後の取得で古い本文やOGPを再利用しない」                                                                                                                  |
| `publicationApp` の所有者付きSELECT/UPDATE、および `server/api/middleware/authentication.ts` と `server/features/auth/auth.ts` のsession/Origin制御 | `mayEdit`, `changePublication` / `edit_requires_session`, `edit_requires_owner`, `edit_requires_same_origin`, `edit_rejected_unchanged`                       | 既存 `public-projects.test.ts` の「既存・新規プロジェクトは非公開で、公開設定は所有者のセッションと同一Originでのみ変更できる」「公開設定を外部連携用のトークンやMCPから変更・取得できない」                     |
| `COALESCE(public_id,?)`、公開設定だけのUPDATE                                                                                                       | `edit_retains_public_id`, `edit_preserves_business_data`                                                                                                      | 上記再公開ケースと既存「公開の読み取りは書き込み・ジョブ起動を行わず、局面が未移行でも保存済みのプ譜を参照する」                                                                                                 |
| `/api/public/projects` が利用可能なCache APIでrevisionを読み、世代・pageをキーへ含める                                                              | `directory` / `cached_requires_current_generation`, `stale_cache_not_used`                                                                                    | 既存 `public-directory-cache.test.ts` の「ページ・公開範囲を分離し、Cookieや任意クエリを共有内容に混ぜない」「非公開化/プロジェクト削除/退会の連鎖削除後は、他拠点に旧キャッシュが残っていても一覧に表示しない」 |
| 同ルートで `!revision` を例外にし、旧キャッシュを利用しない                                                                                         | `missing_revision_fail_closed`                                                                                                                                | 既存 `public-directory-cache.test.ts` の「revisionを確認できないときは、暖まった旧キャッシュを返さない」                                                                                                         |
| `migrations/0035_public_directory_cache.sql` の公開プロジェクト更新トリガー、公開ID変更でもrevisionが変わる                                         | `changed_publication_invalidates_old_cache`                                                                                                                   | 新規 `boundary-public-verification.test.ts` の「公開IDを変更すると旧キャッシュを使わず、旧IDの匿名取得を拒否する」                                                                                               |
| 成功と拒否が実際に可能な状態                                                                                                                        | `success_reachable`, `refusal_reachable`                                                                                                                      | 新規の公開ID変更テストと上記既存テスト                                                                                                                                                                           |

追加テストは既存 `testApp` の実際のRequest/Response入口からHonoルート、MiniflareのD1・Cache APIまでを通す。公開IDの直接DB変更はキャッシュトリガーと旧URL拒否の照合用であり、公開IDを回転させる新しい製品APIを設けたものではない。公開画像・本文・privateフィールドの返却制限は既存public-projects/public-pagesテストを再利用する。

## 判定時点と保護状態

匿名詳細の公開状態とpublic_idは各SQL照会時に判定する。公開HTMLもその都度公開APIを呼ぶ。ディレクトリのキャッシュヒットはprimary DB bindingでrevisionを取得した後、その世代・pageのキーに対してだけ行う。revisionが存在しない場合、Cache APIが利用可能な経路は500になり旧キャッシュを返さない。Cache APIなし・open失敗の経路はDBで `is_public=1` を再評価するため、revision照会なしでDBへ進む。

`detail` は全状態を保持する。`changePublication` が拒否された場合も状態全体が不変である。成功時は公開フラグ・public_id・キャッシュ世代だけが変化し、業務データ、業務revision、履歴、利用記録は不変とする。公開用紹介文、published_at、検索掲載設定の更新内容は本モデルでは省略している。

公開状態に関係する変更の新しいrevisionにより、その後の要求は旧世代のキャッシュを参照しない。実装では非公開化後に旧世代への遅延putがあっても、後続要求は新世代を使う。この競合は既存「キャッシュの投入が非公開化より遅れても、後続の取得で古い一覧を返さない」で照合する。

## 抽象化と保証しない範囲

- revisionは実装ではランダムな文字列で、モデルは異なる世代を自然数の後続値で表す。DBトリガーの正常動作と新revisionの非衝突を前提にする。全SQLトリガーの実装そのものをLeanで解釈してはいない。
- ディレクトリのDB結果は公開行だけを返す既存SQLに委ね、モデルはCache APIのキー選択を扱う。キャッシュの内部破損・不正なキー応答、JSON/HTMLの射影・エスケープ、D1やCloudflareの整合性全体は証明しない。
- 最後の公開状態・revision照会より後の非公開化、削除、退会は進行中の応答を取り消す保証にならない。応答済みデータの回収も対象外である。
- モデルとTypeScript/SQLの同値性は証明していない。個別の実装テストで対応を確認する。

## 変異

`mutations/publication.json` の3件は、非公開条件、世代一致、revision欠損時の拒否をそれぞれ除き、`detail_requires_public`、`cached_requires_current_generation`、`missing_revision_fail_closed` の証明を失敗させる。型や構文の不正による失敗は検出成功に数えない。
