# 機能別フォルダ構成と責務分割 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved plan in the current session, followed by an independent whole-branch review.

**Goal:** 初見でも入口と機能のまとまりが分かり、巨大ファイルを一度に読む必要のない配置にする。

**Architecture:** 既存の `src`・`server`・`shared`・`packages` の境界を保つ。フロントエンドは `app`・`features`・共通UI・通信・翻訳・スタイルに整理し、サーバーはAPIルート・機能の処理・MCP・基盤処理に整理する。移動に伴う参照を更新し、画面、HTTP契約、認証・権限制御、CSSの適用順は保つ。

**Tech Stack:** TypeScript, React 19, Hono, Cloudflare Workers, Vite, Vitest, browser E2E.

**Spec:** このチャットで提示し、ユーザーの「修正お願いします」で承認された機能別構成と巨大ファイル分割案。

## Global Constraints

- 最新 `origin/main` 起点の作業ブランチで変更し、mainへ直接pushしない。
- 振る舞い、公開URL、永続データ、外部API、依存ライブラリを変更しない。
- フロントエンド・サーバーは `shared` を参照できる。`shared` はその両方を参照しない。
- 機能専用の部品・フック・CSSは機能の近くに置き、共通部品だけを共通ディレクトリへ置く。
- 既存テストで動作を保護し、配置や実装をそのまま写すテストは追加しない。
- E2Eの担当ソースとツール・ビルド・ドキュメントにあるパスも更新する。
- マニュアルの操作説明は変更しない。開発者向け構成説明を追加する。

## Review Focus

- ハッシュ遷移、履歴、未保存編集のガード、一覧へ戻ったときのスクロールを維持する。
- 複数の定期取得とお気に入り更新の競合防止・AbortControllerの片付けを維持する。
- 認証ミドルウェアの登録順、OAuth principal、プロジェクト所有権、入力上限を維持する。
- 公開ページ・マニュアル・MCPビューア・PDF Workerの別エントリーをビルドできる。
- CSSを元の順で適用し、phone/desktop・light/darkで表示と操作を維持する。

### Task 1: 機能別に配置する

**Files:** `src/**`, `server/**`, their imports, build scripts/configuration, existing tests, E2E source ownership.

**Interfaces:** 既存のexportとファイル内容の意味を維持し、利用側のimportを新しいパスへ更新する。

- [ ] 既存Vitestのベースライン結果を確認する。
- [ ] ソースを機能別フォルダへ移し、相対import・動的import・ファイルURL・ビルド用パスを更新する。
- [ ] 型チェック・lint・既存テスト・ビルドで参照の整合性を検証する。

### Task 2: フロントエンドの巨大ファイルを分割する

**Files:** `src/app/**`, `src/features/{auth,stocks,projects,memory,integrations,public-projects}/**`, `src/styles/**`.

**Interfaces:** `App`を既定exportで維持。フォームのprops、公開画面のexport、UIとAPI呼び出し契約を維持する。

- [ ] `App`から既存の画面・フォーム・共通部品を切り出す。
- [ ] 画面遷移、セッション取得、一覧データの取得と更新、レイアウトを責務ごとに分ける。
- [ ] 公開設定と匿名閲覧の一覧・詳細を分ける。
- [ ] スタイルを元の順序を保って分け、既存UIテストで確認する。

### Task 3: APIとMCPを分割する

**Files:** `server/api/**`, `server/mcp/**`.

**Interfaces:** `createApp(trustedPrincipal?)`と`handleMcp`の既存インターフェースを維持。認証・認可の共通経路を維持する。

- [ ] APIを機能別のルート登録関数へ分け、共通の入力検証・所有権検証を分離する。
- [ ] MCPのツール登録を機能別に分け、権限制御とAPI呼び出しを共通基盤に残す。
- [ ] API・OAuth・MCP・削除・競合に関する既存テストで確認する。

### Task 4: 構成の読み方と検証台帳を整える

**Files:** `README.md`, `docs/ARCHITECTURE.md`, `docs/**`の参照、`packages/e2e/scenarios.json`, relevant tooling.

**Interfaces:** E2E ID・期待結果は維持し、分割した実装も担当ソースへ追加する。

- [ ] READMEから構成説明へリンクし、入口・機能の探し方・依存方向を記載する。
- [ ] 古いパスを確認し、アクティブな文書・スクリプト・テストの参照を修正する。
- [ ] 型チェック・lint・Vitest・format・build・E2E台帳検証・全シナリオ両画面幅を実行する。

### Task 5: 監査・独立レビュー・PR

**Files:** ブランチ全差分。

- [ ] `security-audit`のquick scoped runで、移動・分割差分と依存する認証経路を確認する。
- [ ] `requesting-code-review`で実装者と同じモデルの独立担当による読み取り専用レビューを行う。
- [ ] 対応が必要な指摘を修正し、関連検証と再監査・再レビューを行う。
- [ ] コミット・作業ブランチpush・main向けPR作成を行い、URLと検証結果を報告する。
