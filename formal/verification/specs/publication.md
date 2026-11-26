# B06 匿名公開・公開ID・ディレクトリキャッシュ

対象モデルは `Verification.Publication`。公開条件、キャッシュ選択、公開設定と足あとの掲載の状態遷移を記述する。

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

足あとの変更と照合テストは `public-footprints.test.ts` を使う。

- `listPublicFootprints` と公開HTMLの `?view=footprints` を `readPublishedFootprint` に対応させる。`footprint_read_requires_approval`、`footprint_other_project_denied`、`footprint_stale_source_denied`、`footprint_memory_off_denied` は、公開ID、同じプロジェクトの完成済み足あと、根拠の版、メモリ設定、掲載原稿を確認する。匿名APIとHTMLのテストでは、別プロジェクト・非掲載・取り消し・根拠削除・非公開化の拒否、限定した項目と文字のエスケープを確認する。
- `PATCH` と `DELETE /api/v1/projects/:id/footprints/:revision/publication` を `saveFootprintCopy` と `removeFootprintCopy` に対応させる。拒否時の保持、成功時の元の分析の保持、正常・拒否状態の到達性を証明する。照合テストでは本人と匿名・別ユーザー・別Origin、無効な入力、未生成・根拠が無効な版の拒否、掲載行の更新・削除とプロジェクト削除の連鎖を確認する。

追加テストは既存 `testApp` の実際のRequest/Response入口からHonoルート、MiniflareのD1・Cache APIまでを通す。公開IDの直接DB変更はキャッシュトリガーと旧URL拒否の照合用であり、公開IDを回転させる新しい製品APIを設けたものではない。公開画像・本文・privateフィールドの返却制限は既存public-projects/public-pagesテストを再利用する。

## 判定時点と保護状態

匿名詳細の公開状態とpublic_idは各SQL照会時に判定する。公開HTMLもその都度公開APIを呼ぶ。ディレクトリのキャッシュヒットはprimary DB bindingでrevisionを取得した後、その世代・pageのキーに対してだけ行う。revisionが存在しない場合、Cache APIが利用可能な経路は500になり旧キャッシュを返さない。Cache APIなし・open失敗の経路はDBで `is_public=1` を再評価するため、revision照会なしでDBへ進む。

`detail` は全状態を保持する。`changePublication` が拒否された場合も状態全体が不変である。成功時は公開フラグ・public_id・キャッシュ世代だけが変化し、業務データ、業務revision、履歴、利用記録は不変とする。公開用紹介文、published_at、検索掲載設定の更新内容は本モデルでは省略している。

公開状態に関係する変更の新しいrevisionにより、その後の要求は旧世代のキャッシュを参照しない。実装では非公開化後に旧世代への遅延putがあっても、後続要求は新世代を使う。この競合は既存「キャッシュの投入が非公開化より遅れても、後続の取得で古い一覧を返さない」で照合する。

足あとの匿名取得は、公開ID、公開状態、メモリ設定、足あとの掲載・完成状態、根拠の所属と版を同一のD1照会で確認する。公開APIと公開HTMLには `no-store` を設定する。プロジェクトの非公開化やメモリ更新のオフは掲載原稿を保持したまま新規の匿名取得を止める。元の条件に戻すと、根拠が現行の掲載原稿が再表示される。個別の取り消しは原稿を削除し、プロジェクト・足あとの削除でも外部キーで原稿が削除される。

## 公開記録から生成する足あと

- `SharedAnalysis.projection` は公開用の生成元と根拠の現行性を別々に照合する。`sharedResult` は公開識別子を持つ再分析、同じ条件を満たす元の分析の順に選ぶ。`sharedFootprint` がログイン後と匿名取得の共通の表示データを作り、該当する分析がなければ承認済みの既存原稿を返す。「続く」は公開ID・日付・分類だけを返す。
- `analyze` は公開プロジェクトの場合、対象期間の両端と、ストックの公開要約、公開できる問いの本文、公開されているプ譜の局面を入力に使う。中間のメモリ版や個人メモ、既存の個人用分析、回答、コメント、記事の取得本文は公開用の生成入力から除く。プ譜は公開の詳細取得条件とスキーマを使う。公開識別子の初期値は空で、公開記録から生成して根拠を照合した場合に設定する。再分析は自身の根拠に基づいて公開でき、元の分析だけが参照していた個人用の資料の削除で消えない。
- `SharedAnalysis.shared` は公開停止やメモリ設定オフ時に表示を拒否する。読み取りでは承認済みの原稿、分析、根拠、メモリ履歴、利用枠を変更しない。DBとAPIの対応は [public-footprints.test.ts](../../../tests/public-footprints.test.ts) と [project-footprints.test.ts](../../../tests/project-footprints.test.ts) で照合する。Leanでは入力の選別と保存の条件を抽象化し、モデルによる解釈の正しさは仮定しない。
- ストックと問いの公開用の版は、公開表示に関わる項目の変更時刻を使う。個人だけのメモやお気に入りの操作では公開用の版を進めない。移行前の記録は、公開項目と個人用項目の過去の変更を区別できないため、従来の最終更新時点を一度だけ初期値に使う。対象期間の抽出では公開可否を照合した資料から件数を絞り、各記録の編集時刻は公開分析の入力に含めない。

掲載は本人の有効なセッションと同一Originで受け付け、書き込みのSQLで所有者、対象版、公開・メモリ設定と根拠を再確認する。取り消しは保存時点で所有者と対象版を確認する。拒否時は原稿も元の分析も保持する。掲載用の書き込みが成功すると対象版の原稿だけが変わり、プロジェクト設定、分析、根拠、メモリとその版・履歴、AI利用記録は保持する。許可されない管理操作に有効なBearerトークンを使った場合の認証時 `api_tokens.last_used_at` 更新は、この状態遷移の対象に含めない。

## 抽象化と保証しない範囲

- revisionは実装ではランダムな文字列で、モデルは異なる世代を自然数の後続値で表す。DBトリガーの正常動作と新revisionの非衝突を前提にする。全SQLトリガーの実装そのものをLeanで解釈してはいない。
- ディレクトリのDB結果は公開行だけを返す既存SQLに委ね、モデルはCache APIのキー選択を扱う。キャッシュの内部破損・不正なキー応答、JSON/HTMLの射影・エスケープ、D1やCloudflareの整合性全体は証明しない。
- 最後の公開状態・revision照会より後の非公開化、削除、退会は進行中の応答を取り消す保証にならない。応答済みデータの回収も対象外である。
- モデルとTypeScript/SQLの同値性は証明していない。個別の実装テストで対応を確認する。
- 足あとのモデルは同一プロジェクト・完成状態・根拠現行性を別々の条件として表す。公開用タイトルと説明を一つの値に抽象化し、公開ID、日付、分類の限定列と版の結合、資料ごとの版の比較、外部キー、キャッシュヘッダー、HTMLの文字処理は実装と照合テストで確認する。所有者が文面に入力した内容の妥当性は所有者が確認する。

## 変異

`mutations/publication.json` は、非公開条件、世代一致、revision欠損時の拒否と、足あと掲載原稿の限定、所属、根拠現行性、メモリ設定、編集権限を一つずつ崩し、対応する定理の証明が失敗することを確認する。型や構文の不正による失敗は検出成功に数えない。
