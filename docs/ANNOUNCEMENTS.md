# お知らせ・Push通知の運用

## 有効化の場所と通知方針

- 主導線はログイン後のサイドバー「お知らせ」。内容を読んでから受信を判断できる。
- 設定変更用に「プロフィール」にも同じ通知設定を置く。初期値はOFF。初回訪問・ログイン時の自動ポップアップは出さない。
- 対象は運営からの新機能・メンテナンス・重要なお知らせ。記事保存やAI処理完了の通知は含まない。
- 端末・ブラウザーごとの明示的な許可。解除・ログアウト・退会・ログインセッションの失効で配信を停止する。再ログイン後は再度有効化する。
- 通知しない小さな改善もお知らせページには掲載できる。障害・利用上の重要な変更・大きな新機能に絞って通知し、日常の細かな修正で通知を増やさない。通常は日本時間9〜20時に配信し、緊急情報は例外とする（時間帯は運営が通知日時で指定）。

## 初回の本番準備

本PRのマージ・本番反映・実ユーザーへの配信は別途のリリース作業。鍵を設定するまで画面は「準備中」で、お知らせの閲覧はできる。

1. 通常のproductionビルドで生成した設定を使い、`pnpm run db:migrate:production`で`0051_push_notifications.sql`を適用する。先にDB、その後アプリをリリースする。
2. 管理者の安全な端末で`node scripts/generate-vapid.mjs`を実行する。秘密鍵はGit管理外の`secrets/`にのみ作る。既存鍵を上書きしない。秘密鍵と公開鍵の組をパスワードマネージャー等に保管する。開発・本番で鍵を分ける。
3. 対象Worker `pufu-lens-stock` とCloudflareアカウントを確認し、`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`、`PUSH_ENABLED`を設定する。subjectは運営者が受信可能な`mailto:`アドレス、または連絡先のHTTPS URL。鍵はSecretとして扱い、値をコマンド引数・チャット・ログに貼らない。
4. 既存リリース工程に合わせ、Wranglerの`versions secret put`へ保護したファイルのstdinから設定し、作成された最終バージョンを確認して通常のバージョン配備で反映する。`secret put`は即時デプロイになるため事前準備には使わない。CLI操作例（通常のproductionビルド後のフラットな設定を使用）：

   ```sh
   pnpm exec wrangler versions secret put VAPID_PUBLIC_KEY --config dist/pufu_lens_stock/wrangler.json < secrets/vapid-public-key.txt
   pnpm exec wrangler versions secret put VAPID_PRIVATE_KEY --config dist/pufu_lens_stock/wrangler.json < secrets/vapid-private-key.txt
   ```

   `VAPID_SUBJECT`と`PUSH_ENABLED=true`も同じ手順で設定する。上記コマンドは本作業では実行していない。既存の毎分Cronを使うため、新しいCronや外部通知サービスの契約は不要。

5. 自分のテスト端末で有効化し、受信・本文への移動・解除後の停止を確認する。iPhone/iPadは16.4以降でSafariの共有から「ホーム画面に追加」し、追加したアプリでログインして操作する。通常のSafariタブでは受信設定できない。

ローカルでは`.dev.vars`に同名の値を設定する。HTTPのlocalhostでもAPIや画面は確認できるが、実際のPushサービスへの通信と実機到達は別途確認する。送信先はChrome/Edge系のFCM、FirefoxのMozilla Push、SafariのApple Pushを許可し、未知のPushサービスには送らない。開発環境の外向き通信制限がある場合、これらのホストへの通信許可も必要。

## お知らせを作成・更新する

お知らせの保存先はD1の`announcements`テーブル。通常の登録・訂正でコードの変更や再デプロイは不要。運営向けの[register-announcementスキル](../.agents/skills/register-announcement/SKILL.md)から、管理者のD1権限で登録する。一般ユーザーの書き込みAPI・MCP配信機能は設けない。

1. スキルへ本文の趣旨・対象DB・公開日時を伝え、**通知あり／なし**を選択する。通知ありの場合は公開日時以降の配信日時も指定する。未指定ならスキルが確認する。訂正では元のID・通知日時を維持する。
2. スキルは日英原稿と登録用JSONを用意する。必須項目は`id`、`category`、`publishedAt`、`notify`、`notifyAt`、`ja`、`en`。各言語は`title`（100文字以内）、`summary`（240文字以内）、`paragraphs`（本文、各2000文字以内・最大10段落）。本文はプレーンテキスト。IDは英数字・ハイフン・アンダースコアのみ。
3. `notify:false, notifyAt:null`で通知なし。`notify:true`の場合はミリ秒付きUTC ISO日時の`notifyAt`が必須。公開日時も同じ形式（日本時間2026-11-20 10時 → `2026-11-20T01:00:00.000Z`）。下書きは`publishedAt:null, notify:false, notifyAt:null`。未来の公開日時は予約公開として扱う。
4. 管理者CLIで検証してから対象DBへ登録する。通常はローカル、**`--remote`を明示した場合だけ本番DBへ書き込む**。本番は通常のproductionビルド後の設定と管理者の認証が必要。内容はSQL引数としてシェルへ渡さず、保護した一時SQLファイルを使う。

   ```sh
   # DBへ書き込まず、入力・対象・通知有無・日時を確認する
   pnpm announcements:register --file /path/to/announcement.json --remote --dry-run
   # 確認した内容を本番DBへ登録。ローカルは--remoteを付けない
   pnpm announcements:register --file /path/to/announcement.json --remote
   ```

5. DB登録後、公開日時に達した記事が画面へ反映される。通知ありで通知日時に達すると、既存購読者へCronから自動配信される。コードのリリースは不要。表示一覧は最新100件、過去の記事は記事IDの直接リンクで参照できる。

訂正は既存IDのまま上書きする。同じIDの送信済み購読には再配信しない。追加通知が必要なら理由を確認して新IDの記事を登録する。`notify:false, notifyAt:null`への変更で未送信分を停止する。非公開にする場合は`publishedAt:null`も指定する。すでに受理済みの通知を取り消すことはできない。

## 配信の確認・失敗対応

- `push_subscriptions`は本人・端末の購読情報。配信先URLと鍵は秘密情報相当として扱い、問い合わせやPRへ貼らない。
- `push_deliveries`は記事ID×購読IDの台帳。`pending`（待機）、`sending`（送信中）、`sent`（Pushサービスが受理）、`failed`（停止）。`sent`は端末への到達・開封を保証しない。
- 毎分Cronは記事ごとに最大100件を台帳へ追加し、全体で最大20件を送信する。通知日時以前に登録された購読だけを対象にする。初回の配信開始可能期間は通知日時から7日。7日を超えた待機分は送らない。大量配信向けのQueueや到達分析は将来の拡張とする。
- 通信失敗・429・5xxは指数的な待機（2・4・8・16分）で最大5回試行する。404/410は購読と紐づく台帳を削除。その他の4xxは`failed`で止め、鍵や設定を確認する。Worker終了で残った`sending`は2分のリース満了後に回復する。
- 外部サービスの受理とDB保存は一つのトランザクションにできないため、障害時の厳密な一度だけ配信は保証しない。同じ記事の通知tagで重複表示を抑える。解除直前に受理済みの通知は届く場合がある。
- Workersログは`announcement_push_delivery`の`announcement_id`・HTTP status・attemptを見る。配信先・鍵・プロバイダーの応答本文はログに出さない。運営権限のD1コンソールで以下の集計だけを確認できる。

  ```sql
  SELECT announcement_id,status,COUNT(*) AS count
  FROM push_deliveries GROUP BY announcement_id,status;
  ```

- 緊急停止は`PUSH_ENABLED=false`を設定・反映する。通常の購読解除APIは停止中も使える。再開時、7日以内の待機分は再開するため、不要な記事をDBで`notify:false, notifyAt:null`に更新してから再開する。
- 秘密鍵の漏洩時は配信を停止し、鍵を更新する。既存購読は旧公開鍵に結び付くため再購読が必要。画面で「解除」後に「有効にする」を案内する。勝手に既存購読の秘密情報を書き換えない。

## 検証範囲

Vitestで認証・所有権・入力・暗号化送信・再送防止・再試行・失効と通知許可の明示操作を検証する。NEWS-001はdesktop/phoneで画面導線と再読込を確認する。本番の秘密鍵設定、Pushサービス経由での端末到達、実機Safariでのホーム画面追加・通知許可・クリックはリリース担当の確認項目であり、ローカルテストだけでは保証しない。
