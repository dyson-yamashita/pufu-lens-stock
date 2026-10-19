# 公開ポリシーページ Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this small change inline, then requesting-code-review for an independent read-only review.

**Goal:** Google OAuth同意画面に登録できるプライバシーポリシーと利用規約を追加する。

**Architecture:** 既存の `/manual` と同じパス判定で、認証不要の `/privacy` と `/terms` を表示する。既存の公開ヘッダー・マニュアルのCSSとテーマ変数を再利用し、本文と共通リンクを追加する。

**Tech Stack:** React 19 / TypeScript / Vite / Vitest / linkedom

**Spec:** ユーザーの依頼と添付のGoogle OAuthアプリドメイン設定画面。既存実装を本文の根拠とする。

## Global Constraints

- 最新の `origin/main` から `codex/privacy-terms-pages` で作業する。
- 新規依存・認証変更・データ処理変更・本番デプロイは行わない。
- 運営者名や連絡先など、確認できない個人情報を作らない。
- ユーザーの自律実行方針に従い、設計・工程ごとの再承認は求めない。

## Review Focus

- 未ログインでも両ページを直接開ける。末尾スラッシュも許容する。
- 本文がGoogle認証、Workers AI、YouTube、X、MCP、公開機能と一致する。
- Google連携解除・ログアウトと保存データ削除を混同しない。
- 目次・相互リンク・トップへ戻るリンクが動作する。
- モバイルとダークモードで本文が読みやすく横にはみ出さない。

### Task 1: 公開ページと導線

**Files:** `src/LegalPage.tsx`, `src/LegalLinks.tsx`, `src/main.tsx`, `src/App.tsx`, `src/UserManual.tsx`, `src/styles.css`, `tests/legal-pages-ui.test.ts`

**Interfaces:** `LegalPage({ page: 'privacy' | 'terms' })` と `LegalLinks({ newTab?: boolean })`。

- [x] パス判定とログイン画面の非表示、目次リンクを検証する最小限のパラメータ化テストを書き、未実装で失敗することを確認する。
- [x] 本文、日付、共通リンク、公開ルートを実装する。既存画面と同じ見た目を使い、本文は16px以上にする。
- [x] トップ、サイドメニュー、マニュアルへ導線を追加する。サイドメニューでは編集中の画面を保持するため新しいタブで開く。
- [x] 利用条件を確認する入口をマニュアルの初回利用説明に追記する。
- [x] 既存テスト、型チェック、lint、format、buildとブラウザのPC・モバイル・ダーク表示を検証する。
- [x] 独立したエージェントによる読み取り専用レビューと必要な修正・再検証・再レビューを行う。

検証・再レビュー完了後、コミット・pushし、`main` をベースにPRを作成する。本番デプロイとマージは行わない。
