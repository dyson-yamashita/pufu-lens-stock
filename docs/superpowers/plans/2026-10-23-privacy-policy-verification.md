# プライバシーポリシーのGoogle審査対応

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Google審査で指摘された本文不足を解消し、ドメイン確認と再申請の手順を明確にする。

**Architecture:** `src/LegalPage.tsx` を唯一の本文として、Viteビルド時に `/privacy`・`/terms` の静的HTMLを生成する。トップの初期HTMLにもサービス説明とポリシーへのリンクを含める。実際のGoogleログイン情報の処理を本文に明記する。

**Tech Stack:** React、Vite、Cloudflare Workers Static Assets、Vitest、linkedom。

**Spec:** ユーザーが提示したGoogle審査の2件の指摘、および https://support.google.com/cloud/answer/13806988?hl=en 。

## Global Constraints

- 最新の `origin/main` 起点の `codex/privacy-policy-oauth-verification` で作業する。
- データ処理・OAuth権限・公開範囲は変更しない。既存のデザインを再利用する。
- ドメイン所有権は未確認。設定変更・本番反映・審査送信は実行せず、手順を記載する。
- 通常工程はAGENTS.mdに基づき承認済みとして、実装・検証・独立レビュー・PR作成まで継続する。

## Review Focus

- JavaScriptを実行しない取得でも、HTML本文から全節が読めること。
- `/privacy/`・`/terms/`、節リンク、トップへの導線が機能すること。
- 静的ページにもビルド済みCSSとテーマ設定が適用されること。
- Googleの表示名がWorkers AIのユーザーメモリ生成に使われる実装と、本文の説明が一致すること。
- Google側の所有権確認とアプリのHTML修正を区別し、審査通過を保証しないこと。

## Task 1: HTML配信と本文の修正

**Files:** `scripts/legal-pages-plugin.ts`、`vite.config.ts`、`index.html`、`src/LegalPage.tsx`、`tests/legal-pages-build.test.ts`、`docs/SPEC.md`。

**Interfaces:** `legalPagesPlugin(): Plugin`。クライアントのビルド済み `index.html` を使い、同じCSS・本文コンポーネントから `privacy/index.html` と `terms/index.html` を出力する。法的文書にはアプリ起動用のmodule scriptを含めない。

- [x] Vitestで実際のViteビルドを行う小さい回帰テストを追加し、静的ページがないため失敗することを確認する。
- [x] ビルドプラグインを追加し、トップに初期説明とリンク、ポリシーにGoogle情報の取得・用途・保存・共有・AI利用・削除の説明を追加する。
- [x] Google認証の運用ドキュメントに、本番URL・承認済みドメイン・Search Consoleでの所有権確認・再申請前の確認を記載する。マニュアルは基本操作が変わらないため更新しない。
- [x] 関連テスト、型チェック、lint、format、全テスト、ビルドを実行する。ビルド成果物のHTMLとブラウザ表示を確認する。
- [x] `requesting-code-review` で読み取り専用の独立レビューを実施する。指摘なし。

## 検証記録

- 全59ファイル・630テスト成功。最終文言調整後の関連13テストも成功。
- 型チェック・lint・全体formatチェック・`git diff --check` 成功。
- 最終ビルド成功。静的ポリシー11節・規約13節、CSSとテーマスクリプト、アプリmodule scriptの除去を確認。
- Wrangler配信で `/`・`/privacy`・`/privacy/`・`/terms`・`/terms/` のHTTP 200、本文とCSSを確認。ブラウザで表示と削除節へのリンクを確認。
- 独立レビューでCritical・Important・Minorの修正指摘なし。
- 公開DNS TXT検索はENODATA。別方式による所有権確認の有無は未確認。

検証・レビュー済みの差分をコミット・pushし、`main` をベースにPRを作成する。
