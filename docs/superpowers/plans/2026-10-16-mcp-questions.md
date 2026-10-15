# MCP連携と独立した問い Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** クラウドMCPからストックと独立した問いの取得・追加を行えるようにする。

**Architecture:** 既存のHono API・D1・R2・Workflowsを再利用する。問いをプロジェクト所属に変更し、OAuthで検証したユーザーとスコープをMCPの操作に適用する。

**Tech Stack:** TypeScript、React、Hono、Cloudflare Workers/D1/R2/KV、MCP SDK、Workers OAuth Provider、Vitest/Miniflare。

**Spec:** `docs/superpowers/specs/2026-10-16-mcp-questions-design.md`

## Global Constraints

- 日本語UIと既存のデザインを踏襲する。
- ショートカット用トークンの権限を拡大しない。
- 既存の問いID・お気に入り・関連プ譜・利用量制限を維持する。
- デプロイ、本番DBの変更、外部への送信は作業範囲に含めない。

## Review Focus

- ストックなしの問いが検索・詳細・お気に入り・削除・プ譜生成から漏れないこと。
- 移行でプ譜の外部キーと既存のAI生成が壊れないこと。
- MCPのプロジェクト制限がID指定、検索、追加のすべてに適用されること。
- OAuth認可要求がログインをまたいで保持され、同意・拒否・PKCE・失効が機能すること。
- SPAの静的配信がMCP/OAuth/metadataのルートを妨げないこと。

### Task 1: 独立した問いをDB・API・Web・プ譜で扱う

**Files:** migrations/0016_independent_questions.sql、shared/domain.ts、shared/pufu.ts、server/api.ts、server/db.ts、server/workflows.ts、server/demo.ts、server/ai.ts、server/pufu.ts、src/QuestionForm.tsx、src/Questions.tsx、src/QuestionPage.tsx、tests/independent-questions.test.ts、既存の関連テスト。

**Interfaces:** Questionはproject_id必須、stock_idと記事関連フィールドはnullable。POST /questionsはproject_idと任意stock_idを受け付け、既存stock_idだけの入力も受け付ける。PufuContext.stockはnullable。

- [x] 移行のデータ保持、独立した問いのCRUD/権限/再送/プロジェクト削除、既存の移動・削除、ストックなしのプ譜生成の失敗テストを書く。
- [x] `npm test -- tests/independent-questions.test.ts` で不足機能による失敗を確認する。
- [x] 合意したモデル・API・Webを実装する。既存INSERTは新しい所属先を保存する。
- [x] 関連テスト、型チェックを実行し修正する。

### Task 2: OAuth認可と連携管理

**Files:** server/mcp-oauth.ts、server/env.ts、server/auth.ts、server/index.ts、wrangler.jsonc、src/McpConnections.tsx、src/App.tsx、tests/mcp-oauth.test.ts、tests/helpers.ts、package.json、package-lock.json。

**Interfaces:** createMcpOAuthHandler(apiHandler)は/authorize・/token・metadataと認可同意を扱い、検証済みuserId/scopes/projectIdをMCPに渡す。連携の一覧・失効はWebセッションでのみ許可する。

- [x] 認可開始・ログイン後の復帰・同意/拒否・PKCE・トークン更新・スコープ/プロジェクト・失効の失敗テストを作り実行する。
- [x] Providerの既存機能を再利用し、短期限の認可要求とCSRF対策付き同意画面を追加する。
- [x] Webの連携一覧と失効UI、既存Googleログインからの復帰を実装する。
- [x] `npm test -- tests/mcp-oauth.test.ts` と型チェックで確認する。

### Task 3: MCPツールと既存API接続

**Files:** server/mcp.ts、server/api.ts、server/index.ts、tests/mcp.test.ts。

**Interfaces:** createMcpHandlerのサーバーファクトリが7つのツールを登録する。検証済みPrincipalを指定した内部Hono API呼び出しだけを使用し、ユーザーIDをツール引数から取得しない。

- [x] 実プロトコルのinitialize/tools/list/tools/call、検索・取得・追加・再送と権限拒否の失敗テストを書く。
- [x] 正しいスキーマ・読み取り/書き込みannotation・構造化結果でツールを実装する。
- [x] すべての操作でスコープとプロジェクト制限を適用し、本文は明示要求時だけ返す。
- [x] `npm test -- tests/mcp.test.ts` で確認する。

### Task 4: 統合検証・手順・レビュー

**Files:** README.md、必要な関連修正。

- [x] `npm run check` を実行し、全テスト・型・lint・format・buildを通す。
- [x] ローカルブラウザで独立した問いの追加・詳細・プ譜生成・MCP連携画面を確認する。
- [x] KV作成、マイグレーション、HTTPS MCP URL、ChatGPTでのOAuth接続・解除の手順をREADMEに記載する。
- [x] 独立したレビューで重大・重要な問題を確認・修正し、最終検証する。
