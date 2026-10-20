# MCP Hybrid Search Implementation Plan

> **For agentic workers:** Use the existing checkout and implement sequentially. Independent design/code review uses the repository's requesting-code-review process; do not delegate implementation.

**Goal:** MCPストック検索にkeyword互換のsemantic/hybridを追加する。

**Architecture:** D1の世代別outboxをCronでVectorizeへ同期する。検索はユーザーnamespaceから候補を取得し、D1で現行世代と全権限を照合してRRF統合する。

**Tech Stack:** TypeScript/Hono, D1, Workers AI bge-m3, Vectorize V2, Vitest/Miniflare。

**Spec:** `docs/superpowers/specs/2026-10-20-mcp-hybrid-search-design.md`

## Global Constraints

- keyword既定、本文/問い/公開検索は拡張しない。MCP scopesと許可プロジェクトを維持する。
- 1024次元、cosine、候補各100件、RRF k=60、min_score既定0.35。
- query100/index200回/24h、既存AI全体/同時制限も共有する。
- 本番資源作成・デプロイを行わない。秘密や利用者の検索内容をログ/文書に入れない。

## Review Focus

- 編集/削除中の古いupsertや検索結果は新世代の結果を汚さない。
- 他人/許可外候補で件数やsnippetを漏らさない。
- Vectorizeの応答不明でも削除要求を失わない。
- 外部障害/上限によるfallbackを成功した意味検索と表示しない。
- 未設定環境とkeyword検索では新たなAI呼び出しを起動しない。

## Task 1: 索引とembedding基盤

Files: migrations/0023_stock_search.sql, server/search-index.ts, server/search-ai.ts, server/env.ts, server/jobs.ts, tests/search.test.ts。

- [x] 既存テスト基盤に同期/所有権/削除競合/利用上限の失敗テストを追加してREDを確認。
- [x] 世代別要求とトリガー、migrationによる既存データのバックフィルを作る。
- [x] `embedSearchText(env,userId,text,kind)`でモデル/サイズ検証・共有上限・タイムアウトを実装。
- [x] `syncSearchIndex(env)`で最大10件のリース付き登録/削除と再試行を実装しCronへ接続。
- [x] 重要な同期・退会・競合テストをGREENにする。

## Task 2: 本人用検索とMCP

Files: server/stock-search.ts, server/api.ts, server/mcp.ts, shared/domain.ts, tests/search.test.ts, tests/mcp.test.ts。

- [x] keyword未呼び出し/意味候補/権限/絞り込み/ページング/fallbackのREDテストを追加。
- [x] 共通の絞り込みと現在のkeyword応答を維持し、semanticとhybridを追加。
- [x] メタデータに実際のモード、候補制限、索引待ちを示す。
- [x] MCPのmode/min_scoreと並び順の説明を追加して実OAuth呼び出しで確認。

## Task 3: 設定・説明・最終検証

Files: vite.config.ts, wrangler.jsonc, README.md, docs/SPEC.md, src/UserManual.tsx, relevant configuration tests。

- [x] 任意のVECTORIZE_INDEX_NAMEから環境別bindingを構成する。
- [x] Vectorize/metadata indexの作成、migration、進行確認、再試行を文書化。
- [x] マニュアルへMCPの検索方法を短く補足。
- [x] 全checkと必要なローカル動作を実行し、実サービス未検証の範囲を明記。
- [x] 独立コードレビューを完了し、重要指摘を解消。コミット/push/main向けPR作成はリポジトリの完了工程として実施する。

## 検証結果

- `pnpm run check`: 46ファイル・461テスト、型/lint/整形/ビルド成功。
- 検索関連25テスト、実ローカルOAuthの7ツール・hybrid未設定時の代替・semanticエラー・空白検索語を確認。
- マニュアルを390px/1440px・ライト/ダークで確認し、横スクロールとJavaScriptエラーなし。
- requesting-code-reviewの独立再レビューで残存指摘なし。実Cloudflareへの疎通・実モデル精度は未検証。
