---
name: register-announcement
description: Use when the user asks to register, publish, schedule, correct, or withdraw an announcement in Pufu Lens, including choosing whether that announcement sends a push notification.
---

# Pufu Lensのお知らせをDB登録する

運営者の依頼からお知らせ原稿を整え、D1へ登録する。コードの静的カタログや新しいmigrationに通常のお知らせを追記しない。運用詳細はリポジトリの`docs/ANNOUNCEMENTS.md`を読む。

## 最初に揃える情報

- 本文の趣旨・見出し・分類（新機能／メンテナンス／重要）。日英の原稿は既存の文体で作り、ユーザーが本文を指定したら意図を変えない。
- 対象DB：ローカルか本番か。曖昧な場合はローカルへ勝手に本登録せず、原稿とdry-runまで進めて対象を確認する。
- 公開方法：下書き／即時公開／日時指定。日時のタイムゾーンを確認しUTCに変換する。
- **通知あり／なしを必ず選んでもらう。** 指定がない場合、原稿とdry-runは通知なしで準備し、DBの公開登録前に「この記事はPush通知あり／なしのどちらにしますか？」を確認する。明示指定があれば聞き直さない。
- 通知ありの場合は配信日時を揃える。公開前への通知は不可。同時配信の指示なら公開日時と通知日時を揃える。下書きは通知なし。

ユーザーが既に「本番へ公開、通知あり」等を指示している場合は、その範囲の再承認を求めず登録まで進める。未来の通知日時をDB登録すると、その時刻以降Cronが実ユーザーへ自動配信することを認識する。

## 登録手順

1. 新規は一意の英数字・ハイフン・アンダースコアのIDを作る。既存の訂正は元IDを保つ。過去IDを別の記事に再利用しない。
2. 保護した作業ファイルに以下のJSONを作る。本文はプレーンテキスト、個人の保存内容・秘密情報は載せない。`notify`は省略不可。

   ```json
   {
     "id": "2026-11-example",
     "category": "feature",
     "publishedAt": null,
     "notify": false,
     "notifyAt": null,
     "ja": { "title": "見出し", "summary": "短い案内", "paragraphs": ["本文"] },
     "en": { "title": "Heading", "summary": "Short summary", "paragraphs": ["Body"] }
   }
   ```

3. `pnpm announcements:register --file <JSONファイル> --dry-run`で入力と通知有無・公開日時を確認。本番対象ならdry-runにも`--remote`を付けて対象表示を一致させる。dry-runはDBに書き込まず外部通信もしない。通知ありは`notify: true`とミリ秒付きUTCの`notifyAt`、公開はミリ秒付きUTCの`publishedAt`を指定する。
4. 授権された対象へ同じコマンドから`--dry-run`だけ外して登録する。本番は通常のproductionビルド後の`dist/pufu_lens_stock/wrangler.json`と管理者のCloudflare認証が必要。鍵や認証情報をチャット・コマンド引数・PRへ出さない。認証や対象DBが未確認なら本番書き込みを推測で行わない。
5. 公開後はお知らせ画面の本文と通知指定を照合する。通知ありなら管理者の配信台帳で受理・失敗を確認。`sent`は開封や端末到達の保証ではない。報告は記事ID・対象DB・公開日時・通知あり/なし・配信日時・確認結果を短く示す。

## 訂正・停止

- 既存本文の訂正はIDと通知日時を維持する。訂正だけで送信済み端末へ再通知しない。追加通知の明示依頼がある時だけ新IDで案を作る。
- 未送信分を止める時は`notify:false, notifyAt:null`で更新する。すでに受理済みの通知は取り消せない。
- 非公開にする時は`publishedAt:null, notify:false, notifyAt:null`で更新する。
- 本番DBへの登録・更新は実データ操作。文案相談や機能実装の依頼だけを本番登録の指示と解釈しない。
