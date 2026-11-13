# お知らせ・Push通知 Implementation Plan

**Goal:** お知らせの閲覧と端末ごとの任意の通知受信、運営の更新・配信手順を提供する。
**Architecture:** Reactの既存ハッシュルート、D1のお知らせ本文・公開/通知設定、セッション認証API、D1購読・配信台帳、既存Cron、キャッシュを行わないService Worker。
**Tech Stack:** TypeScript / React / Hono / Workers / D1 / Web Crypto Web Push
**Spec:** `docs/superpowers/specs/2026-11-13-announcements-push-design.md`

- [x] D1本文・公開API・管理者登録CLI/スキル、購読APIとD1移行。認証・所有権・入力・ログアウトをVitestで確認。
- [x] 上限付き配信、再試行・失効・無効時・過去分除外をVitestで確認。
- [x] お知らせ画面、通知設定、Service Worker、iOS用manifest、日英マニュアル。
- [x] E2E台帳と実テスト、型・lint・関連テスト・ビルドとブラウザー確認。
- [x] quick scopedセキュリティ監査と独立コードレビュー、修正・再確認後にコミット・push・PR。

## 確認する境界

他人の購読や連携トークンからの操作、任意URLへの送信、失効セッション、許可拒否・解除失敗、Cron重複実行・一時障害・期限超過を確認する。実機Safariと本番Push到達はリリース担当による別途確認とする。
