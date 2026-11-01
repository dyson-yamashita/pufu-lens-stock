# 公開プロジェクトSEO Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 合意済みの最優先5項目を実装し、公開プロジェクトと問い・プ譜を検索可能なHTMLと個別URLで提供する。

**Architecture:** Cloudflare Workers/Honoが既存の公開専用APIをプロセス内で呼び出し、許可済みフィールドだけをHTML化する。ViteのHTMLとアセットを再利用し、Reactの閲覧機能と既存のハッシュ共有URLを維持する。公開HTML・OGP・サイトマップはno-storeにして、取得ごとにD1の公開設定を確認する。

**Tech Stack:** Hono、Vite、React、D1、Vitest、既存ブラウザーE2E。

**Spec:** 本会話で承認された最優先5項目（HTML本文、個別URL、検索掲載初期OFF、メタ情報とサイトマップ、公開停止後の配信停止）。

## Global Constraints

- 検索掲載は公開可否と独立した所有者セッション限定設定。既存・新規とも初期OFF。
- 非公開メモリ・個人メモ・内部説明・生成入力をHTMLやメタ情報へ含めない。
- AI生成・外部サービス・追加依存は追加しない。
- 問い・プ譜の個別URLは既存公開IDを引き継ぐ。過去局面は閲覧可能、正規URLは最新のプ譜。
- robotsによる制限はアクセス制御ではなく、取得済みの外部コピーの回収は保証しない。

## Review Focus

- HTML/属性/XMLに含まれる利用者入力のエスケープ、外部URLのスキーム検証。
- 非公開化・削除・検索掲載解除後のHTML、OGP、サイトマップ、JSONの挙動。
- 他プロジェクトの問い・プ譜ID、未完成データ、存在しない局面。
- 直接URL・既存ハッシュURL・ページ送り・再読込の整合性。
- サイトマップ索引は50,000ファイル以下とし、分割XMLは索引付き固定範囲で最大1,000行を読む。root一覧の集約量は掲載対象件数に依存する。

### Task 1: 検索掲載設定

**Files:** migrations/0041_public_search.sql、shared/public-project.ts、server/public-projects.ts、src/PublicProjects.tsx、src/locales/{ja,en}.ts、tests/public-projects.test.ts、tests/publication-settings-ui.test.ts。

**Interfaces:** Publication.search_indexable:boolean。公開詳細もこのフラグを返す。PATCHで省略した既存クライアントは現在値を維持し、非公開化はfalseにする。

- [x] 設定の初期値・所有者制御・保存・非公開化による解除のテストを書き、失敗を確認。
- [x] 移行・API・日英UIを実装し、既存公開確認を維持。検索掲載開始にも明示確認を適用。
- [x] 関連Vitestを実行し成功を確認。

### Task 2: 公開HTMLと個別URL

**Files:** server/public-pages.ts、shared/public-route.ts、server/index.ts、wrangler.jsonc、index.html、src/main.tsx、src/PublicProjects.tsx、tests/public-pages.test.ts、tests/public-projects-ui.test.ts。

**Interfaces:** publicPagesApp()をWorkerの認証前に配置。/p/:key以下をWorker優先にする。公開本文は既存publicProjectsAppのレスポンスだけから生成。

- [x] HTML本文・固有meta・エスケープ・HEAD・権限境界・公開停止のテストを書き、失敗を確認。
- [x] プロジェクト、ストック、問い、プ譜の個別URLと一覧をHTML化し、通常リンクを設置。
- [x] Reactのリンクを個別URLへ移行し、ハッシュURLを互換変換。直接URLの再読込を検証。
- [x] 関連Vitestとビルドを実行。

### Task 3: クロール基盤・説明・検証

**Files:** server/public-pages.ts、src/UserManual.tsx、src/locales/{ja,en}.ts、docs/SPEC.md、packages/e2e/scenarios.json、packages/e2e/tests/flows.e2e.ts、tests/public-pages.test.ts。

**Interfaces:** /robots.txt、/sitemap.xml、分割サイトマップ。掲載許可した公開プロジェクトとその公開可能な問い・プ譜だけを列挙。

- [x] サイトマップの掲載許可・解除・削除とページ分割のテストを書き、失敗を確認。
- [x] サイトマップとrobotsを追加。公開JSONはnoindexにしてHTMLを正規の参照先にする。
- [x] 公開設定のマニュアルを日英で更新し、PUBLIC-001に設定・直接HTML・停止確認を追加。
- [x] 型・lint・Vitest・format・build・E2E台帳と関連ケースを実行。
- [x] standard scopedセキュリティ監査と独立コードレビューを実施し、指摘修正後に再検証。
- [ ] コミット・push・main向けPRを作成。マージ・本番反映は行わない。

## Execution ledger

- Ruling: 承認された5項目の実装依頼に基づき、このセッションで継続実装する。実装方式の再確認は不要。
- Ruling: HTML/OGPをキャッシュしないことで、キャッシュ削除用の追加bindingと処理を不要にする。

- Review fix: 詳細ページの?page=N初期値とページ送り後のURLを同期し、直接URL・再読込を保護。
- Review fix: サイトマップの全体COUNT/深いOFFSETを廃止。分割XMLはproject_id＋rowidの索引付き範囲を読み、一覧は実在bucketだけを集約する。他projectの大きなrowidギャップの回帰テストを追加。
- Ruling: rootサイトマップ一覧の集約コストは対象件数に比例する。初期範囲では追加のキャッシュや採番トリガーを導入せず、運用計測の対象として明記する。
- Verification: 標準E2Eは専用Chromiumの取得先cdn.playwright.devが環境のnetwork policyで403となり起動不可。システムChromium154を公式Playwright launchで起動し、PC/phone両幅で設定・初期HTML/OGP・サイトマップ・直接/旧URL・ページ送り/再読込・公開停止を補足検証。標準5シナリオのCI再生成功とは扱わない。

- Final verification: Vitest 93ファイル・1,001件成功。typecheck / lint / format:check / build / e2e:check成功。標準E2Eの環境制約と両画面幅の補足成功は上記のとおり。
- Final review: 独立コードレビューでCritical/Importantなし。standard scoped/source-only監査は6境界covered・確認済み脆弱性0件・存続する要検証候補0件、独立criticと成果物validator完了。実配備・外部検索の反映は未確認。
